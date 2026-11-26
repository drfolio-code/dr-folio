// Prerredactados: textos fijos para copiar (exploraciones, consejos, informes…)
// Campos rellenables dentro del texto:  {edad}   o con opciones   {lado:derecho|izquierdo}
import { store, put, patch, remove, newId, folderPath, childFolders, descendantIds, flatFolders } from './store.js';
import { el, $, debounce, norm, shortDate, longDate } from './util.js';
import { toast, modal, confirm, menu, picker } from './ui.js';

const FIELD_RE = /\{([^{}\n:|]{1,40})(?::([^{}\n]{1,300}))?\}/g;

let ctx = null;        // ayudas de app.js
let curId = null;      // prerredactado abierto
let dirty = false;

export const currentSnippet = () => curId;

// ---------- Campos ----------
export function parseFields(body) {
  const out = new Map();
  for (const m of (body || '').matchAll(FIELD_RE)) {
    const name = m[1].trim();
    if (!name || out.has(name)) continue;
    const options = m[2] ? m[2].split('|').map((o) => o.trim()).filter(Boolean) : [];
    out.set(name, options);
  }
  return out;
}

function applyFields(body, values) {
  return body.replace(FIELD_RE, (all, name) => {
    const v = values.get(name.trim());
    return v == null ? all : v;
  });
}

