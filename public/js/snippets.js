// Prerredactados: textos fijos para copiar (exploraciones, consejos, informes…)
// Desde v1.12.0 con texto enriquecido (el mismo editor de las notas) y modo lectura / edición.
// Campos rellenables dentro del texto:  {edad}   o con opciones   {lado:derecho|izquierdo}
// Contenido: `html` (formato) + `body` (texto plano para buscar y copiar) + `bh` (ver snipbody.js)
import { store, put, patch, remove, newId, folderPath, childFolders, descendantIds, flatFolders } from './store.js';
import { el, $, debounce, norm, shortDate, longDate } from './util.js';
import { toast, modal, confirm, menu, picker } from './ui.js';
import { icon } from './icons.js';
import { fitTitle } from './viewport.js';
import { FIELD_RE, htmlOf, bodyHash } from './snipbody.js';
import { fileBlob } from './files.js';

let ctx = null;        // ayudas de app.js
let editor = null;     // editor de texto enriquecido (createEditor, el mismo de las notas)
let curId = null;      // prerredactado abierto
let dirty = false;
let reading = false;   // modo lectura (como las notas)

export const isSnippetReading = () => !!curId && reading;

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

/** Rellena los campos en el HTML (solo en el texto, nunca en etiquetas) */
function applyFieldsHtml(html, values) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  const list = [];
  while (walker.nextNode()) list.push(walker.currentNode);
  for (const t of list) if (t.data.includes('{')) t.data = applyFields(t.data, values);
  return tpl.innerHTML;
}

const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });

/** HTML para pegar fuera (Word, correo): sin índice ni botones, bordes en las tablas, imágenes incrustadas */
async function richForClipboard(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const c = tpl.content;
  c.querySelectorAll('.note-toc,.sec-copy').forEach((n) => n.remove());
  c.querySelectorAll('a.note-link').forEach((a) => a.replaceWith(...a.childNodes)); // enlaces internos: solo el texto
  c.querySelectorAll('table').forEach((t) => t.setAttribute('style', 'border-collapse:collapse'));
  c.querySelectorAll('td,th').forEach((x) => x.setAttribute('style', `${x.getAttribute('style') || ''};border:1px solid #999;padding:4px 8px;vertical-align:top`));
  c.querySelectorAll('.keep-ws').forEach((x) => x.setAttribute('style', `${x.getAttribute('style') || ''};white-space:pre-wrap`));
  for (const img of c.querySelectorAll('img[data-file]')) {
    try { img.src = await blobToDataUrl(await fileBlob(img.dataset.file)); img.removeAttribute('data-file'); }
    catch { img.remove(); }
  }
  const box = document.createElement('div');
  box.append(c);
  return `<meta charset="utf-8"><div style="font-family:Calibri,Arial,sans-serif;font-size:11pt">${box.innerHTML}</div>`;
}

/** Copia con formato (y texto plano a la vez). Llamar dentro de un clic: el portapapeles se pide al momento. */
export function copyRich(html, text) {
  const fallback = () => {
    const box = el('div', { contenteditable: 'true', style: { position: 'fixed', top: '-2000px', left: '0', opacity: '0', whiteSpace: 'normal' } });
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('.note-toc,.sec-copy,img[data-file]').forEach((n) => n.remove());
    box.append(tpl.content);
    document.body.append(box);
    const r = document.createRange(); r.selectNodeContents(box);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    sel.removeAllRanges(); box.remove();
    return ok;
  };
  if (window.ClipboardItem && navigator.clipboard?.write) {
    try {
      const item = new ClipboardItem({
        'text/html': richForClipboard(html).then((h) => new Blob([h], { type: 'text/html' })),
        'text/plain': new Blob([text], { type: 'text/plain' })
      });
      return navigator.clipboard.write([item]).then(() => true, () => fallback());
    } catch { /* navegador sin promesas en ClipboardItem */ }
  }
  return Promise.resolve(fallback());
}

/** Texto plano y HTML del prerredactado (el abierto se guarda antes) */
function sourceOf(s) { return { text: s.body || '', html: htmlOf(s) }; }

/**
 * Prepara el resultado final. Sin campos: lo devuelve tal cual. Con campos: muestra un formulario.
 * mode: 'copy' (texto plano) | 'rich' (con formato) | 'insert' (para una nota, con formato).
 * text/html: lo que se rellena (por defecto, el prerredactado entero; en «Copiar sección», solo esa parte).
 * Copia dentro del clic del botón (lo exige iOS). Resuelve con {text, html} o null si se cancela.
 */
