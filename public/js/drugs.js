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
  drugBodyOf, loadDrugBody, writeDrug, deleteDrugDocs, parseDrugImport, mergeList, regKey, hasDetail, EXTRA_LISTS, presBrandsOf,
  baseKey, drugByBase, withForm, duplicateGroups, mergeGroupLight, mergePres
} from './drugbody.js';
import {
  SCOPES, scopeName, FLUIDS, REG_TYPES, regType, typeSlug, parseChuletario, CHULETARIO_SOURCE
} from './chuletario.js';

const str = (x) => (x == null ? '' : String(x));
let ctx = null;          // ayudas de app.js
let editor = null;       // editor de «Mis notas» (createEditor, el mismo de las notas)
let curId = null;        // ficha abierta
let reading = false;     // modo lectura (como las notas)
let bodyReady = false;   // «Mis notas» cargada (si no, no se edita ni se guarda)
let dirtyLight = false;  // nombre, marcas, presentaciones o pautas sin guardar
let dirtyBody = false;   // «Mis notas» sin guardar
let loadedHtml = '';
let form = null;         // copia editable de la ficha abierta { brands, pres: [{p, b}], regimens, fluids, scopes, source }
const LISTS = ['observations', 'contraindications', 'compat'];
const formOf = (d) => ({
  brands: [...(d.brands || [])], regimens: clone(d.regimens || []), fluids: [...(d.fluids || [])], scopes: [...(d.scopes || [])],
  source: { text: d.source?.text || '', url: d.source?.url || '' },
  pres: (d.presentations || []).map((p) => ({ p, b: [...presBrandsOf(d, p)] }))
});
const isRd = () => $('#drug-wrap').classList.contains('reading');
const listBox = (k) => document.querySelector(`#drug-wrap textarea.dlist-edit[data-list="${k}"]`);
const listVals = (k) => listBox(k).value.split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
function fillLists(d) { for (const k of LISTS) listBox(k).value = (d[k] || []).join('\n'); }

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
  const live = liveDrugs().filter(scopeOk);
  if (type === 'dfav') return live.filter((d) => d.favorite).sort(byName);
  if (type === 'drecent') return live.filter((d) => d.lastViewedAt).sort((a, b) => (b.lastViewedAt || 0) - (a.lastViewedAt || 0)).slice(0, 50);
  if (type === 'dreview') return live.filter((d) => d.reviewed === false).sort(byName);
  return live.sort(byName);
}

