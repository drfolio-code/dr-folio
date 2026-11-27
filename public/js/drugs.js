// Vademécum personal (v1.18.0): fichas de fármacos propias (no conectadas a ninguna fuente externa).
// Cada ficha = un principio activo con nombres comerciales, presentaciones, pautas (con su línea para el informe,
// que se copia de un toque) y «Mis notas» con el MISMO editor de las notas (lectura / edición).
// Datos y reglas: ver drugbody.js. Carpetas: el mismo explorador de Notas (TREES.drugs en app.js).
import { writeBatch } from '../vendor/libs.js';
import { db } from './db.js';
import { store, put, patch, newId, folderPath, childFolders, flatFolders, commitBatch, ref, liveNotes } from './store.js';
import { el, $, debounce, norm, shortDate, longDate } from './util.js';
import { toast, modal, confirm, menu, picker } from './ui.js';
import { icon } from './icons.js';
import { fitTitle } from './viewport.js';
import { copyText } from './snippets.js';
import { textToHtml } from './snipbody.js';
import { addQuota, budget } from './backup.js';
import {
  REG_FIELDS, genLine, lineOf, regSummary, drugMatches, byName, liveDrugs, drugKey, drugByName,
  drugBodyOf, loadDrugBody, writeDrug, deleteDrugDocs, parseDrugImport, mergeList, regKey
} from './drugbody.js';

let ctx = null;          // ayudas de app.js
let editor = null;       // editor de «Mis notas» (createEditor, el mismo de las notas)
let curId = null;        // ficha abierta
let reading = false;     // modo lectura (como las notas)
let bodyReady = false;   // «Mis notas» cargada (si no, no se edita ni se guarda)
let dirtyLight = false;  // nombre, marcas, presentaciones o pautas sin guardar
let dirtyBody = false;   // «Mis notas» sin guardar
let loadedHtml = '';
let form = null;         // copia editable de la ficha abierta { brands, regimens }

const DF = () => store.drugFolders;
export const currentDrug = () => curId;
export const isDrugReading = () => !!curId && (reading || !!store.drugs.get(curId)?.trashed);
export const drugPathText = (folderId) => (folderId ? folderPath(folderId, DF()).map((f) => f.name).join(' › ') : '');
const regId = () => Math.random().toString(36).slice(2, 10);
const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
const ROUTES = ['VO', 'IV', 'IM', 'SC', 'SL', 'VR', 'Inhalada', 'Nebulizada', 'Tópica', 'Intranasal', 'Oftálmica', 'Ótica', 'Transdérmica'];
const FREQS = ['dosis única', 'cada 4 h', 'cada 6 h', 'cada 8 h', 'cada 12 h', 'cada 24 h', 'si dolor', 'si fiebre', 'en desayuno', 'en cena', 'en perfusión continua'];

// ====================== Lista: tarjetas, vistas y orden ======================
/** Fármacos de una vista fija: daz (A-Z) | dfav | drecent | dreview | dtrash */
export function drugsForView(type) {
  if (type === 'dtrash') return [...store.drugs.values()].filter((d) => d.trashed).sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0));
  const live = liveDrugs();
  if (type === 'dfav') return live.filter((d) => d.favorite).sort(byName);
  if (type === 'drecent') return live.filter((d) => d.lastViewedAt).sort((a, b) => (b.lastViewedAt || 0) - (a.lastViewedAt || 0)).slice(0, 50);
  if (type === 'dreview') return live.filter((d) => d.reviewed === false).sort(byName);
  return live.sort(byName);
}

function markText(text, search) {
  const q = norm((search || '').trim()).split(/\s+/).filter(Boolean)[0];
  const i = q ? norm(text).indexOf(q) : -1;
  if (i < 0) return text;
  const frag = document.createDocumentFragment();
  frag.append(text.slice(0, i), el('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length));
  return frag;
}

/** Tarjeta de un fármaco: tocar = abrir · ☆ = favorito · 📋 = copiar (si tiene una sola pauta) */
export function drugCard(d, { search = '', showPath = false, onLongPress = null, onOpen = null } = {}) {
  const regs = d.regimens || [];
  const path = showPath ? drugPathText(d.folderId) : '';
  const brands = (d.brands || []).join(' · ');
  const open = () => (onOpen ? onOpen(d.id) : openDrug(d.id, { push: true }));
  const card = el('div', {
    class: `note-card snip-card drug-card ${d.id === curId ? 'active' : ''}`, role: 'button', tabindex: '0',
    onclick: (e) => { if (e.target.closest('.snip-quick') || (onLongPress && onLongPress(card))) return; open(); },
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) open(); }
  },
    el('div', { class: 'snip-card-main' },
      el('div', { class: 't' }, el('span', {}, markText(d.name || 'Sin nombre', search)),
        d.reviewed === false ? el('span', { class: 'rev-badge', title: 'Pendiente de revisar' }, '⚠ Revisar') : null),
      el('div', { class: 's' }, brands ? markText(brands, search) : regs.length ? `${regs[0].indication || ''} ${regSummary(regs[0])}`.trim() : el('span', { class: 'muted' }, 'Ficha vacía')),
      el('div', { class: 'm' },
        path ? el('span', { class: 'snip-path' }, icon('folder'), ` ${path}`) : null,
        el('span', {}, regs.length ? `${regs.length} pauta${regs.length > 1 ? 's' : ''}` : 'Sin pautas'),
        d.trashed ? el('span', {}, `· en la papelera ${shortDate(d.trashedAt)}`) : d.lastViewedAt ? el('span', {}, `· consultado ${shortDate(d.lastViewedAt)}`) : null)),
    d.trashed ? null : el('div', { class: 'snip-btns' },
      el('button', {
        class: `icon-btn snip-quick snip-star ${d.favorite ? 'on' : ''}`, type: 'button',
        title: d.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', 'aria-label': d.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos',
        onclick: () => toggleFavorite(d.id)
      }, icon('star')),
      regs.length === 1 ? el('button', {
        class: 'icon-btn snip-quick', type: 'button', title: `Copiar: ${lineOf(d.name, regs[0])}`, 'aria-label': `Copiar la pauta de ${d.name || ''}`,
        onclick: (e) => copyLine(lineOf(d.name, regs[0]), e.currentTarget)
      }, icon('copy')) : null));
  return card;
}

