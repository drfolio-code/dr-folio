// Nueva organización del Vademécum por grupo terapéutico (v1.30.0, plantilla v5): asistente «Revisar».
// Solo cambia la carpeta (folderId) de las fichas que están en carpetas de la plantilla, nunca su contenido.
// Las carpetas creadas por el usuario (y lo que hay dentro) no se tocan. Las carpetas antiguas de la plantilla que
// quedan vacías se borran. Antes se descarga una copia de seguridad completa (como «Reemplazar» al restaurar).
// El mapeo (fármaco → carpeta y carpeta antigua → carpeta nueva) viene en la propia plantilla (tools/mk_template5.py).
import { writeBatch } from '../vendor/libs.js';
import { db } from './db.js';
import { store, put, newId, childFolders, folderPath, ref, commitBatch } from './store.js';
import { el, norm, download } from './util.js';
import { toast, modal } from './ui.js';
import { icon } from './icons.js';
import { drugKey, baseKey, ensureScopeTag } from './drugbody.js';
import { addQuota, budget, buildBackup } from './backup.js';

export const REORG_VERSION = 1;
export const UNSORTED = 'Sin clasificar';
const SEP = ' › ';
// Carpetas principales de la organización antigua (v2–v4) que ya no existen en la nueva: si queda alguna, sale el aviso
const OLD_TOPS = ['Montaña y rescate', 'Soporte vital y urgencias', 'Hematología', 'Musculoesquelético', 'Urología', 'Ginecología y obstetricia', 'Alergia', 'Antídotos y toxicología'];
const DF = () => store.drugFolders;
const st = () => store.settings?.get('vademecum') || {};
const nk = (s) => norm(String(s || '')).replace(/\s+/g, ' ').trim();
const pathOf = (id) => folderPath(id, DF()).map((f) => f.name).join(SEP);

/** ¿Sale el aviso «Nueva organización por carpetas»? (solo perfil adulto: las carpetas pediátricas son aparte) */
export function reorgPending() {
  if (!store.loaded.settings || !store.loaded.drugFolders || !store.loaded.drugs) return false;
  const s = st();
  if ((s.reorg || 0) >= REORG_VERSION || (s.reorgDismissed || 0) >= REORG_VERSION) return false;
  const tops = new Set(OLD_TOPS.map(nk));
  return [...DF().values()].some((f) => !f.parentId && f.profile !== 'ped' && tops.has(nk(f.name)));
}
export function dismissReorg() { put('settings', 'vademecum', { reorgDismissed: REORG_VERSION, updatedAt: Date.now() }); }

/** Carpeta con esa ruta de nombres (sin crearla) */
function findPath(names) {
  let parent = null, f = null;
  for (const n of names) {
    f = childFolders(parent, DF()).find((x) => nk(x.name) === nk(n) && x.profile !== 'ped');
    if (!f) return null;
    parent = f.id;
  }
  return f;
}