// Filtro por ámbito (v1.22.0): '' = todos | 'ap' | 'urg' | 'mont' (por dispositivo). Las fichas sin ámbito solo salen en «Todos».
export const drugScope = () => { const v = localStorage.getItem('drfolio.drugScope') || ''; return SCOPES.some(([k]) => k === v) ? v : ''; };
export function setDrugScope(v) { localStorage.setItem('drfolio.drugScope', v || ''); }
export const scopeOk = (d) => !drugScope() || (d.scopes || []).includes(drugScope());

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
    here ? { icon: 'clipboard-paste', label: 'Pegar del Chuletario…', onClick: () => pasteChuletario({ targetId: d.id }) } : null,
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
  if (d.fluids?.length) out.push(`Sueros: ${d.fluids.join(', ')}`);
  if (d.presentations?.length) out.push('', 'Presentaciones:', ...d.presentations.map((p) => { const b = presBrandsOf(d, p); return `- ${p}${b.length ? ` (${b.join(', ')})` : ''}`; }));
  if (d.regimens?.length) {
    out.push('', 'Indicaciones:');
    for (const r of d.regimens) {
      out.push(`- ${[r.indication, r.type ? `[${r.type}]` : '', hasDetail(r) ? regSummary(r) : ''].filter(Boolean).join(' ')}`);
      if (r.text) out.push(`  ${r.text.replace(/\n/g, '\n  ')}`);
      if (hasDetail(r) || r.lineAuto === false) out.push(`  ${lineOf(d.name, r)}`);
    }
  }
  for (const [k, t] of [['observations', 'Observaciones'], ['contraindications', 'Contraindicaciones'], ['compat', 'Compatibilidad en Y']]) {
    if (d[k]?.length) out.push('', `${t}:`, ...d[k].map((x) => `- ${x}`));
  }
  if (d.source?.text || d.source?.url) out.push('', `Fuente: ${[d.source.text, d.source.url].filter(Boolean).join(' · ')}`);
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
  const plan = { create: [], merge: [], same: [], matched: [] }; // matched = [{d, it}] (para «Reemplazar»)
  const seen = new Map(); // nombre → entrada (fármacos repetidos dentro del mismo archivo: se juntan)
  for (const it of items) {
    const k = baseKey(it.name) || drugKey(it.name); // mismo principio activo = misma ficha (v1.24.0)
    if (seen.has(k)) {
      const a = seen.get(k);
      it.regimens = withForm(it.regimens, it.name, a.name);
      a.brands = mergeList(a.brands, it.brands)[0];
      a.presentations = mergeList(a.presentations, it.presentations)[0];
      for (const f of EXTRA_LISTS) a[f] = mergeList(a[f], it[f])[0];
      a.presBrands = [...(a.presBrands || []), ...(it.presBrands || [])];
      if (!a.source?.text && !a.source?.url) a.source = it.source;
      const keys = new Set(a.regimens.map(regKey));
      a.regimens.push(...it.regimens.filter((r) => !keys.has(regKey(r))));
      if (!a.notes && it.notes) a.notes = it.notes;
      continue;
    }
    seen.set(k, it);
  }
  for (const it of seen.values()) {
    const d = drugByName(it.name) || drugByBase(it.name);
    if (!d) { plan.create.push(it); continue; }
    it.regimens = withForm(it.regimens, it.name, d.name);
    plan.matched.push({ d, it });
    const [brands, nb] = mergeList(d.brands, it.brands);
    const presentations = mergePres(d.presentations, it.presentations);
    const np = presentations.length - (d.presentations || []).length;
    const keys = new Set((d.regimens || []).map(regKey));
    const newRegs = it.regimens.filter((r) => !keys.has(regKey(r)));
    const notes = !(d.bodyAt > 0) && it.notes.trim() ? it.notes : '';
    const ex = completeExtras(d, it);
    if (!nb && !np && !newRegs.length && !notes && !ex.n) { plan.same.push(d); continue; }
    plan.merge.push({ d, light: { brands, presentations, regimens: [...(d.regimens || []), ...newRegs], ...ex.light }, notes, added: { nb, np, nr: newRegs.length, notes: !!notes, ne: ex.n } });
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
    // v1.24.0: con fichas que ya existen, elegir Completar (añade sin borrar) o Reemplazar (las deja como en el archivo)
    let mode = 'merge';
    const radio = (v, label, sub) => el('label', { class: 'imp-mode' },
      el('input', { type: 'radio', name: 'imp-mode', value: v, checked: v === 'merge', onchange: () => { mode = v; } }),
      el('span', { class: 'imp-mode-txt' }, el('b', {}, label), el('span', { class: 'muted small' }, sub)));
    const modeBox = !template && plan.matched.length ? el('div', { class: 'imp-modes' },
      el('p', { class: 'small' }, `${plan.matched.length} ficha(s) ya existen. ¿Qué hago con ellas?`),
      radio('merge', 'Completar', 'añade lo que falte, sin borrar nada'),
      radio('replace', 'Reemplazar', 'presentaciones, indicaciones, sueros, observaciones, contraindicaciones y ámbito quedan como en el archivo; se conservan carpeta, favorito, nombres comerciales y «Mis notas»')) : null;
    const ok = await modal({
      title: template ? 'Plantilla de carpetas' : 'Importar fichas',
      body: [
        el('p', { class: 'muted small' }, fileName),
        template ? el('p', {}, `${tops.size} grupos, ${paths.size} subcarpetas (las que ya tengas se aprovechan) y ${items.length} fármacos con sus nombres comerciales principales. No se borra ni cambia nada de lo que ya tengas.`) : null,
        el('table', { class: 'bk-table' }, el('tbody', {},
          el('tr', {}, el('td', {}, 'Fichas nuevas'), el('td', {}, String(plan.create.length))),
          el('tr', {}, el('td', {}, 'Ya existen: se completan'), el('td', {}, String(plan.merge.length))),
          el('tr', {}, el('td', {}, 'Ya existen: sin cambios'), el('td', {}, String(plan.same.length))))),
        modeBox,
        list(plan.create, (x) => x.name),
        plan.merge.length ? el('p', { class: 'small' }, 'Se añade a las fichas que ya tienes (sin borrar ni cambiar nada de lo que hay):') : null,
        list(plan.merge, (m) => `${m.d.name}: ${[m.added.nb ? `${m.added.nb} nombre(s) comercial(es)` : '', m.added.np ? `${m.added.np} presentación(es)` : '', m.added.nr ? `${m.added.nr} pauta(s)` : '', m.added.notes ? 'notas' : '', m.added.ne ? 'datos de la ficha (embarazo, sueros, observaciones…)' : ''].filter(Boolean).join(', ')}`),
        el('p', { class: 'bk-warn' }, '⚠ Las fichas nuevas o completadas quedan marcadas «Pendiente de revisar» hasta que pulses «✓ Revisada» en cada una. Comprueba las dosis antes de usarlas.'),
        el('p', { class: 'muted small' }, `Las nuevas van a ${folderId ? `«${DF().get(folderId)?.name || 'carpeta'}»` : 'la raíz del Vademécum'} (o a la carpeta que indique el archivo).`)
      ],
      actions: [{ label: 'Cancelar' }, { label: 'Importar', primary: true, value: true, onClick: () => (plan.create.length || plan.merge.length || mode === 'replace' ? true : (toast('No hay nada nuevo que importar', 'ok'), false)) }]
    });
    if (!ok) return;
    const ops = plan.create.reduce((s, it) => s + 1 + (it.notes.trim() ? 1 : 0), 0) + (mode === 'replace' ? plan.matched.length * 2 : plan.merge.reduce((s, m) => s + 1 + (m.notes ? 1 : 0), 0)) + 20;
    if (budget().w < ops) { toast('Hoy ya casi no quedan escrituras del plan gratuito. Importa mañana.', 'error', 6000); return; }
    let batch = writeBatch(db), n = 0;
    const flush = () => { if (n >= 300) { commitBatch(batch); batch = writeBatch(db); n = 0; } };
    const created = [];
    const now = Date.now();
    for (const it of plan.create) {
      const id = newId('drugs');
      const fid = it.folder.length ? folderFor(it.folder, null, batch, created) : folderId;
      const light = { ...blankDrug({ name: it.name, folderId: fid, now, reviewed: false }), brands: it.brands, presentations: it.presentations, regimens: it.regimens, importedAt: now, ...extrasOf(it) };
      writeDrug(id, light, it.notes.trim() ? { html: textToHtml(it.notes), text: it.notes } : null, batch, { commit: false });
      n += 2; flush();
    }
    if (mode === 'replace') {
      for (const { d, it } of plan.matched) {
        const light = {
          brands: mergeList(d.brands, it.brands)[0], presentations: [...it.presentations], presBrands: [...(it.presBrands || [])], regimens: [...it.regimens],
          reviewed: false, importedAt: now, updatedAt: now
        };
        for (const f of EXTRA_LISTS) light[f] = [...(it[f] || [])];
        if (it.source?.text || it.source?.url) light.source = { ...it.source };
        const notes = !(d.bodyAt > 0) && it.notes.trim() ? it.notes : '';
        writeDrug(d.id, light, notes ? { html: textToHtml(notes), text: notes } : null, batch, { commit: false });
        n += 2; flush();
      }
    } else for (const m of plan.merge) {
      writeDrug(m.d.id, { ...m.light, reviewed: false, importedAt: now, updatedAt: now }, m.notes ? { html: textToHtml(m.notes), text: m.notes } : null, batch, { commit: false });
      n += 2; flush();
    }
    commitBatch(batch);
    addQuota(ops - 20, 0);
    toast(`Importado: ${plan.create.length} nueva(s), ${mode === 'replace' ? `${plan.matched.length} reemplazada(s)` : `${plan.merge.length} completada(s)`}${created.length ? `, ${created.length} carpeta(s)` : ''}`, 'ok', 4500);
    if (template) put('settings', 'vademecum', { templateVersion: TEMPLATE_VERSION, updatedAt: Date.now() });
    if (curId && plan.matched.some((m) => m.d.id === curId)) fillForm(store.drugs.get(curId));
    ctx.renderList(); ctx.renderSidebar();
  }
}