export function toggleFavorite(id) {
  const d = store.drugs.get(id);
  if (!d) return;
  d.favorite = !d.favorite; // reflejo inmediato
  patch('drugs', id, { favorite: d.favorite });
  toast(d.favorite ? 'Añadido a favoritos ⭐' : 'Quitado de favoritos', 'ok');
  if (curId === id) renderChrome();
  ctx.renderList(); ctx.renderSidebar();
}

export function moveDrugTo(id, folderId) {
  const d = store.drugs.get(id);
  if (!d || d.trashed || (d.folderId || null) === (folderId || null)) return;
  d.folderId = folderId || null;
  patch('drugs', id, { folderId: folderId || null, updatedAt: Date.now() });
  toast(`Movido a ${folderId ? `«${DF().get(folderId)?.name || 'carpeta'}»` : '«Vademécum» (sin carpeta)'}`, 'ok');
  if (curId === id) renderChrome();
  ctx.renderList(); ctx.renderSidebar();
}

export async function moveDrug(id) {
  const d = store.drugs.get(id);
  if (!d || d.trashed) return;
  const items = [{ id: '__root', label: '— Sin carpeta —' }, { id: '__new', label: '＋ Nueva carpeta…' },
    ...flatFolders(null, DF()).map((f) => ({ id: f.id, label: f.name, depth: f.depth }))];
  let target = await picker(`Mover «${d.name || 'Sin nombre'}» a…`, items, { placeholder: 'Buscar carpeta…' });
  if (!target) return;
  if (target === '__new') { target = await ctx.newFolder(null); if (!target) return; }
  moveDrugTo(id, target === '__root' ? null : target);
}