/** Plan (no escribe nada). tpl = plantilla v5 ya leída. */
export function planReorg(tpl) {
  const R = tpl.reorg || {};
  const fmap = R.folderMap || {};
  const structure = R.structure || [];
  const byName = new Map(), byBase = new Map();
  for (const [name, x] of Object.entries(R.drugFolders || {})) { byName.set(drugKey(name), x.to); if (!byBase.has(baseKey(name))) byBase.set(baseKey(name), x.to); }
  // Rutas de la plantilla (antiguas y nuevas) y sus carpetas principales: lo demás es tuyo y no se toca
  const tplPaths = new Set();
  for (const p of [...Object.keys(fmap), ...structure]) { const parts = p.split(SEP); for (let i = 1; i <= parts.length; i++) tplPaths.add(nk(parts.slice(0, i).join(SEP))); }
  const isTpl = (path) => tplPaths.has(nk(path));
  const mountain = new Set((R.mountainFolders || ['Montaña y rescate']).map(nk));
  const moves = [];
  let kept = 0;
  for (const d of store.drugs.values()) {
    if (d.profile === 'ped') continue;
    if (!d.folderId || !DF().has(d.folderId)) continue;
    const from = pathOf(d.folderId);
    if (!isTpl(from)) { kept++; continue; }
    const fk = Object.keys(fmap).find((k) => nk(k) === nk(from));
    const to = byName.get(drugKey(d.name)) || byBase.get(baseKey(d.name)) || (fk && fmap[fk]) || (structure.some((p) => nk(p) === nk(from)) ? from : UNSORTED);
    const mont = mountain.has(nk(from.split(SEP)[0]));
    if (nk(to) === nk(from)) continue;
    moves.push({ d, from, to, mont, unsorted: to === UNSORTED });
  }
  // Carpetas nuevas que hay que crear
  const need = new Set(moves.map((m) => m.to));
  const create = [...need].filter((p) => !findPath(p.split(SEP)));
  // Carpetas de la plantilla que se quedan vacías (de abajo arriba): sin fichas (ni en la papelera), sin subcarpetas
  // que se queden y sin enlaces propios. Las de la organización nueva no se borran aunque estén vacías.
  const leaving = new Map(); // folderId → nº de fichas que se van
  for (const m of moves) leaving.set(m.d.folderId, (leaving.get(m.d.folderId) || 0) + 1);
  const count = new Map();
  for (const d of store.drugs.values()) if (d.folderId) count.set(d.folderId, (count.get(d.folderId) || 0) + 1);
  const isNew = (path) => structure.some((p) => nk(p) === nk(path) || nk(p).startsWith(`${nk(path)}${SEP}`)) || nk(path) === nk(UNSORTED);
  const del = new Set();
  const depth = (f) => folderPath(f.id, DF()).length;
  const folders = [...DF().values()].filter((f) => f.profile !== 'ped').sort((a, b) => depth(b) - depth(a));
  for (const f of folders) {
    const path = pathOf(f.id);
    if (!isTpl(path) || isNew(path)) continue;
    const left = (count.get(f.id) || 0) - (leaving.get(f.id) || 0);
    const subs = childFolders(f.id, DF()).filter((c) => !del.has(c.id));
    if (left <= 0 && !subs.length && !(f.resources || []).length) del.add(f.id);
  }
  // Resumen: carpeta antigua → nueva con el nº de fichas
  const pairs = new Map();
  for (const m of moves) { const k = `${m.from}\u0000${m.to}`; pairs.set(k, (pairs.get(k) || 0) + 1); }
  return { moves, create, del: [...del], kept, pairs: [...pairs].map(([k, n]) => { const [from, to] = k.split('\u0000'); return { from, to, n }; }).sort((a, b) => a.to.localeCompare(b.to, 'es') || a.from.localeCompare(b.from, 'es')), structure };
}

/** Crea (en el lote) la carpeta con esa ruta si no existe. Devuelve su id. */
function ensurePath(path, batch, structure, created) {
  let parent = null;
  const parts = path.split(SEP);
  parts.forEach((name, i) => {
    let f = childFolders(parent, DF()).find((x) => nk(x.name) === nk(name) && x.profile !== 'ped');
    if (!f) {
      const id = newId('drugFolders');
      const now = Date.now();
      const sub = parts.slice(0, i + 1).join(SEP);
      const k = structure.findIndex((p) => nk(p) === nk(sub) || nk(p).startsWith(`${nk(sub)}${SEP}`));
      const data = { name, parentId: parent, color: null, order: (k >= 0 ? k : 900) * 1000 + i, createdAt: now, updatedAt: now };
      DF().set(id, { id, ...data });
      batch.set(ref('drugFolders', id), data);
      created.push(sub);
      f = { id };
    }
    parent = f.id;
  });
  return parent;
}