// ====================== Unir fichas del mismo principio activo (v1.24.0) ======================
export const duplicateCount = () => (store.loaded.drugs ? duplicateGroups().length : 0);
const escHtml = (t) => str(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export async function mergeDuplicates() {
  const groups = duplicateGroups();
  if (!groups.length) { toast('No hay fichas repetidas: cada principio activo tiene una sola ficha ✓', 'ok'); return; }
  const checks = groups.map(() => el('input', { type: 'checkbox', checked: true }));
  const ok = await modal({
    title: 'Unir fichas repetidas',
    body: [
      el('p', {}, `${groups.length} principio(s) activo(s) tienen más de una ficha. Se deja una por principio activo con todo lo de las demás:`),
      el('ul', { class: 'imp-list dup-list' }, groups.map((g, i) => el('li', {}, el('label', {}, checks[i], ' ', el('b', {}, g.name), el('span', { class: 'muted' }, ` ← ${g.items.map((d) => d.name).join(' + ')}`))))),
      el('p', { class: 'muted small' }, 'Se juntan nombres comerciales, presentaciones, indicaciones (con la forma: «· transdérmico», «· tópico»…), observaciones, contraindicaciones y «Mis notas». La ficha que se queda conserva su carpeta. Las otras van a la papelera del Vademécum y sus enlaces desde las notas abren la que se queda.')
    ],
    actions: [{ label: 'Cancelar' }, { label: 'Unir', primary: true, value: true }]
  });
  if (!ok) return;
  const chosen = groups.filter((g, i) => checks[i].checked);
  if (!chosen.length) return;
  if (budget().w < chosen.length * 4 + 20) { toast('Hoy ya casi no quedan escrituras del plan gratuito. Inténtalo mañana.', 'error', 6000); return; }
  saveSoon.flush();
  const batch = writeBatch(db);
  const now = Date.now();
  let n = 0, skipped = 0;
  for (const g of chosen) {
    const { light, others, notesFrom } = mergeGroupLight(g, regId);
    let body = null;
    if (notesFrom.some((d) => d !== g.keep)) {
      try {
        const parts = [];
        for (const d of notesFrom) {
          const b = await loadDrugBody(d.id);
          if (!b?.html?.trim()) continue;
          parts.push(d === g.keep ? b.html : `<h3>${escHtml(d.name)}</h3>${b.html}`);
        }
        const html = parts.join('');
        body = { html, text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
      } catch { skipped++; continue; } // sin conexión: sus notas no se pueden juntar → se deja para luego
    }
    writeDrug(g.keep.id, { ...light, updatedAt: now }, body, batch, { commit: false });
    for (const d of others) {
      const x = { trashed: true, trashedAt: now, mergedInto: g.keep.id, updatedAt: now };
      batch.set(ref('drugs', d.id), x, { merge: true });
      Object.assign(d, x);
    }
    n++;
  }
  if (!n) { toast('No se pudo unir: hace falta conexión para juntar «Mis notas».', 'error', 5000); return; }
  await commitBatch(batch);
  addQuota(chosen.length * 4, 0);
  toast(`Unidas: ${n} ficha(s) por principio activo${skipped ? ` · ${skipped} pendiente(s) (sin conexión)` : ''}`, 'ok', 4500);
  if (curId && store.drugs.get(curId)?.mergedInto) openDrug(curId, { fromHash: true });
  else if (curId) fillForm(store.drugs.get(curId));
  ctx.renderList(); ctx.renderSidebar();
}

// ====================== Ficha ======================
export function openDrug(id, { push = false, focusTitle = false, fromHash = false } = {}) {
  let d = store.drugs.get(id);
  // Ficha unida a otra (mismo principio activo, v1.24.0): los enlaces antiguos abren la que se quedó
  if (d?.trashed && d.mergedInto && store.drugs.get(d.mergedInto) && !store.drugs.get(d.mergedInto).trashed) { id = d.mergedInto; d = store.drugs.get(id); }
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
  form = formOf(d);
  fillLists(d);
  $('#drug-title').value = d.name || '';
  requestAnimationFrame(() => fitTitle($('#drug-title')));
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
  renderScopes();
  renderFluids();
  renderPres();
  renderRegs();
  renderLists();
  renderSource();
  applySections();
  renderBacklinks();
  renderInfo(d);
}

// ---------- Ámbito: Atención Primaria / Urgencias / Rescate de montaña ----------
function renderScopes() {
  const d = store.drugs.get(curId);
  const box = $('#drug-scopes');
  if (isRd()) {
    const cur = d.scopes || [];
    box.classList.toggle('hidden', !cur.length);
    box.replaceChildren(...cur.map((k) => el('span', { class: `scope-chip sc-${k}` }, scopeName(k))));
    return;
  }
  box.classList.remove('hidden');
  box.replaceChildren(el('span', { class: 'drug-lbl' }, 'Ámbito'), ...SCOPES.map(([k, name]) => {
    const on = form.scopes.includes(k);
    return el('button', { type: 'button', class: `scope-chip sc-${k} toggle ${on ? 'on' : ''}`, 'aria-pressed': String(on), onclick: () => {
      const i = form.scopes.indexOf(k);
      if (i >= 0) form.scopes.splice(i, 1); else form.scopes.push(k);
      changedLight(); renderScopes();
    } }, on ? icon('check') : null, name);
  }));
}

// ---------- Sueros compatibles (chips) ----------
function renderFluids() {
  const d = store.drugs.get(curId);
  const box = $('#drug-fluids');
  const rd = isRd();
  const cur = rd ? (d.fluids || []) : form.fluids;
  box.classList.toggle('hidden', rd && !cur.length);
  const chips = cur.map((f, i) => el('span', { class: 'fluid-chip' }, icon('droplet'), f,
    rd ? null : el('button', { class: 'x', type: 'button', 'aria-label': `Quitar ${f}`, onclick: () => { form.fluids.splice(i, 1); changedLight(); renderFluids(); } }, '×')));
  let input = null;
  if (!rd) {
    input = el('input', { list: 'drug-fluid-dl', placeholder: '＋ suero (SSF, SG5 %…)', autocomplete: 'off', maxlength: 40, enterkeyhint: 'done' });
    const add = () => {
      const v = input.value.split(/[,;]+/).map((x) => x.trim()).filter(Boolean);
      input.value = '';
      const [next, n] = mergeList(form.fluids, v);
      if (n) { form.fluids = next; changedLight(); renderFluids(); $('#drug-fluids input')?.focus(); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
    input.addEventListener('change', () => { if (input.value.trim()) add(); });
  }
  box.replaceChildren(...[el('span', { class: 'drug-lbl' }, 'Sueros:'), el('div', { class: 'chips' }, ...chips), input].filter(Boolean));
}

// ---------- Observaciones, contraindicaciones, compatibilidad en Y ----------
function renderLists() {
  const d = store.drugs.get(curId);
  const rd = isRd();
  for (const k of LISTS) {
    const items = d[k] || [];
    const ul = document.querySelector(`#drug-wrap ul.dlist[data-list="${k}"]`);
    ul.replaceChildren(...items.map((x) => el('li', {}, x)));
    ul.classList.toggle('hidden', !rd);
    listBox(k).classList.toggle('hidden', rd);
    ul.closest('details').classList.toggle('hidden', rd && !items.length);
  }
}

// ---------- Fuente ----------
function renderSource() {
  const d = store.drugs.get(curId);
  const box = $('#drug-source');
  if (isRd()) {
    const s = d.source || {};
    box.classList.toggle('hidden', !s.text && !s.url);
    box.replaceChildren(...(s.text || s.url ? [el('span', { class: 'muted' }, 'Fuente: '),
      s.url ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.text || s.url) : el('span', {}, s.text)] : []));
    return;
  }
  box.classList.remove('hidden');
  const t = el('input', { type: 'text', placeholder: 'Fuente (p. ej. Chuletario de Urgencias · C. M. Prados Arredondo)', value: form.source.text, maxlength: 200, oninput: (e) => { form.source.text = e.target.value; changedLight(); } });
  const u = el('input', { type: 'url', placeholder: 'https://…', value: form.source.url, maxlength: 500, oninput: (e) => { form.source.url = e.target.value.trim(); changedLight(); } });
  box.replaceChildren(el('div', { class: 'src-edit' }, el('label', { class: 'rf' }, 'Fuente', t), el('label', { class: 'rf' }, 'Enlace', u)));
}

// ---------- Secciones plegables (se recuerda en este dispositivo si están abiertas) ----------
const SEC_KEY = 'drfolio.drugSecs';
const secState = () => { try { return JSON.parse(localStorage.getItem(SEC_KEY)) || {}; } catch { return {}; } };
function applySections() {
  const st = secState();
  const d = store.drugs.get(curId);
  for (const det of document.querySelectorAll('#drug-wrap details.dsec')) {
    det.open = isRd() ? st[det.dataset.sec] !== false : true;
    if (det.dataset.sec === 'pres') det.classList.toggle('hidden', isRd() && !(d?.presentations || []).length);
  }
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
  if (!rd) renderPres(); // las marcas se pueden asignar a cada presentación
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
  if (!d || !form) return;
  const rd = isRd();
  const list = $('#drug-pres-list');
  list.classList.toggle('hidden', !rd);
  $('#drug-pres-rows').classList.toggle('hidden', rd);
  $('#drug-add-pres').classList.toggle('hidden', rd);
  // Lectura: cada presentación con sus marcas debajo (p. ej. 37,5/325 mg comp · Zaldiar · Pazital)
  if (rd) list.replaceChildren(...(d.presentations || []).map((p) => {
    const b = presBrandsOf(d, p);
    return el('span', { class: `pres-chip ${b.length ? 'has-brands' : ''}` }, el('span', {}, p), b.length ? el('span', { class: 'pres-brands' }, b.join(' · ')) : null);
  }));
  else $('#drug-pres-rows').replaceChildren(...form.pres.map(presRow));
  $('#drug-pres-dl').replaceChildren(...presList().map((p) => el('option', { value: p })));
}
/** Fila editable: presentación + marcas que la tienen (toca una marca para asignarla) */
function presRow(row, i) {
  const inp = el('input', { type: 'text', value: row.p, placeholder: 'p. ej. 37,5/325 mg comp · 1 amp = 1 mL = 1 mg', maxlength: 150, autocomplete: 'off', 'aria-label': `Presentación ${i + 1}` });
  inp.addEventListener('input', () => { row.p = inp.value; changedLight(); });
  inp.addEventListener('change', () => $('#drug-pres-dl').replaceChildren(...presList().map((p) => el('option', { value: p }))));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addPres(); } });
  const chips = form.brands.map((b) => {
    const on = row.b.includes(b);
    return el('button', { type: 'button', class: `chip toggle ${on ? 'on' : ''}`, 'aria-pressed': String(on), title: on ? `Quitar ${b}` : `Esta presentación es de ${b}`,
      onclick: () => { const k = row.b.indexOf(b); if (k >= 0) row.b.splice(k, 1); else row.b.push(b); changedLight(); renderPres(); } }, on ? icon('check') : null, b);
  });
  return el('div', { class: 'pres-row' },
    el('div', { class: 'pres-row-top' }, inp,
      el('button', { class: 'icon-btn', type: 'button', title: 'Quitar esta presentación', 'aria-label': 'Quitar esta presentación', onclick: () => { form.pres.splice(i, 1); changedLight(); renderPres(); } }, icon('x'))),
    form.brands.length ? el('div', { class: 'pres-row-brands' }, el('span', { class: 'muted small' }, 'Marca:'), ...chips)
      : el('div', { class: 'muted small' }, 'Añade arriba los nombres comerciales para indicar de cuál es cada presentación.'));
}
function addPres() {
  form.pres.push({ p: '', b: [] });
  changedLight();
  renderPres();
  const inputs = $('#drug-pres-rows').querySelectorAll('input');
  inputs[inputs.length - 1]?.focus();
}
const presList = () => (form?.pres || []).map((r) => String(r.p || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
/** Para guardar: solo presentaciones con nombre y marcas que sigan existiendo */
const presBrandsList = () => (form?.pres || []).map((r) => ({ p: String(r.p || '').replace(/\s+/g, ' ').trim(), b: r.b.filter((b) => form.brands.includes(b)) }))
  .filter((r) => r.p && r.b.length);

// ---------- Pautas ----------
function renderRegs() {
  const d = store.drugs.get(curId);
  const rd = $('#drug-wrap').classList.contains('reading');
  const box = $('#drug-regs');
  const name = rd ? d.name : $('#drug-title').value.trim();
  const regs = rd ? (d.regimens || []) : form.regimens;
  $('#drug-add-reg').classList.toggle('hidden', rd);
  if (!regs.length) {
    box.replaceChildren(el('p', { class: 'muted small' }, rd ? 'Sin indicaciones. Pulsa «Editar» para añadir la primera.' : 'Añade una indicación con su tipo (Bolo, Perfusión, IM…) y la dosis tal cual; los campos detallados son opcionales.'));
    return;
  }
  box.classList.toggle('reading-regs', rd);
  box.replaceChildren(...(rd ? groupRegs(regs).map((g) => regGroupView(name, g)) : regs.map((r, i) => regForm(r, i, regs.length))));
}

/** Lectura (v1.24.0): las indicaciones seguidas con el mismo título se agrupan y cada pauta es UNA fila
 *  [tipo] dosis … [copiar]. La línea del informe ya no se pinta (repetía nombre + presentación + dosis):
 *  es lo que copia el botón y se ve al dejar el ratón encima. */
function groupRegs(regs) {
  const out = [];
  for (const r of regs) {
    const k = norm(r.indication || '').trim();
    const last = out[out.length - 1];
    if (last && k && last.k === k) last.items.push(r);
    else out.push({ k, title: r.indication || '', items: [r] });
  }
  return out;
}
/** «IV lenta diluida…» → IV · «Intranasal con MAD» → Intranasal · «IM en el muslo» → IM */
function routeType(route) {
  const r = str(route).trim();
  if (!r) return '';
  if (regType(r)) return regType(r);
  const w = r.split(/[\s(/,;]+/).filter(Boolean);
  for (let n = Math.min(3, w.length); n >= 1; n--) { const t = regType(w.slice(0, n).join(' ')); if (t) return t; }
  return '';
}
function regGroupView(name, g) {
  return el('div', { class: 'regg' },
    g.title ? el('div', { class: 'regg-title' }, g.title) : null,
    ...g.items.map((r) => regView(name, r)));
}
function regView(name, r) {
  const line = lineOf(name, r);
  const type = r.type || '';
  const route = str(r.route).trim();
  const main = str(r.text).trim() || [r.dose, r.freq, r.duration].map((x) => str(x).trim()).filter(Boolean).join(' · ') || route;
  const brands = r.pres ? presBrandsOf(store.drugs.get(curId), r.pres) : [];
  const chip = type || (route.length <= 14 ? route : routeType(route) || route.split(/[\s(/,]+/)[0]);
  const nr = norm(route), nc = norm(chip);
  const routeSaid = !route || main === route || nr === nc || (nr.includes(nc.slice(0, 6)) && route.split(/\s+/).length <= 2);
  const meta = [
    routeSaid ? '' : route,
    !str(r.text).trim() && r.max ? `máx ${str(r.max).replace(/^m[aá]x(\.|imo|ima)?\s*/i, '')}` : '',
    brands.length ? `${r.pres}: ${brands.join(' · ')}` : ''
  ].filter(Boolean);
  const slug = chip ? typeSlug(type || routeType(route)) : '';
  return el('div', { class: `reg ${slug ? `t-${slug}` : ''}` },
    el('div', { class: 'reg-body' },
      el('div', { class: 'reg-main' },
        chip ? el('span', { class: `reg-type ${slug ? `t-${slug}` : ''}` }, chip) : null,
        el('span', { class: 'reg-text' }, main || line)),
      meta.length ? el('div', { class: 'reg-meta' }, meta.join(' · ')) : null,
      r.lineAuto === false && str(r.line).trim() ? el('div', { class: 'reg-meta reg-custom' }, icon('copy'), ` ${str(r.line).trim()}`) : null),
    el('button', {
      class: 'icon-btn reg-copy', type: 'button', title: `Copiar: ${line}`, 'aria-label': `Copiar: ${line}`,
      onclick: (e) => copyLine(lineOf(store.drugs.get(curId)?.name, r), e.currentTarget)
    }, icon('copy')));
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
  const mk = ([k, label, ph]) => {
    const inp = el('input', { type: 'text', value: r[k] || '', placeholder: ph, autocomplete: 'off', maxlength: k === 'indication' ? 200 : 120,
      list: k === 'route' ? 'drug-route-dl' : k === 'freq' ? 'drug-freq-dl' : k === 'pres' ? 'drug-pres-dl' : null });
    inp.addEventListener('input', () => { r[k] = inp.value; sync(); changedLight(); });
    return el('label', { class: `rf rf-${k}` }, label, inp);
  };
  const fields = [mk(REG_FIELDS[0])];
  const typeIn = el('input', { type: 'text', value: r.type || '', placeholder: 'Bolo, Perfusión, IM…', list: 'drug-type-dl', autocomplete: 'off', maxlength: 30 });
  typeIn.addEventListener('input', () => { r.type = regType(typeIn.value) || typeIn.value.trim(); changedLight(); });
  const textIn = el('textarea', { rows: 2, placeholder: 'Dosis tal cual (p. ej. 0,6-1 mg IV cada 3-5 min, máx 3 mg)' });
  textIn.value = r.text || '';
  textIn.addEventListener('input', () => { r.text = textIn.value; sync(); changedLight(); });
  fields.push(el('label', { class: 'rf rf-type' }, 'Tipo', typeIn), el('label', { class: 'rf rf-text' }, 'Dosis (texto)', textIn));
  const more = el('details', { class: 'reg-more', open: hasDetail(r) }, el('summary', {}, 'Campos detallados (opcional): vía, dosis, frecuencia, máx…'),
    el('div', { class: 'reg-grid' }, REG_FIELDS.slice(1).map(mk)));
  sync();
  const mv = (dir) => { const a = form.regimens; [a[i], a[i + dir]] = [a[i + dir], a[i]]; changedLight(); renderRegs(); };
  return el('div', { class: 'reg reg-edit' },
    el('div', { class: 'reg-tools' }, el('b', {}, `Indicación ${i + 1}`), el('span', { class: 'spacer' }),
      i > 0 ? el('button', { class: 'icon-btn', type: 'button', title: 'Subir', 'aria-label': 'Subir', onclick: () => mv(-1) }, icon('arrow-up')) : null,
      i < total - 1 ? el('button', { class: 'icon-btn', type: 'button', title: 'Bajar', 'aria-label': 'Bajar', onclick: () => mv(1) }, icon('arrow-down')) : null,
      el('button', { class: 'icon-btn', type: 'button', title: 'Quitar esta pauta', 'aria-label': 'Quitar esta pauta', onclick: async () => {
        if (!await confirm('Quitar pauta', `¿Quitar «${r.indication || `Pauta ${i + 1}`}»?`, { okLabel: 'Quitar', danger: true })) return;
        form.regimens.splice(i, 1); changedLight(); renderRegs();
      } }, icon('trash-2'))),
    el('div', { class: 'reg-grid' }, fields),
    more,
    el('label', { class: 'rf rf-line' }, el('span', {}, 'Línea para el informe', el('span', { class: 'muted small' }, ' (se genera sola; puedes retocarla)')), lineBox),
    el('div', { class: 'reg-actions' }, regen,
      el('button', { class: 'btn sm primary reg-copy', type: 'button', onclick: (e) => copyLine(lineBox.value, e.currentTarget) }, icon('copy'), ' Copiar')));
}

function addRegimen() {
  form.regimens.push({ id: regId(), indication: '', type: '', text: '', pres: '', route: '', dose: '', freq: '', duration: '', max: '', line: '', lineAuto: true });
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
      brands: [...form.brands], presentations: presList(), presBrands: presBrandsList(),
      regimens: form.regimens.map((r) => ({ ...r, line: r.lineAuto === false ? String(r.line || '') : '' })),
      fluids: [...form.fluids], scopes: [...form.scopes],
      source: { text: String(form.source.text || '').trim(), url: /^https?:\/\//i.test(form.source.url || '') ? form.source.url : '' },
      observations: listVals('observations'), contraindications: listVals('contraindications'), compat: listVals('compat')
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
  form = formOf(d);
  fillLists(d);
  if ($('#drug-title').value !== (d.name || '')) { $('#drug-title').value = d.name || ''; fitTitle($('#drug-title')); }
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
    brands: [...(d.brands || [])], presentations: [...(d.presentations || [])], regimens: clone(d.regimens || []).map((r) => ({ ...r, id: regId() })),
    ...clone(extrasOf(d)) };
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
  $('#drug-add-pres').addEventListener('click', addPres);
  $('#drug-add-reg').addEventListener('click', addRegimen);
  // Ficha ampliada (v1.22.0): listas, sugerencias y secciones plegables
  for (const ta of document.querySelectorAll('#drug-wrap textarea.dlist-edit')) ta.addEventListener('input', changedLight);
  $('#drug-type-dl').replaceChildren(...REG_TYPES.map((v) => el('option', { value: v })));
  $('#drug-fluid-dl').replaceChildren(...FLUIDS.map((v) => el('option', { value: v })));
  for (const det of document.querySelectorAll('#drug-wrap details.dsec')) {
    det.addEventListener('toggle', () => {
      if (!curId || !isRd()) return;
      const st = secState(); st[det.dataset.sec] = det.open;
      try { localStorage.setItem(SEC_KEY, JSON.stringify(st)); } catch { /* nada */ }
    });
  }
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

// ====================== Campos ampliados (v1.22.0) ======================
/** Campos nuevos de una ficha (o de lo importado/pegado), solo los que tienen algo */
function extrasOf(x) {
  const out = {};
  for (const f of EXTRA_LISTS) if (x[f]?.length) out[f] = [...x[f]];
  if (x.presBrands?.length) out.presBrands = x.presBrands.map((e) => ({ p: e.p, b: [...e.b] }));
  if (x.source?.text || x.source?.url) out.source = { text: x.source.text || '', url: x.source.url || '' };
  return out;
}
/** «Completar»: une listas sin repetir y rellena embarazo y fuente solo si estaban vacíos. Devuelve { light, n } */
function completeExtras(d, it) {
  const light = {};
  let n = 0;
  for (const f of EXTRA_LISTS) { const [next, k] = mergeList(d[f] || [], it[f] || []); if (k) { light[f] = next; n += k; } }
  const pb = [...(d.presBrands || [])];
  for (const e of it.presBrands || []) {
    const cur = pb.find((x) => norm(x.p) === norm(e.p));
    if (!cur) { pb.push({ p: e.p, b: [...e.b] }); n++; continue; }
    const [b, k] = mergeList(cur.b, e.b);
    if (k) { cur.b = b; n++; }
  }
  if (pb.length !== (d.presBrands || []).length || n) light.presBrands = pb;
  if (!d.source?.text && !d.source?.url && (it.source?.text || it.source?.url)) { light.source = { ...it.source }; n++; }
  return { light, n };
}

// ====================== «Pegar del Chuletario» ======================
/**
 * Pega el texto copiado de una ficha del Chuletario de Urgencias, lo reparte en los campos y muestra una vista previa
 * editable. targetId = ficha abierta (⋯ de la ficha); si no, se busca por nombre o se crea en folderId.
 */
export async function pasteChuletario({ folderId = null, targetId = null } = {}) {
  saveSoon.flush();
  const ta = el('textarea', { rows: 10, class: 'chu-input', placeholder: 'Pega aquí el texto copiado de la ficha (nombre, marca, embarazo, sueros, presentaciones, indicaciones…)', spellcheck: 'false' });
  const canRead = !!navigator.clipboard?.readText;
  const ok = await modal({
    title: 'Pegar del Chuletario',
    cls: 'chu-modal',
    body: [
      el('p', { class: 'muted small' }, 'En chuletariodeurgencias.es abre la ficha del fármaco, selecciona todo su texto, cópialo y pégalo aquí. Después podrás revisarlo antes de guardar.'),
      canRead ? el('button', { class: 'btn sm', type: 'button', onclick: async () => {
        try { ta.value = await navigator.clipboard.readText(); } catch { toast('No se pudo leer el portapapeles: mantén pulsado en el recuadro y pega', 'error', 4500); }
      } }, icon('clipboard-paste'), ' Pegar del portapapeles') : null,
      ta
    ],
    actions: [{ label: 'Cancelar' }, { label: 'Continuar', primary: true, value: true, onClick: () => { if (!ta.value.trim()) { toast('Pega primero el texto de la ficha', 'error'); return false; } return true; } }]
  });
  if (!ok) return null;
  const parsed = parseChuletario(ta.value);
  const target = targetId ? store.drugs.get(targetId) : null;
  return previewChuletario(parsed, { target, folderId });
}

async function previewChuletario(p, { target = null, folderId = null }) {
  const inp = (value, attrs = {}) => { const x = el('input', { type: 'text', ...attrs }); x.value = value || ''; return x; };
  const area = (value, rows = 3, attrs = {}) => { const x = el('textarea', { rows, ...attrs }); x.value = value || ''; return x; };
  const name = inp(p.name, { maxlength: 150, placeholder: 'Principio activo' });
  const brands = inp(p.brands.join(', '), { placeholder: 'Separados por comas' });
  const scopes = new Set(target?.scopes?.length ? target.scopes : ['urg']);
  const scopeRow = el('div', { class: 'chu-scopes' }, ...SCOPES.map(([k, l]) => {
    const b = el('button', { type: 'button', class: `scope-chip sc-${k} toggle ${scopes.has(k) ? 'on' : ''}`, onclick: () => { if (scopes.has(k)) scopes.delete(k); else scopes.add(k); b.classList.toggle('on', scopes.has(k)); } }, l);
    return b;
  }));
  const fluids = inp(p.fluids.join(', '), { placeholder: 'SSF, SG5 %…' });
  const pres = area(p.presentations.join('\n'), 2);
  const obs = area(p.observations.join('\n'), 3);
  const contra = area(p.contraindications.join('\n'), 2);
  const compat = area(p.compat.join('\n'), 2);
  const regs = p.regimens.map((r) => ({ ...r }));
  const regBox = el('div', { class: 'chu-regs' });
  const renderRegRows = () => regBox.replaceChildren(...regs.map((r, i) => {
    const ind = inp(r.indication, { placeholder: 'Indicación' });
    const type = inp(r.type, { list: 'drug-type-dl', placeholder: 'Tipo', class: 'chu-type' });
    const text = area(r.text, 2, { placeholder: 'Dosis' });
    ind.addEventListener('input', () => { r.indication = ind.value; });
    type.addEventListener('input', () => { r.type = regType(type.value) || type.value.trim(); });
    text.addEventListener('input', () => { r.text = text.value; });
    return el('div', { class: `reg chu-reg ${r.type ? `t-${typeSlug(r.type)}` : ''}` },
      el('div', { class: 'chu-reg-top' }, ind, type,
        el('button', { class: 'icon-btn', type: 'button', title: 'Quitar', 'aria-label': 'Quitar esta indicación', onclick: () => { regs.splice(i, 1); renderRegRows(); } }, icon('x'))),
      text);
  }));
  renderRegRows();
  const reviewed = el('input', { type: 'checkbox', checked: true });
  const mode = { v: 'complete' };
  const modeBox = el('div', { class: 'chu-mode' });
  const existing = () => target || drugByName(name.value);
  const renderMode = () => {
    const ex = existing();
    if (!ex) { modeBox.replaceChildren(el('p', { class: 'muted small' }, `Se creará una ficha nueva${folderId ? ` en «${DF().get(folderId)?.name || 'carpeta'}»` : ''}.`)); return; }
    const radio = (v, title, desc) => el('label', { class: 'bk-mode' },
      el('input', { type: 'radio', name: 'chumode', value: v, checked: mode.v === v, onchange: () => { mode.v = v; } }),
      el('span', {}, el('b', {}, title), el('br'), el('span', { class: 'muted small' }, desc)));
    modeBox.replaceChildren(el('p', { class: 'bk-warn' }, `Ya tienes la ficha «${ex.name}». ¿Qué hago?`),
      radio('complete', 'Completar', 'Añade lo que falte (marcas, sueros, indicaciones, observaciones…). No borra nada.'),
      radio('replace', 'Reemplazar', 'Sustituye los datos de la ficha por los pegados. Se conservan carpeta, favorito y «Mis notas».'));
  };
  name.addEventListener('input', renderMode);
  renderMode();
  const field = (label, x) => el('label', { class: 'chu-f' }, label, x);
  const go = await modal({
    title: 'Revisa antes de guardar',
    cls: 'chu-modal',
    wide: true,
    body: [
      p.warnings.length ? el('p', { class: 'bk-warn' }, `⚠ ${p.warnings.join(' ')}`) : null,
      el('div', { class: 'chu-grid' }, field('Principio activo', name), field('Nombres comerciales', brands)),
      el('div', { class: 'chu-f' }, 'Ámbito', scopeRow),
      field('Sueros compatibles', fluids),
      field('Presentaciones (una por línea)', pres),
      el('div', { class: 'chu-f' }, `Indicaciones (${regs.length})`, regBox),
      field('Observaciones (una por línea)', obs),
      field('Contraindicaciones (una por línea)', contra),
      field('Compatibilidad en Y (una por línea)', compat),
      el('p', { class: 'muted small' }, `Fuente: ${CHULETARIO_SOURCE.text}`),
      el('label', { class: 'check chu-rev' }, reviewed, el('span', {}, 'Marcar la ficha como ', el('b', {}, '✓ Revisada'))),
      modeBox
    ],
    actions: [{ label: 'Cancelar' }, { label: 'Guardar', primary: true, value: true, onClick: () => { if (!name.value.trim()) { toast('Falta el nombre del fármaco', 'error'); name.focus(); return false; } return true; } }]
  });
  if (!go) return null;
  const lines = (x) => x.value.split('\n').map((v) => v.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const csv = (x) => x.value.split(/[,;]+/).map((v) => v.replace(/[®™]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const data = {
    name: name.value.replace(/\s+/g, ' ').trim(),
    brands: csv(brands), presentations: lines(pres), fluids: csv(fluids),
    regimens: regs.filter((r) => r.indication.trim() || r.text.trim()).map((r) => ({
      id: regId(), indication: r.indication.trim(), type: r.type || '', text: r.text.trim(),
      pres: '', route: '', dose: '', freq: '', duration: '', max: '', line: '', lineAuto: true
    })),
    observations: lines(obs), contraindications: lines(contra), compat: lines(compat),
    scopes: SCOPES.map(([k]) => k).filter((k) => scopes.has(k)),
    source: { ...CHULETARIO_SOURCE }
  };
  return saveChuletario(data, { target: existing(), mode: mode.v, reviewed: reviewed.checked, folderId });
}

function saveChuletario(data, { target, mode, reviewed, folderId }) {
  const now = Date.now();
  const rev = { reviewed, reviewedAt: reviewed ? now : null };
  let id;
  if (!target) {
    id = newId('drugs');
    writeDrug(id, { ...blankDrug({ name: data.name, folderId, now, reviewed }), ...rev, brands: data.brands, presentations: data.presentations, regimens: data.regimens, ...extrasOf(data), importedAt: now });
    toast(`Ficha «${data.name}» creada ✓`, 'ok');
  } else {
    id = target.id;
    if (curId === id) { saveSoon.flush(); dirtyLight = false; }
    let light;
    if (mode === 'replace') {
      light = { name: data.name || target.name, brands: data.brands, presentations: data.presentations, regimens: data.regimens,
        fluids: data.fluids, observations: data.observations, contraindications: data.contraindications, compat: data.compat,
        scopes: data.scopes, source: data.source };
    } else {
      const keys = new Set((target.regimens || []).map(regKey));
      light = {
        brands: mergeList(target.brands, data.brands)[0], presentations: mergeList(target.presentations, data.presentations)[0],
        regimens: [...(target.regimens || []), ...data.regimens.filter((r) => !keys.has(regKey(r)))],
        ...completeExtras(target, data).light
      };
    }
    writeDrug(id, { ...light, ...rev, updatedAt: now, importedAt: now });
    toast(mode === 'replace' ? 'Ficha reemplazada ✓' : 'Ficha completada ✓', 'ok');
  }
  if (curId === id) { fillForm(store.drugs.get(id)); reading = true; renderChrome(); }
  else openDrug(id, { push: true });
  ctx.renderList(); ctx.renderSidebar();
  return id;
}