async function fillText(s, { mode = 'copy', text = s.body || '', html = null, btn = null } = {}) {
  const fields = parseFields(text);
  const done = async (values) => {
    const out = { text: applyFields(text, values), html: html ? applyFieldsHtml(html, values) : null };
    if (mode !== 'insert') {
      const ok = await (mode === 'rich' && out.html ? copyRich(out.html, out.text) : copyText(out.text));
      toast(ok ? (mode === 'rich' ? 'Copiado con formato ✓' : 'Copiado ✓') : 'No se pudo copiar', ok ? 'ok' : 'error', 1800);
      if (!ok) return null;
      if (btn) { btn.classList.add('done'); setTimeout(() => btn.classList.remove('done'), 1400); }
    }
    countUse(s);
    return out;
  };
  if (!fields.size) return done(new Map());

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
  const refresh = () => { preview.textContent = applyFields(text, values(false)); };
  inputs.forEach((i) => i.addEventListener('input', refresh));
  refresh();
  let result = null;
  const label = mode === 'insert' ? 'Insertar' : mode === 'rich' ? '⧉ Copiar con formato' : '⧉ Copiar';
  await modal({
    title: s.title || 'Rellenar campos',
    wide: true,
    body: [...rows, el('div', { class: 'muted small' }, mode === 'copy' ? 'Vista previa (así se pegará)' : 'Vista previa del texto'), preview],
    actions: [
      { label: 'Cancelar' },
      { label, primary: true, onClick: async () => {
        result = await done(values(true));
        return result != null;
      } }
    ]
  });
  return result;
}

/** Copia un prerredactado (pide los campos si los tiene). rich = con formato. Llamar desde un clic. */
export function copySnippet(id, { rich = false, btn = null } = {}) {
  const s = store.snippets.get(id);
  if (!s) return;
  if (!(s.body || '').trim() && !/<img/.test(htmlOf(s))) { toast('Este prerredactado está vacío', 'error'); return; }
  const src = sourceOf(s);
  fillText(s, { mode: rich ? 'rich' : 'copy', text: src.text, html: rich ? src.html : null, btn });
}