/** Asistente: descarga la plantilla, enseña la vista previa y, si se acepta, hace copia y reorganiza */
export async function openReorg(ctx) {
  if (!navigator.onLine) { toast('Hace falta conexión para reorganizar (se descarga la plantilla y se hace una copia antes).', 'error', 5000); return; }
  let tpl;
  try {
    const r = await fetch(ctx.templateUrl, { cache: 'no-cache' });
    if (!r.ok) throw new Error(String(r.status));
    tpl = await r.json();
  } catch { toast('No se pudo descargar la plantilla (¿sin conexión?)', 'error', 5000); return; }
  if (!tpl.reorg) { toast('La plantilla no trae la organización nueva. Recarga la app e inténtalo otra vez.', 'error', 5000); return; }
  const plan = planReorg(tpl);
  if (!plan.moves.length && !plan.del.length) {
    put('settings', 'vademecum', { reorg: REORG_VERSION, updatedAt: Date.now() });
    toast('Tu Vademécum ya está organizado por grupo terapéutico ✓', 'ok');
    ctx.render();
    return;
  }
  const unsorted = plan.moves.filter((m) => m.unsorted).length;
  const rows = plan.pairs.map((p) => el('tr', {}, el('td', {}, p.from), el('td', { class: 'ro-arrow' }, '→'), el('td', {}, el('b', {}, p.to)), el('td', { class: 'num' }, String(p.n))));
  const ok = await modal({
    title: 'Nueva organización por carpetas',
    cls: 'reorg-modal',
    wide: true,
    body: [
      el('p', {}, 'Carpetas por grupo terapéutico, una sola carpeta por fármaco y pocas subcarpetas. Las carpetas por contexto (Montaña y rescate, Soporte vital) desaparecen: ese contexto va en las etiquetas (ámbito).'),
      el('table', { class: 'bk-table' }, el('tbody', {},
        el('tr', {}, el('td', {}, 'Fichas que cambian de carpeta'), el('td', {}, String(plan.moves.length))),
        el('tr', {}, el('td', {}, 'Carpetas nuevas'), el('td', {}, String(plan.create.length))),
        el('tr', {}, el('td', {}, 'Carpetas antiguas vacías que se borran'), el('td', {}, String(plan.del.length))),
        unsorted ? el('tr', {}, el('td', {}, `No reconocidas → «${UNSORTED}»`), el('td', {}, String(unsorted))) : null,
        plan.kept ? el('tr', {}, el('td', {}, 'En carpetas tuyas: no se tocan'), el('td', {}, String(plan.kept))) : null)),
      el('p', { class: 'bk-warn' }, icon('folder-input'), ' Solo cambia la carpeta de cada ficha: el contenido (pautas, notas, revisada…) no se toca. Antes se descarga una copia de seguridad completa.'),
      el('div', { class: 'reorg-scroll' }, el('table', { class: 'reorg-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Carpeta antigua'), el('th', {}), el('th', {}, 'Carpeta nueva'), el('th', {}, 'Fichas'))), el('tbody', {}, ...rows)))
    ],
    actions: [{ label: 'Ahora no', value: 'later' }, { label: 'Hacer copia y reorganizar', primary: true, value: 'go' }]
  });
  if (ok === 'later') { dismissReorg(); ctx.render(); toast('Puedes hacerlo cuando quieras: Vademécum ⋯ → «Reorganizar carpetas…»', 'ok', 4500); return; }
  if (ok !== 'go') return;
  const ops = plan.moves.length + plan.create.length * 2 + plan.del.length + 5;
  if (budget().w < ops) { toast('Hoy ya casi no quedan escrituras del plan gratuito. Inténtalo mañana.', 'error', 6000); return; }
  // Copia de seguridad antes (si falla, no se reorganiza)
  toast('Haciendo copia de seguridad…', '', 6000);
  try {
    const { blob } = await buildBackup({ withFiles: true });
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    download(`drfolio-copia-antes-de-reorganizar-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`, blob);
  } catch (e) { toast(`No se pudo hacer la copia: ${e.message || e}. No se ha cambiado nada.`, 'error', 7000); return; }
  ctx.flush();
  let batch = writeBatch(db), n = 0;
  const flush = () => { if (n >= 400) { commitBatch(batch); batch = writeBatch(db); n = 0; } };
  const created = [];
  const ids = new Map();
  for (const p of new Set(plan.moves.map((m) => m.to))) { ids.set(p, ensurePath(p, batch, plan.structure, created)); n += 2; flush(); }
  for (const m of plan.moves) {
    const x = { folderId: ids.get(m.to) };
    if (m.mont) x.mountainFolder = true; // estaba en «Montaña y rescate»: tendrá la etiqueta «Montaña»
    if (m.mont && Array.isArray(m.d.tags)) x.tags = [...new Set([...m.d.tags, ensureScopeTag('mont', 'adult', batch)])]; // ya con etiquetas (v1.31.0)
    batch.set(ref('drugs', m.d.id), x, { merge: true });
    Object.assign(m.d, x);
    n++; flush();
  }
  for (const id of plan.del) { batch.delete(ref('drugFolders', id)); DF().delete(id); n++; flush(); }
  await commitBatch(batch);
  addQuota(plan.moves.length + created.length, plan.del.length);
  put('settings', 'vademecum', { reorg: REORG_VERSION, updatedAt: Date.now() });
  toast(`Reorganizado ✓ ${plan.moves.length} ficha(s) movida(s), ${created.length} carpeta(s) nueva(s), ${plan.del.length} borrada(s)`, 'ok', 5000);
  ctx.render();
}