/** Copia texto al portapapeles (con plan B para navegadores antiguos). Llamar dentro de un clic. */
export function copyText(text) {
  const fallback = () => {
    const ta = el('textarea', { style: { position: 'fixed', top: '-1000px', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  };
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true, () => fallback());
  }
  return Promise.resolve(fallback());
}

function countUse(s) {
  patch('snippets', s.id, { uses: (s.uses || 0) + 1, lastUsedAt: Date.now() });
}

/**
 * Prepara el texto final. Sin campos: lo devuelve tal cual.
 * Con campos: muestra un formulario. Si `copy`, copia dentro del clic del botón (lo exige iOS).
 * Resuelve con el texto o null si se cancela.
 */
async function fillText(s, { copy }) {
  const body = s.body || '';
  const fields = parseFields(body);
  const done = async (text) => {
    if (copy) {
      const ok = await copyText(text);
      toast(ok ? 'Copiado ✓' : 'No se pudo copiar', ok ? 'ok' : 'error');
      if (!ok) return null;
    }
    countUse(s);
    return text;
  };
  if (!fields.size) return done(body);

  const inputs = new Map();
  const rows = [...fields].map(([name, options]) => {
    let input;
    if (options.length) {
      input = el('select', {}, options.map((o) => el('option', { value: o }, o)));
    } else {
      input = el('input', { type: 'text', placeholder: name, autocomplete: 'off', maxlength: 500 });
    }
    inputs.set(name, input);
    return el('label', {}, name, input);
  });
  const preview = el('pre', { class: 'snip-preview' });
  // En la vista previa los huecos vacíos se ven como {campo}; en el texto final quedan en blanco
  const values = (final) => new Map([...inputs].map(([k, i]) => [k, i.value.trim() || (final ? '' : `{${k}}`)]));
  const refresh = () => { preview.textContent = applyFields(body, values(false)); };
  inputs.forEach((i) => i.addEventListener('input', refresh));
  refresh();
  let result = null;
  await modal({
    title: s.title || 'Rellenar campos',
    wide: true,
    body: [...rows, el('div', { class: 'muted small' }, 'Vista previa'), preview],
    actions: [
      { label: 'Cancelar' },
      { label: copy ? '⧉ Copiar' : 'Insertar', primary: true, onClick: async () => {
        const text = applyFields(body, values(true));
        result = await done(text);
        return result != null;
      } }
    ]
  });
  return result;
}

/** Copia un prerredactado (pide los campos si los tiene). Llamar desde un clic. */
export function copySnippet(id) {
  const s = store.snippets.get(id);
  if (!s) return;
  if (!(s.body || '').trim()) { toast('Este prerredactado está vacío', 'error'); return; }
  fillText(s, { copy: true });
}

// ---------- Carpetas, orden y búsqueda ----------
const SF = () => store.snippetFolders;
export const snipPath = (folderId) => (folderId ? folderPath(folderId, SF()) : []);
export const snipPathText = (folderId) => snipPath(folderId).map((f) => f.name).join(' › ');

// Orden de la lista de prerredactados (y de sus carpetas): manual | name | uses | recent
let sortMode = localStorage.getItem('drfolio.snipSort') || 'name';
export const snipSort = () => sortMode;
export function setSnipSort(mode) {
  sortMode = mode;
  try { localStorage.setItem('drfolio.snipSort', mode); } catch { /* */ }
}
export const SNIP_SORTS = [['manual', 'Orden manual'], ['name', 'Por nombre'], ['uses', 'Más usados'], ['recent', 'Recientes']];

const recency = (s) => Math.max(s.lastUsedAt || 0, s.updatedAt || 0);
const byTitle = (a, b) => (a.title || 'Sin título').localeCompare(b.title || 'Sin título', 'es', { numeric: true, sensitivity: 'base' });
const CMP = {
  manual: (a, b) => (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0) || byTitle(a, b),
  name: byTitle,
  uses: (a, b) => (b.uses || 0) - (a.uses || 0) || (b.lastUsedAt || 0) - (a.lastUsedAt || 0) || byTitle(a, b),
  recent: (a, b) => recency(b) - recency(a)
};
export function sortSnippets(list, mode = sortMode) { return list.sort(CMP[mode] || CMP.name); }
export const allSnippets = () => [...store.snippets.values()];
export const snippetsIn = (folderId) => allSnippets().filter((s) => (s.folderId || null) === (folderId || null));

/** Lista de una vista fija: sall | sfav | sused | srecent */
export function snippetsForView(type) {
  if (type === 'sfav') return sortSnippets(allSnippets().filter((s) => s.favorite));
  if (type === 'sused') return sortSnippets(allSnippets().filter((s) => s.uses), 'uses');
  if (type === 'srecent') return sortSnippets(allSnippets(), 'recent').slice(0, 50);
  return sortSnippets(allSnippets());
}

/** Busca en título y texto (sin tildes ni mayúsculas) */
export function snippetMatches(s, words) {
  const t = norm(`${s.title || ''}\n${s.body || ''}`);
  return words.every((w) => t.includes(w));
}

function previewNode(s, search) {
  const text = (s.body || '').replace(/\s+/g, ' ').trim();
  const q = norm((search || '').trim()).split(/\s+/).filter(Boolean)[0];
  if (!text) return 'Sin contenido';
  const i = q ? norm(text).indexOf(q) : -1;
  if (i < 0) return text.slice(0, 160);
  const start = Math.max(0, i - 50);
  const frag = document.createDocumentFragment();
  frag.append(start ? '…' : '', text.slice(start, i), el('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length, i + q.length + 110));
  return frag;
}

/** Tarjeta de un prerredactado: tocar = abrir · ☆ = favorito · ⧉ = copiar */
export function snippetCard(s, { search = '', showPath = false, onLongPress = null } = {}) {
  const nf = parseFields(s.body).size;
  const path = showPath ? snipPathText(s.folderId) : '';
  const card = el('div', {
    class: `note-card snip-card ${s.id === curId ? 'active' : ''}`, role: 'button', tabindex: '0',
    onclick: (e) => {
      if (e.target.closest('.snip-quick') || (onLongPress && onLongPress(card))) return;
      openSnippet(s.id, { push: true });
    },
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openSnippet(s.id, { push: true }); }
  },
    el('div', { class: 'snip-card-main' },
      el('div', { class: 't' }, el('span', {}, s.title || 'Sin título')),
      el('div', { class: 's' }, previewNode(s, search)),
      el('div', { class: 'm' },
        path ? el('span', { class: 'snip-path' }, `📁 ${path}`) : null,
        nf ? el('span', {}, `✏️ ${nf} campo${nf > 1 ? 's' : ''}`) : null,
        s.uses ? el('span', {}, `· usado ${s.uses}×`) : null,
        el('span', {}, `· ${shortDate(s.updatedAt)}`))),
    el('div', { class: 'snip-btns' },
      el('button', {
        class: `icon-btn snip-quick snip-star ${s.favorite ? 'on' : ''}`, type: 'button',
        title: s.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', 'aria-label': s.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos',
        onclick: () => toggleFavorite(s.id)
      }, s.favorite ? '★' : '☆'),
      el('button', {
        class: 'icon-btn snip-quick', type: 'button', title: 'Copiar', 'aria-label': `Copiar ${s.title || ''}`,
        onclick: () => { saveSoon.flush(); copySnippet(s.id); }
      }, '⧉')));
  return card;
}

export function toggleFavorite(id) {
  const s = store.snippets.get(id);
  if (!s) return;
  s.favorite = !s.favorite; // reflejo inmediato
  patch('snippets', id, { favorite: s.favorite });
  toast(s.favorite ? 'Añadido a favoritos ⭐' : 'Quitado de favoritos', 'ok');
  if (curId === id) renderChrome(s);
  ctx.renderList();
}

export function moveSnippetTo(id, folderId) {
  const s = store.snippets.get(id);
  if (!s || (s.folderId || null) === (folderId || null)) return;
  s.folderId = folderId || null;
  const order = Date.now();
  s.order = order; // al final de la carpeta de destino (orden manual)
  patch('snippets', id, { folderId: folderId || null, order, updatedAt: Date.now() });
  toast(`Movido a ${folderId ? `«${SF().get(folderId)?.name || 'carpeta'}»` : '«Prerredactados» (sin carpeta)'}`, 'ok');
  if (curId === id) renderChrome(s);
  ctx.renderList();
}

export async function moveSnippet(id) {
  const s = store.snippets.get(id);
  if (!s) return;
  const items = [{ id: '__root', label: '— Sin carpeta —' }, { id: '__new', label: '＋ Nueva carpeta…' },
    ...flatFolders(null, SF()).map((f) => ({ id: f.id, label: f.name, depth: f.depth }))];
  let target = await picker(`Mover «${s.title || 'Sin título'}» a…`, items, { placeholder: 'Buscar carpeta…' });
  if (!target) return;
  if (target === '__new') { target = await ctx.newFolder(null); if (!target) return; }
  moveSnippetTo(id, target === '__root' ? null : target);
}

/** Subir / bajar dentro de su carpeta (orden manual): renumera `order` de 1000 en 1000 */
function shiftSnippet(s, dir) {
  if (sortMode !== 'manual') { setSnipSort('manual'); toast('Orden manual activado', 'ok'); }
  const sibs = sortSnippets(snippetsIn(s.folderId), 'manual');
  const i = sibs.findIndex((x) => x.id === s.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return;
  [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  sibs.forEach((x, k) => {
    const order = (k + 1) * 1000;
    if (x.order !== order) { x.order = order; patch('snippets', x.id, { order }); }
  });
  ctx.renderList();
}

/** Menú de un prerredactado en la lista (⋯ del editor, clic derecho o mantener pulsado) */
export function snippetItemMenu(anchor, s, { inList = true } = {}) {
  const sibs = sortSnippets(snippetsIn(s.folderId), 'manual');
  const i = sibs.findIndex((x) => x.id === s.id);
  menu(anchor, [
    inList ? { icon: '📄', label: 'Abrir', onClick: () => openSnippet(s.id, { push: true }) } : null,
    { icon: '⧉', label: 'Copiar', onClick: () => { saveSoon.flush(); copySnippet(s.id); } },
    { icon: s.favorite ? '☆' : '⭐', label: s.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', onClick: () => toggleFavorite(s.id) },
    { icon: '📁', label: 'Mover a carpeta…', onClick: () => moveSnippet(s.id) },
    inList && i > 0 ? { icon: '⬆', label: 'Subir', onClick: () => shiftSnippet(s, -1) } : null,
    inList && i >= 0 && i < sibs.length - 1 ? { icon: '⬇', label: 'Bajar', onClick: () => shiftSnippet(s, 1) } : null,
    { icon: '⧉', label: 'Duplicar', onClick: () => duplicateSnippet(s) },
    '-',
    { icon: '🗑', label: 'Eliminar', danger: true, onClick: () => deleteSnippet(s) }
  ].filter(Boolean));
}

// ---------- Migración: categoría → carpeta (una sola vez) ----------
// Cada prerredactado sin campo `folderId` (creado antes de las carpetas) se mueve a una carpeta con el nombre
// de su categoría. El ID de la carpeta sale del nombre, así dos dispositivos que migren a la vez escriben la
// MISMA carpeta y no se duplica. Se espera a tener los datos del servidor (no solo la caché) para no repetirla.
// El campo `category` no se borra (por si hay que volver atrás).
function hash36(t) { let h = 5381; for (const c of t) h = ((h * 33) ^ c.codePointAt(0)) >>> 0; return h.toString(36); }
export const catFolderId = (name) => {
  const k = norm(name.trim());
  return `cat-${k.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x'}-${hash36(k)}`;
};
let migrated = false;
export function migrateCategories() {
  if (migrated || !store.loaded.snippets || !store.loaded.snippetFolders) return;
  if (store.fromCache.snippets || store.fromCache.snippetFolders) return;
  migrated = true;
  const todo = allSnippets().filter((s) => !('folderId' in s));
  if (!todo.length) return;
  const cats = new Map();
  for (const s of todo) { const c = (s.category || '').trim(); if (c && !cats.has(norm(c))) cats.set(norm(c), c); }
  const now = Date.now();
  [...cats.values()].sort((a, b) => a.localeCompare(b, 'es')).forEach((name, i) => {
    const id = catFolderId(name);
    if (SF().has(id)) return;
    const data = { name, parentId: null, color: null, order: (i + 1) * 1000, createdAt: now, updatedAt: now };
    SF().set(id, { id, ...data });
    put('snippetFolders', id, data);
  });
  for (const s of todo) {
    const c = (s.category || '').trim();
    s.folderId = c ? catFolderId(c) : null;
    patch('snippets', s.id, { folderId: s.folderId });
  }
  if (cats.size) toast(`Categorías convertidas en ${cats.size} carpeta(s) de prerredactados`, 'ok', 4000);
  ctx.renderList();
}

// ---------- Insertar en una nota (botón 📋) ----------
/** Selector con carpetas, favoritos y más usados primero, y buscador. Resuelve con el texto o null. */
export async function pickSnippetText() {
  const id = await browseSnippets();
  const s = id && store.snippets.get(id);
  if (!s) return null;
  return fillText(s, { copy: false });
}

const pickRank = (a, b) => (!!b.favorite - !!a.favorite) || (b.uses || 0) - (a.uses || 0) || byTitle(a, b);

function browseSnippets() {
  let folderId = null;
  let chosen;
  let closeFn = () => {};
  let kb = 0;
  const search = el('input', { type: 'search', placeholder: 'Buscar en título y texto…', autocomplete: 'off', enterkeyhint: 'search' });
  const crumbs = el('nav', { class: 'crumbs pick-crumbs', 'aria-label': 'Carpeta' });
  const list = el('div', { class: 'pick-list snip-pick' });

  const sec = (t) => el('div', { class: 'pick-sec' }, t);
  const item = (s) => {
    const path = snipPathText(s.folderId);
    return el('button', { type: 'button', class: 'pick-item', onclick: () => { chosen = s.id; closeFn(); } },
      el('span', { class: 'pick-t' }, s.favorite ? '⭐ ' : '', s.title || 'Sin título',
        s.uses ? el('span', { class: 'pick-n' }, ` · ${s.uses}×`) : null),
      el('span', { class: 'sub' }, path ? `📁 ${path}` : 'Sin carpeta'));
  };
  const folderRow = (f) => {
    const n = allSnippets().filter((s) => s.folderId && descendantIds(f.id, SF()).has(s.folderId)).length;
    return el('button', { type: 'button', class: 'pick-item pick-folder', onclick: () => go(f.id) },
      el('span', { class: 'pick-t' }, el('span', { class: 'pick-dot', style: f.color ? { background: f.color } : {} }), f.name),
      el('span', { class: 'sub' }, `${n} prerredactado${n === 1 ? '' : 's'}  ›`));
  };
  const go = (id) => { folderId = id; search.value = ''; render(); search.focus({ preventScroll: true }); };

  function render() {
    const q = norm(search.value.trim());
    const segs = [el('button', { type: 'button', onclick: () => go(null) }, '📋 Prerredactados')];
    for (const f of snipPath(folderId)) segs.push(el('span', { class: 'sep' }, '›'), el('button', { type: 'button', onclick: () => go(f.id) }, f.name));
    crumbs.replaceChildren(...segs);
    crumbs.classList.toggle('hidden', !folderId || !!q);
    const out = [];
    if (q) {
      const words = q.split(/\s+/);
      const hits = allSnippets().filter((s) => snippetMatches(s, words)).sort(pickRank).slice(0, 100);
      out.push(sec(`Resultados · ${hits.length}`), ...hits.map(item));
    } else if (!folderId) {
      const favs = allSnippets().filter((s) => s.favorite).sort(pickRank);
      const used = allSnippets().filter((s) => s.uses && !s.favorite).sort(pickRank).slice(0, 5);
      const folders = childFolders(null, SF());
      const loose = snippetsIn(null).sort(pickRank);
      if (favs.length) out.push(sec('⭐ Favoritos'), ...favs.map(item));
      if (used.length) out.push(sec('🔥 Más usados'), ...used.map(item));
      if (folders.length) out.push(sec('Carpetas'), ...folders.map(folderRow));
      if (loose.length) out.push(sec('Sin carpeta'), ...loose.map(item));
    } else {
      const folders = childFolders(folderId, SF());
      const here = snippetsIn(folderId).sort(pickRank);
      if (folders.length) out.push(sec('Subcarpetas'), ...folders.map(folderRow));
      if (here.length) out.push(sec('Prerredactados'), ...here.map(item));
      if (!folders.length && !here.length) out.push(el('div', { class: 'list-empty' }, 'Carpeta vacía'));
    }
    if (!out.length) out.push(el('div', { class: 'list-empty' }, q ? 'No hay prerredactados que coincidan.' : 'Aún no tienes prerredactados'));
    list.replaceChildren(...out);
    list.scrollTop = 0;
    kb = 0;
    list.querySelector('.pick-item')?.classList.add('kb');
  }
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    const btns = [...list.querySelectorAll('.pick-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      btns[kb]?.classList.remove('kb');
      kb = Math.max(0, Math.min(btns.length - 1, kb + (e.key === 'ArrowDown' ? 1 : -1)));
      btns[kb]?.classList.add('kb');
      btns[kb]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); btns[kb]?.click(); }
    else if (e.key === 'Backspace' && !search.value && folderId) { e.preventDefault(); go(SF().get(folderId)?.parentId || null); }
  });
  render();
  return modal({
    title: 'Insertar prerredactado', body: [search, crumbs, list], actions: [], cls: 'snip-picker',
    onOpen: (_box, close) => { closeFn = () => close(chosen); }
  }).then(() => chosen);
}

// ---------- Editor ----------
/** Crea un prerredactado. folderId = carpeta donde se crea; favorite si se crea desde «Favoritos». */
export function newSnippet({ folderId = null, favorite = false } = {}) {
  saveSoon.flush();
  const id = newId('snippets');
  const now = Date.now();
  const data = { title: '', body: '', category: '', folderId: folderId || null, favorite: !!favorite, order: now, uses: 0, lastUsedAt: null, createdAt: now, updatedAt: now };
  store.snippets.set(id, { id, ...data });
  put('snippets', id, data);
  openSnippet(id, { push: true, focusTitle: true });
}

export function openSnippet(id, { push = false, focusTitle = false, fromHash = false } = {}) {
  const s = store.snippets.get(id);
  if (!s) {
    if (!store.loaded.snippets) { setTimeout(() => openSnippet(id, { push, focusTitle, fromHash }), 300); return; }
    toast('El prerredactado no existe', 'error');
    closeSnippet();
    return;
  }
  if (curId !== id) saveSoon.flush();
  curId = id;
  dirty = false;
  ctx.showPane('snip');
  fillForm(s);
  $('#snip-status').textContent = '';
  if (!fromHash) ctx.pushHash(!push);
  ctx.renderList();
  if (focusTitle) $('#snip-title').focus();
}

export function closeSnippet({ fromHash = false } = {}) {
  saveSoon.flush();
  curId = null;
  if (!fromHash) ctx.pushHash(true);
}

function fillForm(s) {
  $('#snip-title').value = s.title || '';
  $('#snip-body').value = s.body || '';
  renderChrome(s);
}

/** Carpeta, favorito e información del prerredactado abierto */
function renderChrome(s) {
  const path = snipPathText(s.folderId);
  $('#snip-folder').textContent = path ? `📁 ${path}` : '📁 Sin carpeta';
  const fav = $('#snip-fav');
  fav.textContent = s.favorite ? '★' : '☆';
  fav.classList.toggle('on', !!s.favorite);
  fav.title = s.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos';
  renderInfo(s);
}

function renderInfo(s) {
  const nf = parseFields(s.body).size;
  $('#snip-info').textContent = [
    `Creado: ${longDate(s.createdAt)}`,
    `Modificado: ${longDate(s.updatedAt)}`,
    `${(s.body || '').length} caracteres`,
    nf ? `${nf} campo(s) a rellenar` : null,
    s.uses ? `Copiado ${s.uses} veces` : null
  ].filter(Boolean).join(' · ');
}

const saveSoon = debounce(saveNow, 700);
export const flushSnippet = () => saveSoon.flush();

function saveNow() {
  if (!curId || !dirty) return;
  const s = store.snippets.get(curId);
  if (!s) { dirty = false; return; }
  const body = $('#snip-body').value;
  if (body.length > 200000) { toast('Texto demasiado largo (máx. 200.000 caracteres)', 'error'); return; }
  dirty = false;
  const data = { title: $('#snip-title').value.trim(), body, updatedAt: Date.now() };
  Object.assign(s, data);
  patch('snippets', s.id, data);
  $('#snip-status').textContent = navigator.onLine ? 'Guardado ✓' : 'Guardado en el dispositivo';
  renderInfo(s);
  ctx.renderList();
}

/** Cambio llegado de otro dispositivo */
export function onSnippetsChange(changed) {
  if (!curId) return;
  const s = store.snippets.get(curId);
  if (!s) { curId = null; ctx.showPane('empty'); ctx.pushHash(true); return; }
  if (changed && !changed.has(curId)) { renderChrome(s); return; }
  const editing = dirty || ['snip-title', 'snip-body'].includes(document.activeElement?.id);
  if (!editing) fillForm(s); else renderChrome(s);
}

function duplicateSnippet(s) {
  saveSoon.flush();
  const id = newId('snippets');
  const now = Date.now();
  const { id: _old, ...rest } = s;
  void _old;
  const data = { ...rest, folderId: s.folderId || null, title: `${s.title || 'Sin título'} (copia)`, uses: 0, lastUsedAt: null, order: now, createdAt: now, updatedAt: now };
  store.snippets.set(id, { id, ...data });
  put('snippets', id, data);
  openSnippet(id, { push: true });
}

async function deleteSnippet(s) {
  if (!await confirm('Eliminar prerredactado', `¿Eliminar «${s.title || 'Sin título'}»? No se puede deshacer.`, { okLabel: 'Eliminar', danger: true })) return;
  const open = curId === s.id;
  if (open) { dirty = false; saveSoon.cancel(); }
  remove('snippets', s.id);
  store.snippets.delete(s.id);
  if (open) {
    curId = null;
    ctx.showPane('empty');
    ctx.showList();
    ctx.pushHash(true);
  }
  ctx.renderList();
  ctx.renderSidebar();
}

export function initSnippets(appCtx) {
  ctx = appCtx;
  const onInput = () => { dirty = true; $('#snip-status').textContent = 'Editando…'; saveSoon(); };
  ['#snip-title', '#snip-body'].forEach((sel) => $(sel).addEventListener('input', onInput));
  $('#snip-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#snip-body').focus(); } });
  // «←»: si el prerredactado tiene su entrada en el historial, volvemos atrás (como el botón de Android)
  $('#snip-back').addEventListener('click', () => {
    if (history.state?.nt && history.state?.d > 0) { saveSoon.flush(); history.back(); return; }
    closeSnippet(); ctx.showPane('empty'); ctx.showList(); ctx.renderList();
  });
  $('#snip-copy').addEventListener('click', () => { saveSoon.flush(); if (curId) copySnippet(curId); });
  $('#snip-fav').addEventListener('click', () => { if (curId) toggleFavorite(curId); });
  $('#snip-folder').addEventListener('click', () => { saveSoon.flush(); if (curId) moveSnippet(curId); });
  $('#snip-menu').addEventListener('click', (e) => { const s = store.snippets.get(curId); if (s) snippetItemMenu(e.currentTarget, s, { inList: false }); });
  // Tabulador inserta tabulación en el texto en vez de saltar de campo
  $('#snip-body').addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      const t = e.target;
      t.setRangeText('\t', t.selectionStart, t.selectionEnd, 'end');
      onInput();
    }
  });
}