/** «Copiar sección» (modo lectura): el texto de esa sección, con sus campos */
function copySection(text, btn) {
  const s = store.snippets.get(curId);
  if (!s) return;
  if (!text.trim()) { toast('No hay texto que copiar'); return; }
  fillText(s, { mode: 'copy', text, btn });
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
export function snippetCard(s, { search = '', showPath = false, onLongPress = null, onOpen = null } = {}) {
  const nf = parseFields(s.body).size;
  const path = showPath ? snipPathText(s.folderId) : '';
  const card = el('div', {
    class: `note-card snip-card ${s.id === curId ? 'active' : ''}`, role: 'button', tabindex: '0',
    onclick: (e) => {
      if (e.target.closest('.snip-quick') || (onLongPress && onLongPress(card))) return;
      if (onOpen) onOpen(s.id); else openSnippet(s.id, { push: true });
    },
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { if (onOpen) onOpen(s.id); else openSnippet(s.id, { push: true }); } }
  },
    el('div', { class: 'snip-card-main' },
      el('div', { class: 't' }, el('span', {}, s.title || 'Sin título')),
      el('div', { class: 's' }, previewNode(s, search)),
      el('div', { class: 'm' },
        path ? el('span', { class: 'snip-path' }, icon('folder'), ` ${path}`) : null,
        nf ? el('span', {}, icon('pencil'), ` ${nf} campo${nf > 1 ? 's' : ''}`) : null,
        s.uses ? el('span', {}, `· usado ${s.uses}×`) : null,
        el('span', {}, `· ${shortDate(s.updatedAt)}`))),
    el('div', { class: 'snip-btns' },
      el('button', {
        class: `icon-btn snip-quick snip-star ${s.favorite ? 'on' : ''}`, type: 'button',
        title: s.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', 'aria-label': s.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos',
        onclick: () => toggleFavorite(s.id)
      }, icon('star')),
      el('button', {
        class: 'icon-btn snip-quick', type: 'button', title: 'Copiar', 'aria-label': `Copiar ${s.title || ''}`,
        onclick: (e) => { saveSoon.flush(); copySnippet(s.id, { btn: e.currentTarget }); }
      }, icon('copy'))));
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
    inList ? { icon: 'file-text', label: 'Abrir', onClick: () => openSnippet(s.id, { push: true }) } : null,
    { icon: 'copy', label: 'Copiar sin formato', onClick: () => { saveSoon.flush(); copySnippet(s.id); } },
    { icon: 'clipboard-list', label: 'Copiar con formato (Word, correo)', onClick: () => { saveSoon.flush(); copySnippet(s.id, { rich: true }); } },
    !inList && curId === s.id ? { icon: 'list', label: editor.hasTocBlock() ? 'Quitar índice' : 'Añadir índice', onClick: toggleToc } : null,
    !inList && curId === s.id ? (reading
      ? { icon: 'pencil', label: 'Editar', onClick: () => setReading(false) }
      : { icon: 'book-open', label: 'Modo lectura', onClick: () => setReading(true) }) : null,
    { icon: 'star', label: s.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos', onClick: () => toggleFavorite(s.id) },
    { icon: 'folder-input', label: 'Mover a carpeta…', onClick: () => moveSnippet(s.id) },
    inList && i > 0 ? { icon: 'arrow-up', label: 'Subir', onClick: () => shiftSnippet(s, -1) } : null,
    inList && i >= 0 && i < sibs.length - 1 ? { icon: 'arrow-down', label: 'Bajar', onClick: () => shiftSnippet(s, 1) } : null,
    { icon: 'copy-plus', label: 'Duplicar', onClick: () => duplicateSnippet(s) },
    '-',
    { icon: 'trash-2', label: 'Eliminar', danger: true, onClick: () => deleteSnippet(s) }
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
/** Selector con carpetas, favoritos y más usados primero, y buscador. Resuelve con {html, text} (con su formato) o null. */
export async function pickSnippetText() {
  saveSoon.flush();
  const id = await browseSnippets();
  const s = id && store.snippets.get(id);
  if (!s) return null;
  const src = sourceOf(s);
  return fillText(s, { mode: 'insert', text: src.text, html: src.html });
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
      el('span', { class: 'pick-t' }, s.favorite ? [icon('star', 'fav-mark'), ' '] : '', s.title || 'Sin título',
        s.uses ? el('span', { class: 'pick-n' }, ` · ${s.uses}×`) : null),
      el('span', { class: 'sub' }, path ? [icon('folder'), ` ${path}`] : 'Sin carpeta'));
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
    const segs = [el('button', { type: 'button', onclick: () => go(null) }, icon('clipboard-list'), ' Prerredactados')];
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
      if (favs.length) out.push(sec([icon('star'), ' Favoritos']), ...favs.map(item));
      if (used.length) out.push(sec([icon('flame'), ' Más usados']), ...used.map(item));
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
  const data = { title: '', body: '', html: '', bh: bodyHash(''), category: '', folderId: folderId || null, favorite: !!favorite, order: now, uses: 0, lastUsedAt: null, createdAt: now, updatedAt: now };
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
  const same = curId === id;
  if (!same) saveSoon.flush();
  curId = id;
  dirty = false;
  // Los nuevos (focusTitle) se abren en edición; el resto, según Ajustes (como las notas; por defecto, lectura)
  if (!same || focusTitle) reading = !focusTitle && ctx.openMode() === 'read';
  ctx.showPane('snip');
  fillForm(s);
  if (!same) $('#snip-scroll').scrollTop = 0;
  $('#snip-status').textContent = '';
  if (!fromHash) ctx.pushHash(!push);
  ctx.renderList();
  if (focusTitle) $('#snip-title').focus();
  ctx.updateWakeLock();
}

export function closeSnippet({ fromHash = false } = {}) {
  saveSoon.flush();
  curId = null;
  reading = false;
  editor?.hideFloating();
  if (!fromHash) ctx.pushHash(true);
  ctx.updateWakeLock();
}

function fillForm(s) {
  $('#snip-title').value = s.title || '';
  requestAnimationFrame(() => fitTitle($('#snip-title')));
  editor.setContent(htmlOf(s));
  renderChrome(s);
}

/** Índice opcional (⋯ → Añadir / Quitar índice), también en lectura */
function toggleToc() {
  if (!curId) return;
  const on = editor.toggleTocBlock();
  dirty = true;
  saveSoon.cancel();
  saveNow();
  toast(on ? (editor.headings().length ? 'Índice añadido ✓' : 'Índice añadido: usa «Título 1/2/3» y se rellenará solo') : 'Índice quitado', 'ok', 2500);
}

/** Lectura / edición: igual que en las notas */
function setReading(on) {
  if (!curId) return;
  if (on) {
    saveSoon.flush();
    document.activeElement?.blur?.();
    window.getSelection()?.removeAllRanges();
  }
  reading = on;
  renderChrome(store.snippets.get(curId));
  if (!on) editor.focus();
  ctx.updateWakeLock();
}

/** Carpeta, favorito, lectura/edición e información del prerredactado abierto */
function renderChrome(s) {
  if (!s) return;
  const wrap = $('#snip-wrap');
  wrap.classList.toggle('readonly', reading);
  wrap.classList.toggle('reading', reading);
  editor.setReadOnly(reading);
  $('#snip-title').readOnly = reading;
  $('#snip-title').tabIndex = reading ? -1 : 0;
  const eb = $('#snip-edit');
  eb.classList.toggle('primary', !reading);
  eb.title = reading ? 'Editar el prerredactado' : 'Terminar de editar (modo lectura)';
  eb.setAttribute('aria-label', eb.title);
  eb.querySelector('.ico').replaceChildren(icon(reading ? 'pencil' : 'check'));
  eb.querySelector('.lbl').textContent = reading ? 'Editar' : 'Listo';
  const path = snipPathText(s.folderId);
  $('#snip-folder').replaceChildren(icon('folder'), ` ${path || 'Sin carpeta'}`);
  const fav = $('#snip-fav');
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
  const html = editor.getContent();
  const body = editor.allText(); // texto plano «para pegar»: tablas con tabuladores, listas con guiones
  if (html.length + body.length > 800000) { toast('Prerredactado demasiado largo (máx. ~800 KB de texto)', 'error'); return; }
  dirty = false;
  const data = { title: $('#snip-title').value.trim(), html, body, bh: bodyHash(body), updatedAt: Date.now() };
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
  if (!s) { curId = null; reading = false; ctx.showPane('empty'); ctx.pushHash(true); return; }
  if (changed && !changed.has(curId)) { renderChrome(s); return; }
  const editing = dirty || editor.isFocused() || document.activeElement?.id === 'snip-title';
  if (editing) { renderChrome(s); return; }
  const html = htmlOf(s);
  if (html !== editor.getContent()) {
    const sc = $('#snip-scroll').scrollTop;
    fillForm(s);
    $('#snip-scroll').scrollTop = sc;
  } else {
    if ($('#snip-title').value !== (s.title || '')) { $('#snip-title').value = s.title || ''; fitTitle($('#snip-title')); }
    renderChrome(s);
  }
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
  if (!await confirm('Eliminar prerredactado', `¿Eliminar «${s.title || 'Sin título'}»${/data-file=/.test(s.html || '') ? ' y sus imágenes' : ''}? No se puede deshacer.`, { okLabel: 'Eliminar', danger: true })) return;
  const open = curId === s.id;
  if (open) { dirty = false; saveSoon.cancel(); }
  ctx.purgeSnippetFiles(s.id); // imágenes que ya no usa nadie (antes de quitarlo de la memoria)
  remove('snippets', s.id);
  store.snippets.delete(s.id);
  if (open) {
    curId = null;
    reading = false;
    ctx.showPane('empty');
    ctx.showList();
    ctx.pushHash(true);
  }
  ctx.renderList();
  ctx.renderSidebar();
}

export function initSnippets(appCtx) {
  ctx = appCtx;
  editor = ctx.editor;
  const onInput = () => { dirty = true; $('#snip-status').textContent = 'Editando…'; saveSoon(); };
  $('#snip-title').addEventListener('input', onInput);
  $('#snip-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(); } });
  // «←»: si el prerredactado tiene su entrada en el historial, volvemos atrás (como el botón de Android)
  $('#snip-back').addEventListener('click', () => {
    if (history.state?.nt && history.state?.d > 0) { saveSoon.flush(); history.back(); return; }
    closeSnippet(); ctx.showPane('empty'); ctx.showList(); ctx.renderList();
  });
  $('#snip-copy').addEventListener('click', (e) => { saveSoon.flush(); if (curId) copySnippet(curId, { btn: e.currentTarget }); });
  $('#snip-edit').addEventListener('click', () => setReading(!reading));
  $('#snip-font-down').addEventListener('click', () => ctx.fontStep(-1));
  $('#snip-font-up').addEventListener('click', () => ctx.fontStep(1));
  $('#snip-fav').addEventListener('click', () => { if (curId) toggleFavorite(curId); });
  $('#snip-folder').addEventListener('click', () => { saveSoon.flush(); if (curId) moveSnippet(curId); });
  $('#snip-menu').addEventListener('click', (e) => { const s = store.snippets.get(curId); if (s) snippetItemMenu(e.currentTarget, s, { inList: false }); });
}

/** Del editor de prerredactados (app.js lo crea con createEditor y estas funciones) */
export function onSnippetEditorChange() {
  if (!curId || reading) return;
  dirty = true;
  $('#snip-status').textContent = 'Editando…';
  saveSoon();
}
export const onSnippetSectionCopy = (text, btn) => copySection(text, btn);
export const snippetImageOwner = () => curId;
