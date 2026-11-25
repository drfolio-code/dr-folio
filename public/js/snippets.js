// Prerredactados: textos fijos para copiar (exploraciones, consejos, informes…)
// Campos rellenables dentro del texto:  {edad}   o con opciones   {lado:derecho|izquierdo}
import { store, put, patch, remove, newId } from './store.js';
import { el, $, debounce, norm, shortDate, longDate } from './util.js';
import { toast, modal, confirm, menu, picker } from './ui.js';

const FIELD_RE = /\{([^{}\n:|]{1,40})(?::([^{}\n]{1,300}))?\}/g;

let ctx = null;        // ayudas de app.js
let curId = null;      // prerredactado abierto
let cat = null;        // filtro de categoría (null = todas)
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

/** Selector para insertar en una nota. Resuelve con el texto o null. */
export async function pickSnippetText() {
  const items = sortedSnippets('title').map((s) => ({ id: s.id, label: s.title || 'Sin título', sub: s.category || '' }));
  const id = await picker('Insertar prerredactado', items, { placeholder: 'Buscar prerredactado…', emptyText: 'Aún no tienes prerredactados' });
  const s = id && store.snippets.get(id);
  if (!s) return null;
  return fillText(s, { copy: false });
}

// ---------- Lista ----------
function sortedSnippets(sort) {
  const cmp = {
    updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    title: (a, b) => (a.title || 'Sin título').localeCompare(b.title || 'Sin título', 'es'),
    uses: (a, b) => (b.uses || 0) - (a.uses || 0) || (b.lastUsedAt || 0) - (a.lastUsedAt || 0)
  }[sort] || ((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return [...store.snippets.values()].sort(cmp);
}

export function categories() {
  const set = new Map();
  for (const s of store.snippets.values()) {
    const c = (s.category || '').trim();
    if (c && !set.has(norm(c))) set.set(norm(c), c);
  }
  return [...set.values()].sort((a, b) => a.localeCompare(b, 'es'));
}

export function renderSnippetList(box, { search, sort }) {
  const cats = categories();
  if (cat && !cats.some((c) => norm(c) === norm(cat))) cat = null;
  const bar = $('#snip-cats');
  bar.classList.toggle('hidden', !cats.length);
  bar.replaceChildren(...(cats.length ? [null, ...cats] : []).map((c) => el('button', {
    type: 'button', class: `chip ${norm(c || '') === norm(cat || '') ? 'on' : ''}`,
    onclick: () => { cat = c; ctx.renderList(); }
  }, c || 'Todas')));
  $('#snip-cat-suggest').replaceChildren(...cats.map((c) => el('option', { value: c })));

  if (!store.loaded.snippets) { box.replaceChildren(el('div', { class: 'list-empty' }, 'Cargando…')); return; }
  let list = sortedSnippets(sort);
  if (cat) list = list.filter((s) => norm(s.category || '') === norm(cat));
  const q = norm(search.trim());
  if (q) {
    const words = q.split(/\s+/);
    list = list.filter((s) => { const t = norm(`${s.title}\n${s.category}\n${s.body}`); return words.every((w) => t.includes(w)); });
  }
  if (!list.length) {
    box.replaceChildren(el('div', { class: 'list-empty' },
      q ? 'No hay prerredactados que coincidan.' : 'Aún no hay prerredactados. Crea el primero con ✎.'));
    return;
  }
  box.replaceChildren(...list.map((s) => {
    const nf = parseFields(s.body).size;
    return el('div', {
      class: `note-card snip-card ${s.id === curId ? 'active' : ''}`, role: 'button', tabindex: '0',
      onclick: (e) => { if (!e.target.closest('.snip-quick')) openSnippet(s.id, { push: true }); },
      onkeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openSnippet(s.id, { push: true }); }
    },
      el('div', { class: 'snip-card-main' },
        el('div', { class: 't' }, el('span', {}, s.title || 'Sin título')),
        el('div', { class: 's' }, (s.body || '').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Sin contenido'),
        el('div', { class: 'm' },
          s.category ? el('span', { class: 'mini-tag' }, s.category) : null,
          nf ? el('span', {}, `✏️ ${nf} campo${nf > 1 ? 's' : ''}`) : null,
          s.uses ? el('span', {}, `· usado ${s.uses}×`) : null,
          el('span', {}, `· ${shortDate(s.updatedAt)}`))),
      el('button', {
        class: 'icon-btn snip-quick', type: 'button', title: 'Copiar', 'aria-label': `Copiar ${s.title || ''}`,
        onclick: () => { saveSoon.flush(); copySnippet(s.id); }
      }, '⧉'));
  }));
}

// ---------- Editor ----------
export function newSnippet() {
  saveSoon.flush();
  const id = newId('snippets');
  const now = Date.now();
  const data = { title: '', body: '', category: cat || '', uses: 0, lastUsedAt: null, createdAt: now, updatedAt: now };
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
  $('#snip-cat').value = s.category || '';
  $('#snip-body').value = s.body || '';
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
  const data = {
    title: $('#snip-title').value.trim(),
    category: $('#snip-cat').value.trim(),
    body,
    updatedAt: Date.now()
  };
  Object.assign(s, data);
  patch('snippets', s.id, data);
  $('#snip-status').textContent = navigator.onLine ? 'Guardado ✓' : 'Guardado en el dispositivo';
  renderInfo(s);
  ctx.renderList();
}

/** Cambio llegado de otro dispositivo */
export function onSnippetsChange(changed) {
  if (!curId || !changed.has(curId)) return;
  const s = store.snippets.get(curId);
  if (!s) { curId = null; ctx.showPane('empty'); ctx.pushHash(true); return; }
  const editing = dirty || ['snip-title', 'snip-cat', 'snip-body'].includes(document.activeElement?.id);
  if (!editing) fillForm(s);
}

function snippetMenu(anchor) {
  const s = store.snippets.get(curId);
  if (!s) return;
  menu(anchor, [
    { icon: '⧉', label: 'Duplicar', onClick: () => {
      saveSoon.flush();
      const id = newId('snippets');
      const now = Date.now();
      const { id: _old, ...rest } = s;
      void _old;
      const data = { ...rest, title: `${s.title || 'Sin título'} (copia)`, uses: 0, lastUsedAt: null, createdAt: now, updatedAt: now };
      store.snippets.set(id, { id, ...data });
      put('snippets', id, data);
      openSnippet(id, { push: true });
    } },
    '-',
    { icon: '🗑', label: 'Eliminar', danger: true, onClick: async () => {
      if (!await confirm('Eliminar prerredactado', `¿Eliminar «${s.title || 'Sin título'}»? No se puede deshacer.`, { okLabel: 'Eliminar', danger: true })) return;
      dirty = false;
      saveSoon.cancel();
      remove('snippets', s.id);
      store.snippets.delete(s.id);
      curId = null;
      ctx.showPane('empty');
      ctx.showList();
      ctx.pushHash(true);
      ctx.renderList();
      ctx.renderSidebar();
    } }
  ]);
}

export function initSnippets(appCtx) {
  ctx = appCtx;
  const onInput = () => { dirty = true; $('#snip-status').textContent = 'Editando…'; saveSoon(); };
  ['#snip-title', '#snip-cat', '#snip-body'].forEach((sel) => $(sel).addEventListener('input', onInput));
  $('#snip-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#snip-body').focus(); } });
  $('#snip-back').addEventListener('click', () => { closeSnippet(); ctx.showPane('empty'); ctx.showList(); ctx.renderList(); });
  $('#snip-copy').addEventListener('click', () => { saveSoon.flush(); if (curId) copySnippet(curId); });
  $('#snip-menu').addEventListener('click', (e) => snippetMenu(e.currentTarget));
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