/** Menú de un fármaco (lista: clic derecho / mantener pulsado; ficha: ⋯) */
export function drugItemMenu(anchor, d, { inList = true } = {}) {
  if (d.trashed) {
    menu(anchor, [
      { icon: 'undo-2', label: 'Restaurar', onClick: () => restoreDrug(d.id) },
      { icon: 'x', label: 'Eliminar definitivamente', danger: true, onClick: () => deleteForever(d.id) }
    ]);
    return;
  }
  const here = !inList && curId === d.id;
  menu(anchor, [
    inList ? { icon: 'file-text', label: 'Abrir', onClick: () => openDrug(d.id, { push: true }) } : null,
    here ? { icon: 'copy', label: 'Copiar ficha entera', onClick: () => { saveSoon.flush(); copyLine(drugAsText(store.drugs.get(d.id))); } } : null,
    here && bodyReady ? { icon: 'list', label: editor.hasTocBlock() ? 'Quitar índice de «Mis notas»' : 'Añadir índice a «Mis notas»', onClick: toggleToc } : null,
    here ? (reading ? { icon: 'pencil', label: 'Editar', onClick: () => setReading(false) } : { icon: 'book-open', label: 'Modo lectura', onClick: () => setReading(true) }) : null,
    { icon: 'star', label: d.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', onClick: () => toggleFavorite(d.id) },
    d.reviewed === false
      ? { icon: 'check', label: 'Marcar como revisada', onClick: () => setReviewed(d.id, true) }
      : { icon: 'triangle-alert', label: 'Marcar «Pendiente de revisar»', onClick: () => setReviewed(d.id, false) },
    { icon: 'folder-input', label: 'Mover a carpeta…', onClick: () => moveDrug(d.id) },
    { icon: 'copy-plus', label: 'Duplicar', onClick: () => duplicateDrug(d.id) },
    '-',
    { icon: 'trash-2', label: 'Mover a la papelera', danger: true, onClick: () => trashDrug(d.id) }
  ].filter(Boolean));
}

function setReviewed(id, on) {
  const d = store.drugs.get(id);
  if (!d) return;
  d.reviewed = on;
  patch('drugs', id, { reviewed: on, reviewedAt: on ? Date.now() : null });
  toast(on ? 'Ficha revisada ✓' : 'Marcada como pendiente de revisar', 'ok');
  if (curId === id) renderChrome();
  ctx.renderList(); ctx.renderSidebar();
}

/** Ficha en texto plano (para «Copiar ficha entera») */
function drugAsText(d) {
  if (!d) return '';
  const out = [d.name || 'Sin nombre'];
  if (d.brands?.length) out.push(`Nombres comerciales: ${d.brands.join(', ')}`);
  if (d.presentations?.length) out.push('', 'Presentaciones:', ...d.presentations.map((p) => `- ${p}`));
  if (d.regimens?.length) {
    out.push('', 'Pautas:');
    for (const r of d.regimens) out.push(`- ${[r.indication, regSummary(r)].filter(Boolean).join(': ')}`, `  ${lineOf(d.name, r)}`);
  }
  const notes = curId === d.id && bodyReady ? editor.allText() : (drugBodyOf(d.id)?.text || '');
  if (notes.trim()) out.push('', 'Mis notas:', notes.trim());
  return out.join('\n');
}

async function copyLine(text, btn = null) {
  if (!text || !text.trim()) { toast('No hay texto que copiar'); return; }
  const ok = await copyText(text);
  toast(ok ? 'Copiado ✓' : 'No se pudo copiar', ok ? 'ok' : 'error', 1600);
  if (ok && btn) { btn.classList.add('done'); setTimeout(() => btn.classList.remove('done'), 1400); }
}

// ====================== Selector (enlazar un fármaco desde una nota) ======================
/** Buscador de fármacos (principio activo o nombre comercial). Resuelve con {id, name} o null. */
export function pickDrug() {
  const items = liveDrugs().sort(byName).map((d) => ({ id: d.id, label: d.name || 'Sin nombre', sub: [(d.brands || []).join(', '), drugPathText(d.folderId)].filter(Boolean).join(' · ') }));
  return picker('Insertar fármaco', items, { placeholder: 'Principio activo o nombre comercial…', emptyText: 'No hay fármacos que coincidan (créalos en el Vademécum)' })
    .then((id) => (id ? { id, name: store.drugs.get(id)?.name || 'Fármaco' } : null));
}

// ====================== Crear ======================
/** Nueva ficha vacía. folderId = carpeta donde se crea; favorite si se crea desde «Favoritos». */
export function newDrug({ folderId = null, favorite = false, name = '' } = {}) {
  saveSoon.flush();
  const id = newId('drugs');
  const now = Date.now();
  const data = blankDrug({ name, folderId, favorite, now });
  store.drugs.set(id, { id, ...data });
  put('drugs', id, data);
  openDrug(id, { push: true, focusTitle: true });
  ctx.renderList(); ctx.renderSidebar();
  return id;
}
const blankDrug = ({ name = '', folderId = null, favorite = false, now = Date.now(), reviewed = true } = {}) => ({
  name, brands: [], folderId: folderId || null, presentations: [], regimens: [], favorite: !!favorite, reviewed,
  lastViewedAt: null, trashed: false, trashedAt: null, createdAt: now, updatedAt: now, bodyAt: 0, files: [], links: [], size: 0
});

/** «Añadir varios»: una lista pegada (un fármaco por línea o separados por comas) → fichas vacías, sin duplicar */
export async function addManyDrugs(folderId = null) {
  const ta = el('textarea', { rows: 8, placeholder: 'Paracetamol\nMetamizol\nDexketoprofeno, Ibuprofeno, Tramadol', spellcheck: 'false' });
  const info = el('p', { class: 'muted small' }, 'Un fármaco por línea, o separados por comas o punto y coma.');
  const parse = () => {
    const seen = new Set(), add = [], dup = [];
    for (let raw of ta.value.split(/[\n,;]+/)) {
      raw = raw.replace(/^\s*(?:[-•*·]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim().slice(0, 150);
      if (!raw) continue;
      const name = raw[0].toLocaleUpperCase('es') + raw.slice(1);
      const k = drugKey(name);
      if (seen.has(k)) continue;
      seen.add(k);
      (drugByName(name) ? dup : add).push(name);
    }
    return { add, dup };
  };
  const refresh = () => {
    const { add, dup } = parse();
    info.textContent = add.length || dup.length
      ? `Se crearán ${add.length} ficha(s)${dup.length ? ` · ya existen ${dup.length}: ${dup.slice(0, 6).join(', ')}${dup.length > 6 ? '…' : ''}` : ''}.`
      : 'Un fármaco por línea, o separados por comas o punto y coma.';
  };
  ta.addEventListener('input', refresh);
  const where = folderId ? `en «${DF().get(folderId)?.name || 'carpeta'}»` : 'sin carpeta';
  const ok = await modal({
    title: 'Añadir varios fármacos',
    body: [el('p', {}, `Pega la lista. Se crean fichas vacías ${where}; las que ya existan no se repiten.`), ta, info],
    actions: [{ label: 'Cancelar' }, { label: 'Crear fichas', primary: true, value: true, onClick: () => { if (!parse().add.length) { toast('No hay fármacos nuevos en la lista', 'error'); return false; } return true; } }],
    onOpen: () => setTimeout(() => ta.focus(), 50)
  });
  if (!ok) return;
  const { add, dup } = parse();
  let batch = writeBatch(db), n = 0;
  const now = Date.now();
  for (const name of add) {
    const id = newId('drugs');
    const data = blankDrug({ name, folderId, now });
    batch.set(ref('drugs', id), data);
    store.drugs.set(id, { id, ...data });
    if (++n % 400 === 0) { commitBatch(batch); batch = writeBatch(db); }
  }
  if (n % 400) commitBatch(batch);
  addQuota(n, 0);
  toast(`${add.length} ficha(s) creada(s)${dup.length ? ` · ${dup.length} ya existían` : ''}`, 'ok', 3500);
  ctx.renderList(); ctx.renderSidebar();
}

// ====================== Importar fichas (JSON) ======================
/** Busca o crea (en el lote) la carpeta con esa ruta de nombres. Devuelve su id. */
function folderFor(names, parentId, batch, created) {
  let parent = parentId || null;
  for (const name of names) {
    const k = norm(name).trim();
    let f = childFolders(parent, DF()).find((x) => norm(x.name).trim() === k);
    if (!f) {
      const id = newId('drugFolders');
      const now = Date.now();
      const data = { name, parentId: parent, color: null, order: now + created.length, createdAt: now, updatedAt: now };
      DF().set(id, { id, ...data });
      batch.set(ref('drugFolders', id), data);
      created.push(name);
      f = { id };
    }
    parent = f.id;
  }
  return parent;
}

/** Plan de la importación: qué fichas se crean, cuáles se completan y cuáles no cambian (no escribe nada) */
function planImport(items) {
  const plan = { create: [], merge: [], same: [] };
  const seen = new Map(); // nombre → entrada (fármacos repetidos dentro del mismo archivo: se juntan)
  for (const it of items) {
    const k = drugKey(it.name);
    if (seen.has(k)) {
      const a = seen.get(k);
      a.brands = mergeList(a.brands, it.brands)[0];
      a.presentations = mergeList(a.presentations, it.presentations)[0];
      const keys = new Set(a.regimens.map(regKey));
      a.regimens.push(...it.regimens.filter((r) => !keys.has(regKey(r))));
      if (!a.notes && it.notes) a.notes = it.notes;
      continue;
    }
    seen.set(k, it);
  }
  for (const it of seen.values()) {
    const d = drugByName(it.name);
    if (!d) { plan.create.push(it); continue; }
    const [brands, nb] = mergeList(d.brands, it.brands);
    const [presentations, np] = mergeList(d.presentations, it.presentations);
    const keys = new Set((d.regimens || []).map(regKey));
    const newRegs = it.regimens.filter((r) => !keys.has(regKey(r)));
    const notes = !(d.bodyAt > 0) && it.notes.trim() ? it.notes : '';
    if (!nb && !np && !newRegs.length && !notes) { plan.same.push(d); continue; }
    plan.merge.push({ d, light: { brands, presentations, regimens: [...(d.regimens || []), ...newRegs] }, notes, added: { nb, np, nr: newRegs.length, notes: !!notes } });
  }
  return plan;
}

export function importDrugs(folderId = null) {
  const input = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    input.remove();
    if (!f) return;
    runImport(await f.text(), f.name, folderId);
  });
  document.body.append(input);
  input.click();
}

// Plantilla de carpetas (v1.20.0): grupos terapéuticos para Atención Primaria, Urgencias y Rescate en montaña,
// con un fármaco de ejemplo en cada subcarpeta. Usa la misma importación: no repite ni cambia lo que ya tengas.
export const TEMPLATE_URL = './plantillas/vademecum-ap-urgencias-montana.json';
// Versión de la plantilla: al subirla, vuelve a aparecer el aviso «Cargar» en el Vademécum (settings/vademecum, común a todos los dispositivos)
export const TEMPLATE_VERSION = 2;
export const templateState = () => store.settings?.get('vademecum') || {};
export const templatePending = () => !!store.loaded.settings && (templateState().templateVersion || 0) < TEMPLATE_VERSION
  && (templateState().dismissed || 0) < TEMPLATE_VERSION;
export function dismissTemplate() { put('settings', 'vademecum', { dismissed: TEMPLATE_VERSION, updatedAt: Date.now() }); }
export async function importTemplate() {
  let text;
  try {
    const r = await fetch(TEMPLATE_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(String(r.status));
    text = await r.text();
  } catch { toast('No se pudo descargar la plantilla (¿sin conexión?)', 'error', 5000); return; }
  runImport(text, 'Plantilla Dr.Folio · Atención Primaria · Urgencias · Montaña', null, { template: true });
}

async function runImport(text, fileName, folderId, { template = false } = {}) {
  {
    let items;
    try { items = parseDrugImport(text, regId); } catch (e) { toast(e.message, 'error', 6000); return; }
    const plan = planImport(items);
    const paths = new Set(items.filter((it) => it.folder.length).map((it) => it.folder.join(' › ')));
    const tops = new Set(items.filter((it) => it.folder.length).map((it) => it.folder[0]));
    const li = (t) => el('li', {}, t);
    const list = (arr, fmt) => (arr.length ? el('ul', { class: 'imp-list' }, arr.slice(0, 12).map((x) => li(fmt(x))), arr.length > 12 ? li(`… y ${arr.length - 12} más`) : null) : null);
    const ok = await modal({
      title: template ? 'Plantilla de carpetas' : 'Importar fichas',
      body: [
        el('p', { class: 'muted small' }, fileName),
        template ? el('p', {}, `${tops.size} grupos, ${paths.size} subcarpetas (las que ya tengas se aprovechan) y ${items.length} fármacos con sus nombres comerciales principales. No se borra ni cambia nada de lo que ya tengas.`) : null,
        el('table', { class: 'bk-table' }, el('tbody', {},
          el('tr', {}, el('td', {}, 'Fichas nuevas'), el('td', {}, String(plan.create.length))),
          el('tr', {}, el('td', {}, 'Ya existen: se completan'), el('td', {}, String(plan.merge.length))),
          el('tr', {}, el('td', {}, 'Ya existen: sin cambios'), el('td', {}, String(plan.same.length))))),
        list(plan.create, (x) => x.name),
        plan.merge.length ? el('p', { class: 'small' }, 'Se añade a las fichas que ya tienes (sin borrar ni cambiar nada de lo que hay):') : null,
        list(plan.merge, (m) => `${m.d.name}: ${[m.added.nb ? `${m.added.nb} nombre(s) comercial(es)` : '', m.added.np ? `${m.added.np} presentación(es)` : '', m.added.nr ? `${m.added.nr} pauta(s)` : '', m.added.notes ? 'notas' : ''].filter(Boolean).join(', ')}`),
        el('p', { class: 'bk-warn' }, '⚠ Las fichas nuevas o completadas quedan marcadas «Pendiente de revisar» hasta que pulses «✓ Revisada» en cada una. Comprueba las dosis antes de usarlas.'),
        el('p', { class: 'muted small' }, `Las nuevas van a ${folderId ? `«${DF().get(folderId)?.name || 'carpeta'}»` : 'la raíz del Vademécum'} (o a la carpeta que indique el archivo).`)
      ],
      actions: [{ label: 'Cancelar' }, { label: 'Importar', primary: true, value: true, onClick: () => (plan.create.length || plan.merge.length ? true : (toast('No hay nada nuevo que importar', 'ok'), false)) }]
    });
    if (!ok) return;
    const ops = plan.create.reduce((s, it) => s + 1 + (it.notes.trim() ? 1 : 0), 0) + plan.merge.reduce((s, m) => s + 1 + (m.notes ? 1 : 0), 0) + 20;
    if (budget().w < ops) { toast('Hoy ya casi no quedan escrituras del plan gratuito. Importa mañana.', 'error', 6000); return; }
    let batch = writeBatch(db), n = 0;
    const flush = () => { if (n >= 300) { commitBatch(batch); batch = writeBatch(db); n = 0; } };
    const created = [];
    const now = Date.now();
    for (const it of plan.create) {
      const id = newId('drugs');
      const fid = it.folder.length ? folderFor(it.folder, null, batch, created) : folderId;
      const light = { ...blankDrug({ name: it.name, folderId: fid, now, reviewed: false }), brands: it.brands, presentations: it.presentations, regimens: it.regimens, importedAt: now };
      writeDrug(id, light, it.notes.trim() ? { html: textToHtml(it.notes), text: it.notes } : null, batch, { commit: false });
      n += 2; flush();
    }
    for (const m of plan.merge) {
      writeDrug(m.d.id, { ...m.light, reviewed: false, importedAt: now, updatedAt: now }, m.notes ? { html: textToHtml(m.notes), text: m.notes } : null, batch, { commit: false });
      n += 2; flush();
    }
    commitBatch(batch);
    addQuota(ops - 20, 0);
    toast(`Importado: ${plan.create.length} nueva(s), ${plan.merge.length} completada(s)${created.length ? `, ${created.length} carpeta(s)` : ''}`, 'ok', 4500);
    if (template) put('settings', 'vademecum', { templateVersion: TEMPLATE_VERSION, updatedAt: Date.now() });
    if (curId && plan.merge.some((m) => m.d.id === curId)) fillForm(store.drugs.get(curId));
    ctx.renderList(); ctx.renderSidebar();
  }
}

// ====================== Ficha ======================
export function openDrug(id, { push = false, focusTitle = false, fromHash = false } = {}) {
  const d = store.drugs.get(id);
  if (!d) {
    if (!store.loaded.drugs) { setTimeout(() => openDrug(id, { push, focusTitle, fromHash }), 300); return; }
    toast('Ese fármaco ya no existe', 'error');
    closeDrug();
    return;
  }
  const same = curId === id;
  if (!same) saveSoon.flush();
  curId = id;
  if (!same || focusTitle) {
    dirtyLight = false; dirtyBody = false;
    reading = !focusTitle && ctx.openMode() === 'read';
  }
  ctx.showPane('drug');
  if (!same) { fillForm(d); $('#drug-scroll').scrollTop = 0; } else renderChrome();
  $('#drug-status').textContent = '';
  if (!fromHash) ctx.pushHash(!push);
  ctx.renderList();
  if (focusTitle) $('#drug-title').focus();
  ctx.updateWakeLock();
  // Última consulta («Recientes»): como mucho una escritura cada 10 minutos por ficha
  if (!d.trashed && Date.now() - (d.lastViewedAt || 0) > 10 * 60000) { d.lastViewedAt = Date.now(); patch('drugs', id, { lastViewedAt: d.lastViewedAt }); }
}

export function closeDrug({ fromHash = false } = {}) {
  saveSoon.flush();
  curId = null;
  reading = false;
  bodyReady = false;
  form = null;
  editor?.hideFloating();
  if (!fromHash) ctx.pushHash(true);
  ctx.updateWakeLock();
}

/** Rellena la ficha abierta con los datos guardados (y carga «Mis notas» si hace falta) */
function fillForm(d) {
  if (!d) return;
  form = { brands: [...(d.brands || [])], regimens: clone(d.regimens || []) };
  $('#drug-title').value = d.name || '';
  requestAnimationFrame(() => fitTitle($('#drug-title')));
  $('#drug-pres').value = (d.presentations || []).join('\n');
  const id = d.id;
  const b = drugBodyOf(id);
  bodyReady = !!b;
  showBody(b);
  if (!b) {
    $('#drug-status').textContent = 'Cargando…';
    loadDrugBody(id).then((body) => {
      if (curId !== id) return;
      bodyReady = true;
      showBody(body);
      $('#drug-status').textContent = body.stale ? 'Sin conexión · copia del dispositivo' : '';
      renderChrome();
    }, () => {
      if (curId !== id) return;
      $('#drug-status').textContent = '';
      $('#drug-content').dataset.placeholder = 'No se pudieron cargar tus notas: sin conexión. Vuelve a abrir la ficha cuando tengas internet.';
    });
  }
  renderChrome();
}
function showBody(b) {
  const c = $('#drug-content');
  c.dataset.placeholder = b ? 'Tus notas: ajustes renal/hepático, interacciones, trucos… (mismo editor que las notas)' : 'Cargando tus notas…';
  editor.setContent(b ? b.html : '');
  loadedHtml = b ? b.html : '';
}

/** Lectura / edición: igual que en las notas (toda la ficha a la vez) */
function setReading(on) {
  const d = store.drugs.get(curId);
  if (!d || d.trashed) return;
  if (on) {
    saveSoon.flush();
    document.activeElement?.blur?.();
    window.getSelection()?.removeAllRanges();
  }
  reading = on;
  renderChrome();
  if (!on && !d.name) $('#drug-title').focus();
  ctx.updateWakeLock();
}

function toggleToc() {
  if (!curId || !bodyReady) return;
  const on = editor.toggleTocBlock();
  dirtyBody = true;
  saveSoon.cancel();
  saveNow();
  toast(on ? (editor.headings().length ? 'Índice añadido ✓' : 'Índice añadido: usa «Título 1/2/3» y se rellenará solo') : 'Índice quitado', 'ok', 2500);
}

/** Cabecera, avisos y secciones de la ficha abierta según lectura / edición */
function renderChrome() {
  const d = store.drugs.get(curId);
  if (!d) return;
  const trashed = !!d.trashed;
  const rd = reading || trashed;
  const wrap = $('#drug-wrap');
  wrap.classList.toggle('readonly', rd);
  wrap.classList.toggle('no-body', !bodyReady); // «Mis notas» aún no ha cargado: sin barra de formato
  wrap.classList.toggle('reading', rd);
  wrap.classList.toggle('editing-form', !rd);
  editor.setReadOnly(rd || !bodyReady);
  $('#drug-title').readOnly = rd;
  $('#drug-title').tabIndex = rd ? -1 : 0;
  const eb = $('#drug-edit');
  eb.classList.toggle('hidden', trashed);
  eb.classList.toggle('primary', !rd);
  eb.title = rd ? 'Editar la ficha' : 'Terminar de editar (modo lectura)';
  eb.setAttribute('aria-label', eb.title);
  eb.querySelector('.ico').replaceChildren(icon(rd ? 'pencil' : 'check'));
  eb.querySelector('.lbl').textContent = rd ? 'Editar' : 'Listo';
  const path = drugPathText(d.folderId);
  $('#drug-folder').replaceChildren(icon('folder'), ` ${path || 'Sin carpeta'}`);
  const fav = $('#drug-fav');
  fav.classList.toggle('on', !!d.favorite);
  fav.classList.toggle('hidden', trashed);
  fav.title = d.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos';
  $('#drug-review').classList.toggle('hidden', d.reviewed !== false || trashed);
  $('#drug-trash').classList.toggle('hidden', !trashed);
  renderBrands();
  renderPres();
  renderRegs();
  renderBacklinks();
  renderInfo(d);
}

function renderInfo(d) {
  $('#drug-info').textContent = [
    `Creada: ${longDate(d.createdAt)}`, `Modificada: ${longDate(d.updatedAt)}`,
    d.lastViewedAt ? `Consultada: ${longDate(d.lastViewedAt)}` : null,
    d.importedAt ? `Importada: ${longDate(d.importedAt)}` : null,
    d.reviewed !== false && d.reviewedAt ? `Revisada: ${longDate(d.reviewedAt)}` : null
  ].filter(Boolean).join(' · ');
}

// ---------- Nombres comerciales ----------
function renderBrands() {
  const rd = $('#drug-wrap').classList.contains('reading');
  const chips = form.brands.map((b, i) => el('span', { class: 'chip' }, b,
    rd ? null : el('button', { class: 'x', type: 'button', 'aria-label': `Quitar ${b}`, onclick: () => { form.brands.splice(i, 1); changedLight(); renderBrands(); } }, '×')));
  if (rd && !chips.length) chips.push(el('span', { class: 'muted small' }, 'Sin nombres comerciales'));
  $('#drug-brand-chips').replaceChildren(...chips);
}
function addBrands(raw) {
  const input = $('#drug-brand-input');
  input.value = '';
  const names = String(raw).split(/[,;\n]+/).map((s) => s.replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean);
  const [next, n] = mergeList(form.brands, names);
  if (!n) return;
  form.brands = next;
  changedLight();
  renderBrands();
}

// ---------- Presentaciones ----------
function renderPres() {
  const d = store.drugs.get(curId);
  const rd = $('#drug-wrap').classList.contains('reading');
  const list = rd ? (d.presentations || []) : [];
  $('#drug-pres-list').replaceChildren(...(rd ? (list.length ? list.map((p) => el('li', {}, p)) : [el('li', { class: 'muted small empty' }, 'Sin presentaciones')]) : []));
  $('#drug-pres-list').classList.toggle('hidden', !rd);
  $('#drug-pres').classList.toggle('hidden', rd);
  $('#drug-pres-dl').replaceChildren(...presList().map((p) => el('option', { value: p })));
}
const presList = () => $('#drug-pres').value.split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);

// ---------- Pautas ----------
function renderRegs() {
  const d = store.drugs.get(curId);
  const rd = $('#drug-wrap').classList.contains('reading');
  const box = $('#drug-regs');
  const name = rd ? d.name : $('#drug-title').value.trim();
  const regs = rd ? (d.regimens || []) : form.regimens;
  $('#drug-add-reg').classList.toggle('hidden', rd);
  if (!regs.length) {
    box.replaceChildren(el('p', { class: 'muted small' }, rd ? 'Sin pautas. Pulsa «Editar» para añadir la primera.' : 'Añade una pauta por indicación (p. ej. «Dolor agudo · IV · 50 mg · cada 8 h»).'));
    return;
  }
  box.replaceChildren(...regs.map((r, i) => (rd ? regView(name, r) : regForm(r, i, regs.length))));
}

function regView(name, r) {
  const line = lineOf(name, r);
  return el('div', { class: 'reg' },
    el('div', { class: 'reg-head' }, el('b', {}, r.indication || 'Pauta'), el('span', { class: 'reg-sum' }, regSummary(r))),
    el('div', { class: 'reg-line' }, el('span', { class: 'reg-txt' }, line),
      el('button', { class: 'btn sm primary reg-copy', type: 'button', title: 'Copiar para el informe', 'aria-label': `Copiar: ${line}`, onclick: (e) => copyLine(lineOf(store.drugs.get(curId)?.name, r), e.currentTarget) },
        icon('copy'), el('span', { class: 'lbl' }, ' Copiar'))));
}

function regForm(r, i, total) {
  const lineBox = el('textarea', { class: 'reg-line-edit', rows: 2, placeholder: 'Línea para el informe' });
  const regen = el('button', { class: 'btn sm', type: 'button', title: 'Volver a generar la línea a partir de los campos' }, '↺ Generar de los campos');
  const sync = () => {
    if (r.lineAuto !== false) lineBox.value = genLine($('#drug-title').value.trim(), r);
    regen.classList.toggle('hidden', r.lineAuto !== false);
  };
  lineBox.addEventListener('input', () => { r.lineAuto = false; r.line = lineBox.value; regen.classList.remove('hidden'); changedLight(); });
  regen.addEventListener('click', () => { r.lineAuto = true; r.line = ''; sync(); changedLight(); });
  const fields = REG_FIELDS.map(([k, label, ph]) => {
    const inp = el('input', { type: 'text', value: r[k] || '', placeholder: ph, autocomplete: 'off', maxlength: k === 'indication' ? 200 : 120,
      list: k === 'route' ? 'drug-route-dl' : k === 'freq' ? 'drug-freq-dl' : k === 'pres' ? 'drug-pres-dl' : null });
    inp.addEventListener('input', () => { r[k] = inp.value; sync(); changedLight(); });
    return el('label', { class: `rf rf-${k}` }, label, inp);
  });
  sync();
  const mv = (dir) => { const a = form.regimens; [a[i], a[i + dir]] = [a[i + dir], a[i]]; changedLight(); renderRegs(); };
  return el('div', { class: 'reg reg-edit' },
    el('div', { class: 'reg-tools' }, el('b', {}, `Pauta ${i + 1}`), el('span', { class: 'spacer' }),
      i > 0 ? el('button', { class: 'icon-btn', type: 'button', title: 'Subir', 'aria-label': 'Subir', onclick: () => mv(-1) }, icon('arrow-up')) : null,
      i < total - 1 ? el('button', { class: 'icon-btn', type: 'button', title: 'Bajar', 'aria-label': 'Bajar', onclick: () => mv(1) }, icon('arrow-down')) : null,
      el('button', { class: 'icon-btn', type: 'button', title: 'Quitar esta pauta', 'aria-label': 'Quitar esta pauta', onclick: async () => {
        if (!await confirm('Quitar pauta', `¿Quitar «${r.indication || `Pauta ${i + 1}`}»?`, { okLabel: 'Quitar', danger: true })) return;
        form.regimens.splice(i, 1); changedLight(); renderRegs();
      } }, icon('trash-2'))),
    el('div', { class: 'reg-grid' }, fields),
    el('label', { class: 'rf rf-line' }, el('span', {}, 'Línea para el informe', el('span', { class: 'muted small' }, ' (se genera sola; puedes retocarla)')), lineBox),
    el('div', { class: 'reg-actions' }, regen,
      el('button', { class: 'btn sm primary reg-copy', type: 'button', onclick: (e) => copyLine(lineBox.value, e.currentTarget) }, icon('copy'), ' Copiar')));
}

function addRegimen() {
  form.regimens.push({ id: regId(), indication: '', pres: '', route: '', dose: '', freq: '', duration: '', max: '', line: '', lineAuto: true });
  changedLight();
  renderRegs();
  const last = $('#drug-regs').lastElementChild;
  last?.querySelector('input')?.focus();
  last?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- Aparece en estas notas ----------
function renderBacklinks() {
  const id = curId;
  const back = liveNotes().filter((n) => (Array.isArray(n.drugs) ? n.drugs.includes(id) : typeof n.html === 'string' && n.html.includes(`data-drug="${id}"`)))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  $('#drug-backlinks').classList.toggle('hidden', !back.length);
  $('#drug-backlink-list').replaceChildren(...back.map((n) => el('button', { class: 'chip', type: 'button', onclick: () => { saveSoon.flush(); ctx.openNote(n.id); } }, icon('notebook-text'), ` ${n.title || 'Sin título'}`)));
}
export function refreshDrugBacklinks() { if (curId) renderBacklinks(); }

// ---------- Guardar ----------
function changedLight() {
  if (!curId) return;
  dirtyLight = true;
  $('#drug-status').textContent = 'Editando…';
  saveSoon();
}
const saveSoon = debounce(saveNow, 700);
export const flushDrug = () => saveSoon.flush();

function saveNow() {
  if (!curId || (!dirtyLight && !dirtyBody)) return;
  const d = store.drugs.get(curId);
  if (!d || d.trashed) { dirtyLight = dirtyBody = false; return; }
  const light = { updatedAt: Date.now() };
  if (dirtyLight) {
    Object.assign(light, {
      name: $('#drug-title').value.replace(/\s+/g, ' ').trim(),
      brands: [...form.brands], presentations: presList(),
      regimens: form.regimens.map((r) => ({ ...r, line: r.lineAuto === false ? String(r.line || '') : '' }))
    });
  }
  let body = null;
  if (dirtyBody && bodyReady) {
    const html = editor.getContent();
    if (html.length > 800000) { toast('«Mis notas» es demasiado larga (máx. ~800 KB). Divídela en una nota aparte.', 'error', 6000); return; }
    body = { html, text: editor.getText() };
    loadedHtml = html;
  }
  dirtyLight = false; dirtyBody = false;
  writeDrug(d.id, light, body);
  $('#drug-status').textContent = navigator.onLine ? 'Guardado ✓' : 'Guardado en el dispositivo';
  renderInfo(d);
  ctx.renderList();
}

/** Del editor de «Mis notas» (app.js lo crea con createEditor) */
export function onDrugEditorChange() {
  if (!curId || reading || !bodyReady) return;
  dirtyBody = true;
  $('#drug-status').textContent = 'Editando…';
  saveSoon();
}
export const drugImageOwner = () => curId;

/** Cambios llegados de otro dispositivo (o de la importación) */
export function onDrugsChange(changed) {
  if (!curId) return;
  const d = store.drugs.get(curId);
  if (!d) { curId = null; reading = false; ctx.showPane('empty'); ctx.pushHash(true); return; }
  if (changed && !changed.has(curId)) { renderChrome(); return; }
  const editing = dirtyLight || dirtyBody || $('#drug-wrap').contains(document.activeElement) && document.activeElement !== document.body;
  if (editing && !reading) { renderInfo(d); return; }
  const b = drugBodyOf(curId);
  if (!b || b.html !== loadedHtml) { const sc = $('#drug-scroll').scrollTop; fillForm(d); $('#drug-scroll').scrollTop = sc; return; }
  form = { brands: [...(d.brands || [])], regimens: clone(d.regimens || []) };
  if ($('#drug-title').value !== (d.name || '')) { $('#drug-title').value = d.name || ''; fitTitle($('#drug-title')); }
  $('#drug-pres').value = (d.presentations || []).join('\n');
  renderChrome();
}

// ---------- Papelera ----------
function trashDrug(id) {
  if (curId === id) saveSoon.flush();
  const d = store.drugs.get(id);
  if (!d) return;
  d.trashed = true; d.trashedAt = Date.now();
  patch('drugs', id, { trashed: true, trashedAt: d.trashedAt });
  toast('Movido a la papelera del Vademécum', 'ok');
  if (curId === id) { closeDrug(); ctx.showPane('empty'); ctx.showList(); }
  ctx.renderList(); ctx.renderSidebar();
}
function restoreDrug(id) {
  const d = store.drugs.get(id);
  if (!d) return;
  const folderOk = !d.folderId || DF().has(d.folderId);
  d.trashed = false; d.trashedAt = null; if (!folderOk) d.folderId = null;
  patch('drugs', id, { trashed: false, trashedAt: null, folderId: d.folderId || null });
  toast('Fármaco restaurado', 'ok');
  if (curId === id) renderChrome();
  ctx.renderList(); ctx.renderSidebar();
}
function purge(id) {
  ctx.purgeDrugFiles(id); // imágenes de «Mis notas» que ya no usa nadie (antes de quitarlo de la memoria)
  deleteDrugDocs(id);
}
async function deleteForever(id) {
  if (!await confirm('Eliminar definitivamente', 'La ficha y sus imágenes se borrarán para siempre. No se puede deshacer.', { okLabel: 'Eliminar', danger: true })) return;
  if (curId === id) { dirtyLight = dirtyBody = false; saveSoon.cancel(); closeDrug(); ctx.showPane('empty'); ctx.showList(); }
  purge(id);
  ctx.renderList(); ctx.renderSidebar();
}
export async function emptyDrugTrash() {
  const list = [...store.drugs.values()].filter((d) => d.trashed);
  if (!list.length) return;
  if (!await confirm('Vaciar papelera del Vademécum', `Se borrarán para siempre ${list.length} ficha(s). No se puede deshacer.`, { okLabel: 'Vaciar', danger: true })) return;
  if (curId && list.some((d) => d.id === curId)) { closeDrug(); ctx.showPane('empty'); }
  list.forEach((d) => purge(d.id));
  toast('Papelera vacía', 'ok');
  ctx.renderList(); ctx.renderSidebar();
}

async function duplicateDrug(id) {
  saveSoon.flush();
  const d = store.drugs.get(id);
  if (!d) return;
  let b;
  try { b = await loadDrugBody(id); } catch { toast('Sin conexión: no se puede duplicar esta ficha ahora', 'error'); return; }
  const nid = newId('drugs');
  const now = Date.now();
  const light = { ...blankDrug({ name: `${d.name || 'Sin nombre'} (copia)`, folderId: d.folderId, now, reviewed: d.reviewed !== false }),
    brands: [...(d.brands || [])], presentations: [...(d.presentations || [])], regimens: clone(d.regimens || []).map((r) => ({ ...r, id: regId() })) };
  writeDrug(nid, light, b.html ? { html: b.html, text: b.text } : null);
  openDrug(nid, { push: true });
}

// ====================== Arranque ======================
export function initDrugs(appCtx) {
  ctx = appCtx;
  editor = ctx.editor;
  $('#drug-title').addEventListener('input', () => { changedLight(); if (!reading) renderRegsLines(); });
  $('#drug-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#drug-brand-input').focus(); } });
  const bi = $('#drug-brand-input');
  bi.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addBrands(bi.value); }
    if (e.key === 'Backspace' && !bi.value && form?.brands.length) { form.brands.pop(); changedLight(); renderBrands(); }
  });
  bi.addEventListener('blur', () => { if (bi.value.trim()) addBrands(bi.value); });
  $('#drug-pres').addEventListener('input', () => { changedLight(); $('#drug-pres-dl').replaceChildren(...presList().map((p) => el('option', { value: p }))); });
  $('#drug-add-reg').addEventListener('click', addRegimen);
  $('#drug-route-dl').replaceChildren(...ROUTES.map((v) => el('option', { value: v })));
  $('#drug-freq-dl').replaceChildren(...FREQS.map((v) => el('option', { value: v })));
  $('#drug-back').addEventListener('click', () => {
    if (history.state?.nt && history.state?.d > 0) { saveSoon.flush(); history.back(); return; }
    closeDrug(); ctx.showPane('empty'); ctx.showList(); ctx.renderList();
  });
  $('#drug-edit').addEventListener('click', () => setReading(!reading));
  $('#drug-font-down').addEventListener('click', () => ctx.fontStep(-1));
  $('#drug-font-up').addEventListener('click', () => ctx.fontStep(1));
  $('#drug-fav').addEventListener('click', () => { if (curId) toggleFavorite(curId); });
  $('#drug-folder').addEventListener('click', () => { saveSoon.flush(); if (curId) moveDrug(curId); });
  $('#drug-menu').addEventListener('click', (e) => { const d = store.drugs.get(curId); if (d) drugItemMenu(e.currentTarget, d, { inList: false }); });
  $('#drug-reviewed').addEventListener('click', () => { if (curId) { saveSoon.flush(); setReviewed(curId, true); } });
  $('#drug-restore').addEventListener('click', () => { if (curId) restoreDrug(curId); });
  $('#drug-delete-forever').addEventListener('click', () => { if (curId) deleteForever(curId); });
  // Móvil: la barra de formato solo se ve mientras escribes en «Mis notas»
  const content = $('#drug-content');
  let t = null;
  content.addEventListener('focusin', () => { clearTimeout(t); $('#drug-wrap').classList.add('notes-focus'); });
  content.addEventListener('focusout', () => { clearTimeout(t); t = setTimeout(() => { if (!editor.isFocused()) $('#drug-wrap').classList.remove('notes-focus'); }, 250); });
}
/** Al cambiar el nombre, las líneas automáticas de las pautas se actualizan */
function renderRegsLines() {
  const name = $('#drug-title').value.trim();
  const boxes = [...document.querySelectorAll('#drug-regs .reg-edit')];
  boxes.forEach((b, i) => { const r = form?.regimens[i]; if (r && r.lineAuto !== false) b.querySelector('.reg-line-edit').value = genLine(name, r); });
}