// ====================== Carpetas pediátricas (v1.32.0) ======================
/** La misma estructura de grupos terapéuticos que la plantilla v5 (tools/mk_template5.py → STRUCTURE) */
export const GROUPS = [
  'Analgesia y anestesia › Analgésicos', 'Analgesia y anestesia › AINE', 'Analgesia y anestesia › Opioides', 'Analgesia y anestesia › Anestésicos locales y sedación',
  'Cardiovascular › Antihipertensivos y diuréticos', 'Cardiovascular › Antiarrítmicos y vasoactivos',
  'Cardiovascular › Cardiopatía isquémica e insuficiencia cardiaca', 'Cardiovascular › Hipolipemiantes',
  'Respiratorio', 'Digestivo',
  'Antiinfecciosos › Antibacterianos', 'Antiinfecciosos › Antivirales, antifúngicos y antiparasitarios', 'Antiinfecciosos › Vacunas e inmunoglobulinas',
  'Neurología y psiquiatría › Neurología', 'Neurología y psiquiatría › Psiquiatría',
  'Endocrino y metabolismo', 'Sangre y anticoagulación', 'Alergia e inmunología', 'Dermatología', 'Oftalmología y ORL',
  'Urología y ginecología', 'Aparato locomotor', 'Sueros y electrolitos', 'Antídotos'
];
// ====================== Carpetas estándar (v1.34.0): las mismas en adulto y pediátrico ======================
/**
 * Catálogo de carpetas del Vademécum. `subs` = subcarpetas de la plantilla (se crean con «Carpetas estándar»);
 * `extra` = subcarpetas sugeridas al crear una carpeta a mano (no se crean solas). Los nombres de la plantilla v5
 * no cambian (las fichas y la reorganización los usan).
 */
export const CATALOG = [
  { name: 'Analgesia y anestesia', subs: ['Analgésicos', 'AINE', 'Opioides', 'Anestésicos locales y sedación'], extra: ['Relajantes neuromusculares'] },
  { name: 'Cardiovascular', subs: ['Antihipertensivos y diuréticos', 'Antiarrítmicos y vasoactivos', 'Cardiopatía isquémica e insuficiencia cardiaca', 'Hipolipemiantes'] },
  { name: 'Respiratorio', subs: [], extra: ['Broncodilatadores', 'Corticoides inhalados y combinaciones', 'Antitusivos y mucolíticos', 'Rinitis y descongestivos', 'Oxigenoterapia'] },
  { name: 'Digestivo', subs: [], extra: ['Antiácidos e IBP', 'Antieméticos', 'Laxantes', 'Antidiarreicos y rehidratación', 'Espasmolíticos y antiflatulentos', 'Probióticos'] },
  { name: 'Antiinfecciosos', subs: ['Antibacterianos', 'Antivirales, antifúngicos y antiparasitarios', 'Vacunas e inmunoglobulinas'], extra: ['Antituberculosos', 'Antipalúdicos'] },
  { name: 'Neurología y psiquiatría', subs: ['Neurología', 'Psiquiatría'], extra: ['Anticonvulsivantes', 'Migraña', 'Vértigo', 'TDAH', 'Sueño'] },
  { name: 'Endocrino y metabolismo', subs: [], extra: ['Antidiabéticos', 'Insulinas', 'Corticoides sistémicos', 'Tiroides', 'Vitaminas y minerales'] },
  { name: 'Sangre y anticoagulación', subs: [], extra: ['Antiagregantes', 'Anticoagulantes', 'Antianémicos', 'Hemostáticos y reversores'] },
  { name: 'Alergia e inmunología', subs: [], extra: ['Antihistamínicos', 'Anafilaxia'] },
  { name: 'Dermatología', subs: [], extra: ['Corticoides tópicos', 'Antiinfecciosos tópicos', 'Acné', 'Pediculicidas y escabicidas', 'Heridas y quemaduras'] },
  { name: 'Oftalmología y ORL', subs: [], extra: ['Oftalmológicos', 'Óticos', 'Nasales', 'Boca y garganta'] },
  { name: 'Urología y ginecología', subs: [], extra: ['Urología', 'Anticoncepción', 'Embarazo y obstetricia', 'Enuresis'] },
  { name: 'Aparato locomotor', subs: [], extra: ['Gota', 'Osteoporosis', 'Relajantes musculares', 'Infiltraciones'] },
  { name: 'Sueros y electrolitos', subs: [] },
  { name: 'Antídotos', subs: [] },
  // v1.34.0: grupos nuevos (no estaban en la plantilla)
  { name: 'Nutrición y fórmulas', subs: [], extra: ['Fórmulas infantiles', 'Suplementos'], nuevo: true },
  { name: 'Cuidados paliativos', subs: [], extra: ['Dolor', 'Síntomas digestivos', 'Disnea', 'Sedación paliativa'], nuevo: true },
  { name: 'Productos sanitarios', subs: [], extra: ['Cámaras de inhalación', 'Material de curas'], nuevo: true }
];
const otherProf = (p) => (p === 'ped' ? 'adult' : 'ped');
const profFolders = (p) => [...DF().values()].filter((f) => (f.profile === 'ped' ? 'ped' : 'adult') === p);
const childOf = (p, parent, name) => profFolders(p).find((x) => (x.parentId || null) === parent && nk(x.name) === nk(name));
const pathNames = (id) => folderPath(id, DF()).map((f) => f.name);

/**
 * Nombre para una carpeta nueva del Vademécum (sustituye al cuadro de texto): sugerencias de la lista estándar y de
 * las carpetas del otro perfil en el mismo sitio (para que adulto y pediátrico sean iguales), o un nombre libre.
 * Devuelve el nombre o null.
 */
export async function pickFolderName(parentId, profile) {
  const path = parentId ? pathNames(parentId) : [];
  const g = path.length === 1 ? CATALOG.find((c) => nk(c.name) === nk(path[0])) : null;
  let sugg = !parentId ? CATALOG.map((c) => c.name) : g ? [...g.subs, ...(g.extra || [])] : [];
  // las del otro perfil en la misma ruta
  let op = null;
  for (const n of path) { op = childOf(otherProf(profile), op ? op.id : null, n); if (!op) break; }
  const other = !parentId || op ? profFolders(otherProf(profile)).filter((f) => (f.parentId || null) === (parentId ? op?.id || '§' : null)).map((f) => f.name) : [];
  const seen = new Set();
  sugg = [...sugg, ...other].filter((n) => { const k = nk(n); if (seen.has(k)) return false; seen.add(k); return true; });
  const exists = (n) => !!childOf(profile, parentId || null, n);
  const input = el('input', { type: 'text', maxlength: 100, placeholder: parentId ? 'Nombre de la subcarpeta' : 'Nombre de la carpeta', autocomplete: 'off' });
  let chosen = null;
  const otherSet = new Set(other.map(nk));
  const chips = el('div', { class: 'fname-sugg' }, ...sugg.map((n) => {
    const has = exists(n);
    return el('button', { type: 'button', class: `chip ${has ? 'done' : ''}`, disabled: has, title: has ? 'Ya existe' : otherSet.has(nk(n)) ? `Existe en el ${profile === 'ped' ? 'adulto' : 'pediátrico'}` : '',
      onclick: (e) => { chosen = n; input.value = n; e.currentTarget.closest('.modal').querySelector('.modal-foot .btn.primary').click(); } },
    has ? icon('check') : null, n, !has && otherSet.has(nk(n)) && !CATALOG.some((c) => nk(c.name) === nk(n)) ? el('span', { class: 'muted small' }, ` · ${profile === 'ped' ? 'adulto' : 'pediátrico'}`) : null);
  }));
  const res = await modal({
    title: parentId ? `Nueva subcarpeta en «${path[path.length - 1]}»` : 'Nueva carpeta del Vademécum',
    body: [
      sugg.length ? el('p', { class: 'muted small' }, 'Elige una carpeta estándar (la misma organización en adulto y pediátrico) o escribe otro nombre.') : null,
      sugg.length ? chips : null,
      el('label', { class: 'rf' }, sugg.length ? 'Otro nombre' : 'Nombre', input)
    ],
    actions: [{ label: 'Cancelar' }, { label: 'Crear', primary: true, value: 'ok', onClick: () => { if (!input.value.trim()) { toast('Elige o escribe un nombre', 'error'); return false; } return true; } }],
    autofocus: !sugg.length && !matchMedia('(pointer: coarse)').matches
  });
  if (res !== 'ok') return null;
  const name = (chosen || input.value).replace(/[\/>›]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (exists(name)) { toast(`Ya tienes «${name}» aquí`, 'error'); return null; }
  return name;
}

/** «Carpetas estándar…» (adulto o pediátrico): elige qué grupos y subcarpetas crear; las del otro perfil también se ofrecen */
export async function createStdFolders(ctx, profile) {
  const tops = CATALOG.map((c) => ({ name: c.name, subs: [...c.subs], std: new Set(c.subs.map(nk)), nuevo: !!c.nuevo }));
  // carpetas del otro perfil que no están en el catálogo (para igualar los dos perfiles)
  for (const f of profFolders(otherProf(profile)).filter((x) => !x.parentId)) {
    let g = tops.find((t) => nk(t.name) === nk(f.name));
    if (!g) tops.push(g = { name: f.name, subs: [], std: new Set(), fromOther: true });
    for (const c of profFolders(otherProf(profile)).filter((x) => x.parentId === f.id)) if (!g.subs.some((s) => nk(s) === nk(c.name))) g.subs.push(c.name);
  }
  const checks = [];
  const box = el('div', { class: 'ped-groups' });
  for (const g of tops) {
    const top = childOf(profile, null, g.name);
    const c = el('input', { type: 'checkbox', checked: false, disabled: !!top });
    const subs = g.subs.map((sname) => {
      const sx = top && childOf(profile, top.id, sname);
      const sc = el('input', { type: 'checkbox', checked: false, disabled: !!sx });
      const std = g.std.has(nk(sname));
      checks.push({ top: g.name, sub: sname, c: sc, parent: c, std });
      return el('label', { class: 'sub' }, sc, ` ${sname}${sx ? ' (ya está)' : ''}`, !std && !sx ? el('span', { class: 'muted small' }, ` · del ${profile === 'ped' ? 'adulto' : 'pediátrico'}`) : null);
    });
    c.addEventListener('change', () => { for (const x of checks) if (x.parent === c && !x.c.disabled && (x.std || g.fromOther)) x.c.checked = c.checked; });
    checks.push({ top: g.name, c });
    box.append(el('label', {}, c, el('b', {}, ` ${g.name}`), top ? el('span', { class: 'muted small' }, ' (ya está)') : null,
      g.nuevo ? el('span', { class: 'prof-badge' }, 'nuevo') : null, g.fromOther ? el('span', { class: 'muted small' }, ` · del ${profile === 'ped' ? 'adulto' : 'pediátrico'}`) : null), ...subs);
  }
  const all = el('button', { class: 'btn sm', type: 'button', onclick: () => { for (const x of checks) if (!x.c.disabled) x.c.checked = true; } }, 'Marcar todas las que faltan');
  const ok = await modal({
    title: `Carpetas estándar · ${profile === 'ped' ? 'Pediátrico' : 'Adulto'}`,
    body: [el('p', { class: 'muted small' }, 'La misma organización por grupo terapéutico en adulto y pediátrico. Las que ya tienes salen marcadas «ya está». Las subcarpetas son opcionales: al crear una carpeta a mano se sugieren más.'), all, box],
    actions: [{ label: 'Cancelar' }, { label: 'Crear', primary: true, value: true }]
  });
  if (!ok) return;
  const want = checks.filter((x) => x.c.checked && !x.c.disabled);
  if (!want.length) return;
  const batch = writeBatch(db);
  let n = 0;
  const now = Date.now();
  const make = (name, parentId, order) => {
    const id = newId('drugFolders');
    const data = { name, parentId, color: null, order, createdAt: now, updatedAt: now, ...(profile === 'ped' ? { profile: 'ped' } : {}) };
    DF().set(id, { id, ...data });
    batch.set(ref('drugFolders', id), data);
    n++;
    return id;
  };
  for (const x of want) {
    const gi = Math.max(0, tops.findIndex((t) => t.name === x.top));
    const top = childOf(profile, null, x.top);
    const topId = top ? top.id : make(x.top, null, gi * 1000);
    if (x.sub && !childOf(profile, topId, x.sub)) make(x.sub, topId, gi * 1000 + (tops[gi].subs.indexOf(x.sub) + 1));
  }
  await commitBatch(batch);
  addQuota(n, 0);
  toast(`${n} carpeta(s) creada(s)`, 'ok');
  ctx.render();
}
/** Compatibilidad: el pediátrico usa las mismas carpetas estándar */
export const createPedFolders = (ctx) => createStdFolders(ctx, 'ped');
