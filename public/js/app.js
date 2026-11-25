// Dr.Folio — aplicación principal
import { OWNER_UID, APP_VERSION, LIMITS } from './config.js';
import { onAuth, login, logout, resetPassword, initDb, getMode, authError, auth } from './db.js';
import {
  store, startSync, stopSync, put, patch, remove, newId, setWriteErrorHandler, hasPending,
  childFolders, folderPath, descendantIds, flatFolders, liveNotes, tagByName, usageBytes
} from './store.js';
import { compressImage, saveFile, fileUrl, fileBlob, deleteFile, revokeAll } from './files.js';
import { createEditor, escapeHtml } from './editor.js';
import { el, $, $$, debounce, norm, shortDate, longDate, formatBytes, download } from './util.js';
import { toast, modal, prompt, confirm, menu, picker, colorPicker, modalOpen } from './ui.js';

// ====================== Estado ======================
const S = {
  view: { type: 'all', id: null },
  noteId: null,
  search: '',
  sort: localStorage.getItem('drfolio.sort') || 'updated',
  expanded: new Set(JSON.parse(localStorage.getItem('drfolio.expanded') || '[]')),
  dirty: false,
  loadedHtml: null,
  started: false,
  loggingOut: false
};
let editor = null;

// ====================== Arranque ======================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

const setScreen = (s) => { document.body.dataset.screen = s; };

onAuth(async (user) => {
  if (!user) {
    if (S.loggingOut) return;
    if (S.started) { location.reload(); return; }
    setScreen('login');
    const why = sessionStorage.getItem('drfolio.logoutReason');
    if (why) { loginMsg(why, true); sessionStorage.removeItem('drfolio.logoutReason'); }
    return;
  }
  if (user.uid !== OWNER_UID) {
    await logout();
    setScreen('login');
    loginMsg('Esta cuenta no tiene acceso a Dr.Folio.');
    return;
  }
  if (!S.started) startApp(user);
});

// ---------- Login ----------
function loginMsg(text, ok = false) {
  const m = $('#login-msg');
  m.textContent = text;
  m.classList.toggle('ok', ok);
}
$('#login-public').checked = getMode() === 'public';
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  btn.disabled = true; btn.textContent = 'Entrando…';
  loginMsg('');
  try {
    await login($('#login-email').value.trim(), $('#login-pass').value, $('#login-public').checked);
    $('#login-pass').value = '';
  } catch (err) {
    loginMsg(authError(err));
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});
$('#login-reset').addEventListener('click', async () => {
  const email = $('#login-email').value.trim();
  if (!email) { loginMsg('Escribe tu correo arriba y vuelve a pulsar.'); return; }
  try {
    await resetPassword(email);
    loginMsg('Si el correo es correcto, recibirás un enlace para cambiar la contraseña.', true);
  } catch (err) { loginMsg(authError(err)); }
});

// ====================== App ======================
function startApp(user) {
  S.started = true;
  initDb();
  setWriteErrorHandler((e) => {
    console.error(e);
    toast(e.code === 'permission-denied' ? 'Sin permiso para guardar. Revisa las reglas de seguridad.' : `Error al guardar: ${e.message}`, 'error', 5000);
  });

  editor = createEditor({
    onChange: onEditorChange,
    onNoteLink: (id) => {
      if (!store.notes.has(id)) { toast('Esa nota ya no existe', 'error'); return; }
      openNote(id, { push: true });
    },
    onImage: (fileId, src) => openViewer({ fileId, src, name: 'Imagen', kind: 'image' }),
    pickNote: pickNoteForLink,
    uploadImages,
    resolveImage: fileUrl,
    noteExists: (id) => store.notes.has(id) && !store.notes.get(id).trashed,
    onDropFiles: (files) => files.forEach((f) => addAttachment(f))
  });

  bindUi();
  applyHash();
  setScreen('app');
  renderAll();

  startSync(user.uid, onData, (name, err) => {
    console.error(name, err);
    toast(err.code === 'permission-denied'
      ? 'Sin permiso para leer tus datos. ¿Están publicadas las reglas de Firestore?'
      : `Error de sincronización: ${err.message}`, 'error', 6000);
  });

  if (getMode() === 'public') startInactivityWatch();
  $('#mode-badge').textContent = getMode() === 'public' ? 'Ordenador público' : 'Este dispositivo';
  $('#mode-badge').classList.toggle('public', getMode() === 'public');
}

// ---------- Datos entrantes ----------
const renderListSoon = debounce(() => renderList(), 60);
const renderSidebarSoon = debounce(() => renderSidebar(), 60);

function onData(name, changed) {
  updateSync();
  if (name === 'notes') {
    renderListSoon();
    renderSidebarSoon();
    if (S.noteId && changed.has(S.noteId)) onCurrentNoteRemoteChange();
    else if (S.noteId) { renderBacklinks(); editor.markLinks(); }
  } else if (name === 'folders' || name === 'tags') {
    renderSidebarSoon();
    renderListSoon();
    if (S.noteId) renderNoteChrome();
  } else if (name === 'files') {
    if (S.noteId) renderRefs();
  }
}

function onCurrentNoteRemoteChange() {
  const n = store.notes.get(S.noteId);
  if (!n) { closeEditor(); return; }
  renderNoteChrome();
  // Si la nota cambió en otro dispositivo y aquí no estás editando, actualizamos el contenido
  const editingHere = S.dirty || editor.isFocused() || document.activeElement === $('#ed-title');
  if (!editingHere && n.html !== S.loadedHtml) {
    const sc = $('#ed-scroll').scrollTop;
    editor.setContent(n.html);
    S.loadedHtml = n.html;
    $('#ed-scroll').scrollTop = sc;
    renderToc();
  }
  if (!editingHere && document.activeElement !== $('#ed-title')) $('#ed-title').value = n.title || '';
}

function updateSync() {
  const s = $('#sync-status');
  if (!navigator.onLine) { s.className = 'sync offline'; s.textContent = 'Sin conexión'; }
  else if (hasPending()) { s.className = 'sync pending'; s.textContent = 'Sincronizando…'; }
  else { s.className = 'sync'; s.textContent = 'Sincronizado'; }
}
window.addEventListener('online', updateSync);
window.addEventListener('offline', () => {
  updateSync();
  if (getMode() === 'public') toast('Sin conexión: en un ordenador público los cambios se pierden si cierras la pestaña.', 'error', 6000);
});

// ====================== Interfaz ======================
function bindUi() {
  // Navegación lateral
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => setView({ type: b.dataset.view, id: null })));
  $('#btn-new-folder').addEventListener('click', () => newFolder(null));
  $('#btn-settings').addEventListener('click', openSettings);
  ['#btn-new-note', '#btn-new-note-side', '#btn-new-note-empty'].forEach((s) => $(s).addEventListener('click', newNote));
  $('#btn-menu').addEventListener('click', () => $('#app').classList.add('drawer'));
  $('#scrim').addEventListener('click', closeDrawer);
  $('#btn-back').addEventListener('click', () => closeEditor());

  // Lista
  $('#search').addEventListener('input', debounce(() => { S.search = $('#search').value; renderList(); }, 120));
  $('#sort').value = S.sort;
  $('#sort').addEventListener('change', () => { S.sort = $('#sort').value; localStorage.setItem('drfolio.sort', S.sort); renderList(); });
  $('#btn-empty-trash').addEventListener('click', emptyTrash);

  // Editor
  $('#ed-title').addEventListener('input', () => { S.dirty = true; setSaveStatus('Editando…'); saveSoon(); });
  $('#ed-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(); } });
  $('#ed-folder').addEventListener('click', () => moveNote(S.noteId));
  $('#btn-pin').addEventListener('click', () => {
    const n = store.notes.get(S.noteId); if (!n) return;
    patch('notes', n.id, { pinned: !n.pinned });
  });
  $('#btn-note-menu').addEventListener('click', (e) => noteMenu(e.currentTarget));
  $('#btn-restore').addEventListener('click', () => restoreNote(S.noteId));
  $('#btn-delete-forever').addEventListener('click', () => deleteForever(S.noteId));
  $('#btn-add-ref').addEventListener('click', () => editRef(null));

  const tagInput = $('#tag-input');
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagToNote(tagInput.value); }
    if (e.key === 'Backspace' && !tagInput.value) {
      const n = store.notes.get(S.noteId);
      if (n?.tags?.length) removeTagFromNote(n.tags[n.tags.length - 1]);
    }
  });
  tagInput.addEventListener('change', () => { if (tagInput.value.trim()) addTagToNote(tagInput.value); });
  tagInput.addEventListener('blur', () => { if (tagInput.value.trim()) addTagToNote(tagInput.value); });

  $('#file-pdf').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f && pendingRefFile) pendingRefFile(f);
  });

  // Atajos de teclado
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveSoon.flush(); setSaveStatus('Guardado ✓'); }
    else if (mod && e.key.toLowerCase() === 'k' && !editor.isFocused()) { e.preventDefault(); showList(); $('#search').focus(); }
    else if (mod && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
    else if (e.key === 'Escape' && !modalOpen()) closeDrawer();
  });

  // Guardar antes de salir
  window.addEventListener('beforeunload', () => saveSoon.flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSoon.flush(); });
  window.addEventListener('popstate', applyHash);
}

const closeDrawer = () => $('#app').classList.remove('drawer');
const showList = () => { $('#app').dataset.view = 'list'; };

// ---------- Rutas (#/folder/ID/n/NOTA) ----------
function hashFor(view, noteId) {
  let h = `#/${view.type}${view.id ? `/${view.id}` : ''}`;
  if (noteId) h += `/n/${noteId}`;
  return h;
}
function pushHash(replace = false) {
  const h = hashFor(S.view, S.noteId);
  if (location.hash === h) return;
  if (replace) history.replaceState(null, '', h); else history.pushState(null, '', h);
}
function applyHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let view = { type: 'all', id: null };
  let noteId = null;
  if (parts[0] === 'nota' && parts[1]) noteId = parts[1];
  else if (['all', 'pinned', 'trash'].includes(parts[0])) {
    view = { type: parts[0], id: null };
    if (parts[1] === 'n') noteId = parts[2];
  } else if (['folder', 'tag'].includes(parts[0]) && parts[1]) {
    view = { type: parts[0], id: parts[1] };
    if (parts[2] === 'n') noteId = parts[3];
  }
  S.view = view;
  renderSidebar(); renderList();
  if (noteId) openNote(noteId, { fromHash: true });
  else closeEditor({ fromHash: true });
}

function setView(view) {
  saveSoon.flush();
  S.view = view;
  S.search = ''; $('#search').value = '';
  closeDrawer();
  S.noteId = null;
  showEditorEmpty();
  showList();
  pushHash();
  renderSidebar(); renderList();
}

// ====================== Barra lateral ======================
function renderAll() { renderSidebar(); renderList(); }

function renderSidebar() {
  const live = liveNotes();
  $('#count-all').textContent = live.length || '';
  $('#count-pinned').textContent = live.filter((n) => n.pinned).length || '';
  $('#count-trash').textContent = [...store.notes.values()].filter((n) => n.trashed).length || '';
  $$('.nav-item').forEach((b) => b.classList.toggle('active', S.view.type === b.dataset.view));

  // Recuento por carpeta (incluye subcarpetas)
  const direct = new Map();
  for (const n of live) if (n.folderId) direct.set(n.folderId, (direct.get(n.folderId) || 0) + 1);
  const total = (id) => [...descendantIds(id)].reduce((s, f) => s + (direct.get(f) || 0), 0);

  const tree = $('#folder-tree');
  const rows = [];
  const walk = (parentId, depth) => {
    for (const f of childFolders(parentId)) {
      const kids = childFolders(f.id).length > 0;
      const open = S.expanded.has(f.id);
      const row = el('div', {
        class: `tree-row ${S.view.type === 'folder' && S.view.id === f.id ? 'active' : ''}`,
        style: { '--depth': depth }, role: 'button', tabindex: '0',
        onclick: (e) => { if (!e.target.closest('.caret,.more')) setView({ type: 'folder', id: f.id }); },
        onkeydown: (e) => { if (e.key === 'Enter') setView({ type: 'folder', id: f.id }); }
      },
        el('span', {
          class: `caret ${kids ? '' : 'empty'}`,
          onclick: (e) => { e.stopPropagation(); toggleFolder(f.id); }
        }, open ? '▼' : '▶'),
        el('span', { class: 'dot', style: f.color ? { background: f.color } : {} }),
        el('span', { class: 'lbl' }, f.name),
        el('span', { class: 'count' }, total(f.id) || ''),
        el('button', { class: 'more', title: 'Opciones', 'aria-label': 'Opciones de carpeta', onclick: (e) => { e.stopPropagation(); folderMenu(e.currentTarget, f); } }, '⋯'));
      rows.push(row);
      if (kids && open) walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  tree.replaceChildren(...(rows.length ? rows : [el('div', { class: 'side-empty' }, 'Crea tu primera carpeta con ＋')]));

  const tags = [...store.tags.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const tagCount = new Map();
  for (const n of live) for (const t of n.tags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
  $('#tag-list').replaceChildren(...(tags.length ? tags.map((t) => el('div', {
    class: `tag-item ${S.view.type === 'tag' && S.view.id === t.id ? 'active' : ''}`, role: 'button', tabindex: '0',
    onclick: (e) => { if (!e.target.closest('.more')) setView({ type: 'tag', id: t.id }); }
  },
    el('span', { class: 'hash', style: t.color ? { color: t.color } : {} }, '#'),
    el('span', { class: 'lbl' }, t.name),
    el('span', { class: 'count' }, tagCount.get(t.id) || ''),
    el('button', { class: 'more', 'aria-label': 'Opciones de etiqueta', onclick: (e) => { e.stopPropagation(); tagMenu(e.currentTarget, t); } }, '⋯')
  )) : [el('div', { class: 'side-empty' }, 'Añade etiquetas desde una nota')]));

  // Datalist de etiquetas
  $('#tag-suggest').replaceChildren(...tags.map((t) => el('option', { value: t.name })));
}

function toggleFolder(id) {
  if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id);
  localStorage.setItem('drfolio.expanded', JSON.stringify([...S.expanded]));
  renderSidebar();
}

// ---------- Carpetas ----------
async function newFolder(parentId) {
  const name = await prompt(parentId ? 'Nueva subcarpeta' : 'Nueva carpeta', '', { placeholder: 'Nombre (p. ej. Urgencias)' });
  if (!name) return;
  const id = newId('folders');
  const now = Date.now();
  put('folders', id, { name, parentId: parentId || null, color: null, order: now, createdAt: now, updatedAt: now });
  if (parentId) { S.expanded.add(parentId); localStorage.setItem('drfolio.expanded', JSON.stringify([...S.expanded])); }
  return id;
}

function folderMenu(anchor, f) {
  menu(anchor, [
    { icon: '＋', label: 'Nueva subcarpeta', onClick: () => newFolder(f.id) },
    { icon: '✎', label: 'Nueva nota aquí', onClick: () => { setView({ type: 'folder', id: f.id }); newNote(); } },
    '-',
    { icon: '✏️', label: 'Renombrar', onClick: async () => {
      const name = await prompt('Renombrar carpeta', f.name);
      if (name) patch('folders', f.id, { name, updatedAt: Date.now() });
    } },
    { icon: '🎨', label: 'Color', onClick: async () => {
      const c = await colorPicker('Color de la carpeta', ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '']);
      if (c !== undefined) patch('folders', f.id, { color: c || null });
    } },
    { icon: '↗', label: 'Mover a…', onClick: () => moveFolder(f) },
    '-',
    { icon: '🗑', label: 'Eliminar carpeta', danger: true, onClick: () => deleteFolder(f) }
  ]);
}

async function moveFolder(f) {
  const banned = descendantIds(f.id);
  const items = [{ id: '__root', label: '— Nivel principal —' },
    ...flatFolders().filter((x) => !banned.has(x.id)).map((x) => ({ id: x.id, label: x.name, depth: x.depth }))];
  const target = await picker(`Mover «${f.name}» a…`, items);
  if (!target) return;
  patch('folders', f.id, { parentId: target === '__root' ? null : target, updatedAt: Date.now() });
}

async function deleteFolder(f) {
  const parent = f.parentId ? store.folders.get(f.parentId) : null;
  const notes = [...store.notes.values()].filter((n) => n.folderId === f.id);
  const kids = childFolders(f.id);
  const dest = parent ? `«${parent.name}»` : 'sin carpeta';
  const ok = await confirm('Eliminar carpeta',
    notes.length || kids.length
      ? `«${f.name}» tiene ${notes.length} nota(s) y ${kids.length} subcarpeta(s). No se borra nada: pasarán a ${dest}.`
      : `¿Eliminar la carpeta «${f.name}»?`,
    { okLabel: 'Eliminar carpeta', danger: true });
  if (!ok) return;
  for (const k of kids) patch('folders', k.id, { parentId: f.parentId || null });
  for (const n of notes) patch('notes', n.id, { folderId: f.parentId || null });
  remove('folders', f.id);
  if (S.view.type === 'folder' && S.view.id === f.id) setView({ type: 'all', id: null });
}

// ---------- Etiquetas ----------
function tagMenu(anchor, t) {
  menu(anchor, [
    { icon: '✏️', label: 'Renombrar', onClick: async () => {
      const name = await prompt('Renombrar etiqueta', t.name);
      if (!name || name === t.name) return;
      const other = tagByName(name);
      if (other && other.id !== t.id) { toast('Ya existe una etiqueta con ese nombre', 'error'); return; }
      patch('tags', t.id, { name });
    } },
    { icon: '🎨', label: 'Color', onClick: async () => {
      const c = await colorPicker('Color de la etiqueta', ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '']);
      if (c !== undefined) patch('tags', t.id, { color: c || null });
    } },
    '-',
    { icon: '🗑', label: 'Eliminar etiqueta', danger: true, onClick: async () => {
      if (!await confirm('Eliminar etiqueta', `Se quitará «${t.name}» de todas las notas. Las notas no se borran.`, { okLabel: 'Eliminar', danger: true })) return;
      for (const n of store.notes.values()) {
        if ((n.tags || []).includes(t.id)) patch('notes', n.id, { tags: n.tags.filter((x) => x !== t.id) });
      }
      remove('tags', t.id);
      if (S.view.type === 'tag' && S.view.id === t.id) setView({ type: 'all', id: null });
    } }
  ]);
}

function addTagToNote(raw) {
  const input = $('#tag-input');
  input.value = '';
  const n = store.notes.get(S.noteId);
  if (!n || n.trashed) return;
  const names = raw.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean);
  const tags = [...(n.tags || [])];
  for (const name of names) {
    let t = tagByName(name);
    if (!t) {
      const id = newId('tags');
      t = { id, name: name.slice(0, 60), color: null, createdAt: Date.now() };
      store.tags.set(id, t); // visible al instante
      put('tags', id, { name: t.name, color: null, createdAt: t.createdAt });
    }
    if (!tags.includes(t.id)) tags.push(t.id);
  }
  patch('notes', n.id, { tags, updatedAt: Date.now() });
}

function removeTagFromNote(tagId) {
  const n = store.notes.get(S.noteId);
  if (!n) return;
  patch('notes', n.id, { tags: (n.tags || []).filter((t) => t !== tagId), updatedAt: Date.now() });
}

// ====================== Lista de notas ======================
const searchCache = new Map(); // id -> {u, s}
function searchable(n) {
  const c = searchCache.get(n.id);
  const key = `${n.updatedAt}|${(n.tags || []).join(',')}`;
  if (c && c.k === key) return c.s;
  const tagNames = (n.tags || []).map((t) => store.tags.get(t)?.name || '').join(' ');
  const refs = (n.refs || []).map((r) => `${r.cite || ''} ${r.fileName || ''}`).join(' ');
  const s = norm(`${n.title || ''}\n${tagNames}\n${n.text || ''}\n${refs}`);
  searchCache.set(n.id, { k: key, s });
  return s;
}

function notesForView() {
  const v = S.view;
  let list;
  if (v.type === 'trash') list = [...store.notes.values()].filter((n) => n.trashed);
  else {
    list = liveNotes();
    if (v.type === 'pinned') list = list.filter((n) => n.pinned);
    else if (v.type === 'folder') { const ids = descendantIds(v.id); list = list.filter((n) => ids.has(n.folderId)); }
    else if (v.type === 'tag') list = list.filter((n) => (n.tags || []).includes(v.id));
  }
  const q = norm(S.search.trim());
  if (q) {
    const words = q.split(/\s+/);
    list = list.filter((n) => { const s = searchable(n); return words.every((w) => s.includes(w)); });
  }
  const cmp = {
    updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    title: (a, b) => (a.title || 'Sin título').localeCompare(b.title || 'Sin título', 'es')
  }[S.sort] || ((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return list.sort((a, b) => (v.type !== 'trash' && !!b.pinned - !!a.pinned) || cmp(a, b));
}

function viewTitle() {
  const v = S.view;
  if (v.type === 'pinned') return 'Fijadas';
  if (v.type === 'trash') return 'Papelera';
  if (v.type === 'folder') return store.folders.get(v.id)?.name || 'Carpeta';
  if (v.type === 'tag') return `#${store.tags.get(v.id)?.name || 'etiqueta'}`;
  return 'Todas las notas';
}

function snippetNode(n) {
  const text = (n.text || '').replace(/\s+/g, ' ').trim();
  const q = norm(S.search.trim()).split(/\s+/).filter(Boolean)[0];
  if (!q || !text) return text.slice(0, 160) || 'Sin contenido';
  const nt = norm(text);
  const i = nt.indexOf(q);
  if (i < 0) return text.slice(0, 160);
  const start = Math.max(0, i - 50);
  const frag = document.createDocumentFragment();
  frag.append(start ? '…' : '', text.slice(start, i), el('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length, i + q.length + 110));
  return frag;
}

function renderList() {
  $('#list-title').textContent = viewTitle();
  $('#list-trash-bar').classList.toggle('hidden', S.view.type !== 'trash' || !notesForView().length);
  const box = $('#note-list');
  if (!store.loaded.notes) { box.replaceChildren(el('div', { class: 'list-empty' }, 'Cargando notas…')); return; }
  const notes = notesForView();
  if (!notes.length) {
    box.replaceChildren(el('div', { class: 'list-empty' },
      S.search ? 'No hay notas que coincidan.' : S.view.type === 'trash' ? 'La papelera está vacía.' : 'Aún no hay notas aquí.'));
    return;
  }
  box.replaceChildren(...notes.map((n) => {
    const path = n.folderId ? folderPath(n.folderId) : [];
    return el('button', {
      class: `note-card ${n.id === S.noteId ? 'active' : ''}`, type: 'button',
      onclick: () => openNote(n.id, { push: true })
    },
      el('div', { class: 't' }, n.pinned && !n.trashed ? '📌' : null, el('span', {}, n.title || 'Sin título')),
      el('div', { class: 's' }, snippetNode(n)),
      el('div', { class: 'm' },
        el('span', {}, shortDate(n.trashed ? n.trashedAt : (S.sort === 'created' ? n.createdAt : n.updatedAt))),
        path.length ? el('span', { class: 'f' }, `· ${path[path.length - 1].name}`) : null,
        (n.tags || []).slice(0, 3).map((t) => store.tags.get(t)).filter(Boolean).map((t) => el('span', { class: 'mini-tag' }, t.name)),
        (n.refs || []).length ? el('span', {}, `· 📚 ${n.refs.length}`) : null));
  }));
}

// ====================== Notas ======================
function newNote() {
  saveSoon.flush();
  const id = newId('notes');
  const now = Date.now();
  const v = S.view;
  const data = {
    title: '', html: '', text: '',
    folderId: v.type === 'folder' ? v.id : null,
    tags: v.type === 'tag' ? [v.id] : [],
    pinned: v.type === 'pinned',
    trashed: false, trashedAt: null,
    refs: [],
    createdAt: now, updatedAt: now
  };
  store.notes.set(id, { id, ...data }); // visible al instante
  put('notes', id, data);
  if (v.type === 'trash') S.view = { type: 'all', id: null };
  closeDrawer();
  openNote(id, { push: true, focusTitle: true });
  renderList(); renderSidebar();
}

function openNote(id, { push = false, focusTitle = false, fromHash = false } = {}) {
  const n = store.notes.get(id);
  if (!n) {
    // Puede que aún no hayan llegado los datos: lo intentamos al cargar
    if (!store.loaded.notes) { setTimeout(() => openNote(id, { push, focusTitle, fromHash }), 300); return; }
    toast('La nota no existe', 'error');
    closeEditor();
    return;
  }
  if (S.noteId !== id) saveSoon.flush();
  S.noteId = id;
  S.dirty = false;
  $('#editor-empty').classList.add('hidden');
  $('#editor-wrap').classList.remove('hidden');
  $('#app').dataset.view = 'editor';
  $('#ed-title').value = n.title || '';
  editor.setContent(n.html || '');
  S.loadedHtml = n.html || '';
  $('#ed-scroll').scrollTop = 0;
  renderNoteChrome();
  renderToc();
  setSaveStatus('');
  renderList();
  if (!fromHash) pushHash(!push);
  if (focusTitle) $('#ed-title').focus();
}

function closeEditor({ fromHash = false } = {}) {
  saveSoon.flush();
  S.noteId = null;
  showEditorEmpty();
  showList();
  if (!fromHash) pushHash(true);
  renderList();
}
function showEditorEmpty() {
  $('#editor-wrap').classList.add('hidden');
  $('#editor-empty').classList.remove('hidden');
  editor?.hideFloating();
}

function renderNoteChrome() {
  const n = store.notes.get(S.noteId);
  if (!n) return;
  const ro = !!n.trashed;
  $('#editor-wrap').classList.toggle('readonly', ro);
  editor.setReadOnly(ro);
  $('#ed-title').readOnly = ro;
  $('#trash-banner').classList.toggle('hidden', !ro);
  $('#btn-pin').classList.toggle('on', !!n.pinned);
  $('#btn-pin').title = n.pinned ? 'Quitar de fijadas' : 'Fijar';
  const path = n.folderId ? folderPath(n.folderId) : [];
  $('#ed-folder').textContent = path.length ? `📁 ${path.map((f) => f.name).join(' › ')}` : '📁 Sin carpeta';

  $('#tag-chips').replaceChildren(...(n.tags || []).map((tid) => store.tags.get(tid)).filter(Boolean).map((t) =>
    el('span', { class: 'chip', style: t.color ? { color: t.color } : {} },
      el('span', { role: 'button', style: { cursor: 'pointer' }, onclick: () => setView({ type: 'tag', id: t.id }) }, `#${t.name}`),
      el('button', { class: 'x', type: 'button', 'aria-label': `Quitar ${t.name}`, onclick: () => removeTagFromNote(t.id) }, '×'))));

  renderRefs();
  renderBacklinks();
  const words = (n.text || '').split(/\s+/).filter(Boolean).length;
  $('#ed-meta').textContent = `Creada: ${longDate(n.createdAt)} · Modificada: ${longDate(n.updatedAt)} · ${words} palabras`;
}

// ---------- Guardado ----------
function setSaveStatus(t) { $('#save-status').textContent = t; }

const saveSoon = debounce(saveNow, 800);
function saveNow() {
  if (!S.noteId || !S.dirty) return;
  const n = store.notes.get(S.noteId);
  if (!n || n.trashed) { S.dirty = false; return; }
  const html = editor.getContent();
  const title = $('#ed-title').value.trim();
  if (html.length > 900000) {
    toast('La nota es demasiado grande para guardarse (máx. ~900 KB de texto). Divídela en varias.', 'error', 7000);
    return;
  }
  S.dirty = false;
  S.loadedHtml = html;
  const text = editor.getText().slice(0, 30000);
  const data = { title, html, text, updatedAt: Date.now() };
  Object.assign(n, data); // reflejo inmediato en la lista
  patch('notes', n.id, data);
  setSaveStatus(navigator.onLine ? 'Guardado ✓' : 'Guardado en el dispositivo');
}

function onEditorChange() {
  S.dirty = true;
  setSaveStatus('Editando…');
  saveSoon();
  renderTocSoon();
}

// ---------- Índice ----------
const renderTocSoon = debounce(() => renderToc(), 400);
function renderToc() {
  const hs = editor.headings();
  const toc = $('#toc');
  if (hs.length < 2) { toc.classList.add('hidden'); return; }
  toc.classList.remove('hidden');
  $('#toc-list').replaceChildren(...hs.map((h, i) => el('a', {
    class: `l${h.tagName[1]}`, role: 'button', tabindex: '0',
    onclick: () => editor.scrollToHeading(i)
  }, h.textContent.trim())));
}

// ---------- Enlaces entre notas ----------
function renderBacklinks() {
  const id = S.noteId;
  const back = liveNotes().filter((n) => n.id !== id && (n.html || '').includes(`data-note="${id}"`));
  $('#backlinks').classList.toggle('hidden', !back.length);
  $('#backlink-list').replaceChildren(...back.map((n) => el('button', {
    class: 'chip', type: 'button', onclick: () => openNote(n.id, { push: true })
  }, `↩ ${n.title || 'Sin título'}`)));
}

function pickNoteForLink() {
  const items = liveNotes()
    .filter((n) => n.id !== S.noteId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((n) => ({
      id: n.id, label: n.title || 'Sin título',
      sub: n.folderId ? folderPath(n.folderId).map((f) => f.name).join(' › ') : ''
    }));
  return picker('Enlazar una nota', items, { placeholder: 'Buscar nota…', emptyText: 'No hay otras notas' })
    .then((id) => (id ? { id, title: store.notes.get(id)?.title } : null));
}

// ---------- Menú de nota ----------
function noteMenu(anchor) {
  const n = store.notes.get(S.noteId);
  if (!n) return;
  if (n.trashed) {
    menu(anchor, [
      { icon: '↩', label: 'Restaurar', onClick: () => restoreNote(n.id) },
      { icon: '✕', label: 'Eliminar definitivamente', danger: true, onClick: () => deleteForever(n.id) }
    ]);
    return;
  }
  menu(anchor, [
    { icon: '📁', label: 'Mover a carpeta…', onClick: () => moveNote(n.id) },
    { icon: '⧉', label: 'Duplicar', onClick: () => duplicateNote(n.id) },
    { icon: '🖨', label: 'Imprimir / guardar PDF', onClick: () => { saveSoon.flush(); window.print(); } },
    '-',
    { icon: '🗑', label: 'Mover a la papelera', danger: true, onClick: () => trashNote(n.id) }
  ]);
}

async function moveNote(id) {
  const n = store.notes.get(id);
  if (!n || n.trashed) return;
  const items = [{ id: '__root', label: '— Sin carpeta —' }, { id: '__new', label: '＋ Nueva carpeta…' },
    ...flatFolders().map((f) => ({ id: f.id, label: f.name, depth: f.depth }))];
  let target = await picker('Mover nota a…', items, { placeholder: 'Buscar carpeta…' });
  if (!target) return;
  if (target === '__new') { target = await newFolder(null); if (!target) return; }
  patch('notes', id, { folderId: target === '__root' ? null : target, updatedAt: Date.now() });
  toast('Nota movida', 'ok');
}

function duplicateNote(id) {
  saveSoon.flush();
  const n = store.notes.get(id);
  if (!n) return;
  const nid = newId('notes');
  const now = Date.now();
  const { id: _old, ...rest } = n;
  void _old;
  const data = { ...rest, title: `${n.title || 'Sin título'} (copia)`, pinned: false, createdAt: now, updatedAt: now };
  store.notes.set(nid, { id: nid, ...data });
  put('notes', nid, data);
  openNote(nid, { push: true });
}

function trashNote(id) {
  saveSoon.flush();
  patch('notes', id, { trashed: true, trashedAt: Date.now() });
  toast('Nota movida a la papelera', 'ok');
  if (S.noteId === id) closeEditor();
}

function restoreNote(id) {
  const n = store.notes.get(id);
  const folderOk = !n.folderId || store.folders.has(n.folderId);
  patch('notes', id, { trashed: false, trashedAt: null, folderId: folderOk ? n.folderId : null });
  toast('Nota restaurada', 'ok');
}

/** Archivos usados por una nota (imágenes del texto + adjuntos de la bibliografía) */
function noteFileIds(n) {
  const ids = new Set();
  for (const m of (n.html || '').matchAll(/data-file="([^"]+)"/g)) ids.add(m[1]);
  for (const r of n.refs || []) if (r.fileId) ids.add(r.fileId);
  return ids;
}
function allReferencedFiles(exceptNoteId) {
  const ids = new Set();
  for (const n of store.notes.values()) if (n.id !== exceptNoteId) noteFileIds(n).forEach((f) => ids.add(f));
  return ids;
}

function purgeNote(id) {
  const n = store.notes.get(id);
  if (!n) return;
  const others = allReferencedFiles(id);
  const mine = noteFileIds(n);
  for (const f of store.files.values()) if (f.noteId === id) mine.add(f.id);
  for (const f of mine) if (!others.has(f)) deleteFile(f);
  remove('notes', id);
}

async function deleteForever(id) {
  if (!await confirm('Eliminar definitivamente', 'La nota y sus imágenes y PDFs se borrarán para siempre. No se puede deshacer.', { okLabel: 'Eliminar', danger: true })) return;
  purgeNote(id);
  if (S.noteId === id) closeEditor();
}

async function emptyTrash() {
  const trashed = [...store.notes.values()].filter((n) => n.trashed);
  if (!trashed.length) return;
  if (!await confirm('Vaciar papelera', `Se borrarán para siempre ${trashed.length} nota(s) con sus archivos. No se puede deshacer.`, { okLabel: 'Vaciar', danger: true })) return;
  trashed.forEach((n) => purgeNote(n.id));
  if (S.noteId && trashed.some((n) => n.id === S.noteId)) closeEditor();
  toast('Papelera vacía', 'ok');
}

// ====================== Imágenes y adjuntos ======================
async function uploadImages(files) {
  const out = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const blob = await compressImage(f);
    const id = await saveFile(blob, { noteId: S.noteId, name: f.name || 'imagen', kind: 'image' });
    out.push({ id, url: await fileUrl(id) });
  }
  if (!out.length) throw new Error('No se encontraron imágenes');
  return out;
}

// ---------- Bibliografía ----------
function renderRefs() {
  const n = store.notes.get(S.noteId);
  if (!n) return;
  const refs = n.refs || [];
  $('#ref-empty').classList.toggle('hidden', refs.length > 0);
  $('#ref-list').replaceChildren(...refs.map((r) => {
    const fileMeta = r.fileId ? store.files.get(r.fileId) : null;
    return el('li', {},
      el('div', { class: 'ref-row' },
        el('div', { class: 'ref-main' },
          el('div', { class: 'ref-cite' }, r.cite || r.fileName || r.url || 'Referencia'),
          el('div', { class: 'ref-links' },
            r.url ? el('a', { class: 'ref-chip', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, `🔗 ${prettyUrl(r.url)}`) : null,
            r.fileId ? el('button', {
              class: 'ref-chip', type: 'button',
              onclick: () => openViewer({ fileId: r.fileId, name: r.fileName, kind: 'file', mime: fileMeta?.mime })
            }, `📄 ${r.fileName || 'archivo'}${r.fileSize ? ` · ${formatBytes(r.fileSize)}` : ''}${fileMeta ? '' : ' (subiendo…)'}`) : null)),
        el('button', { class: 'more', type: 'button', 'aria-label': 'Opciones', onclick: (e) => refMenu(e.currentTarget, r) }, '⋯')));
  }));
}

function prettyUrl(u) {
  try { const x = new URL(u); return (x.hostname + x.pathname).replace(/\/$/, '').slice(0, 60); } catch { return u.slice(0, 60); }
}

function refMenu(anchor, r) {
  const n = store.notes.get(S.noteId);
  if (!n || n.trashed) return;
  const refs = n.refs || [];
  const i = refs.findIndex((x) => x.id === r.id);
  menu(anchor, [
    { icon: '✏️', label: 'Editar', onClick: () => editRef(r) },
    i > 0 ? { icon: '↑', label: 'Subir', onClick: () => moveRef(i, -1) } : null,
    i < refs.length - 1 ? { icon: '↓', label: 'Bajar', onClick: () => moveRef(i, 1) } : null,
    '-',
    { icon: '🗑', label: 'Quitar referencia', danger: true, onClick: async () => {
      if (!await confirm('Quitar referencia', r.fileId ? 'Se quitará la referencia y su archivo adjunto.' : '¿Quitar esta referencia?', { okLabel: 'Quitar', danger: true })) return;
      setRefs(refs.filter((x) => x.id !== r.id));
      if (r.fileId && !allReferencedFiles(n.id).has(r.fileId)) deleteFile(r.fileId);
    } }
  ].filter(Boolean));
}

function moveRef(i, d) {
  const n = store.notes.get(S.noteId);
  const refs = [...(n.refs || [])];
  [refs[i], refs[i + d]] = [refs[i + d], refs[i]];
  setRefs(refs);
}

function setRefs(refs) {
  const n = store.notes.get(S.noteId);
  if (!n) return;
  n.refs = refs;
  patch('notes', n.id, { refs, updatedAt: Date.now() });
  renderRefs();
}

let pendingRefFile = null;

async function editRef(existing) {
  const n = store.notes.get(S.noteId);
  if (!n || n.trashed) return;
  const cite = el('textarea', { rows: 3, placeholder: 'Ej.: Byrne RA et al. 2023 ESC Guidelines for the management of acute coronary syndromes. Eur Heart J. 2023;44:3720-3826.' });
  cite.value = existing?.cite || '';
  const url = el('input', { type: 'url', placeholder: 'https://…  o  DOI 10.xxxx/…', value: existing?.url || '' });
  let file = null;
  const fileLabel = el('span', { class: 'muted small' }, existing?.fileName ? `Actual: ${existing.fileName}` : 'Ningún archivo');
  const pickBtn = el('button', { type: 'button', class: 'btn sm', onclick: () => {
    pendingRefFile = (f) => {
      if (f.size > LIMITS.maxFileBytes) { toast(`Máximo ${formatBytes(LIMITS.maxFileBytes)} por archivo`, 'error'); return; }
      file = f;
      fileLabel.textContent = `${f.name} · ${formatBytes(f.size)}`;
      if (!cite.value.trim()) cite.value = f.name.replace(/\.[^.]+$/, '');
    };
    $('#file-pdf').click();
  } }, '📎 Elegir PDF o archivo');
  const ok = await modal({
    title: existing ? 'Editar referencia' : 'Nueva referencia',
    body: [
      el('label', {}, 'Cita', cite),
      el('label', {}, 'Enlace o DOI (opcional)', url),
      el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, pickBtn, fileLabel),
      el('p', { class: 'muted small' }, `Espacio usado: ${formatBytes(usageBytes())} de 1 GB.`)
    ],
    actions: [{ label: 'Cancelar' }, { label: 'Guardar', primary: true, value: true, onClick: () => {
      if (!cite.value.trim() && !url.value.trim() && !file && !existing?.fileId) { toast('Escribe una cita, un enlace o adjunta un archivo', 'error'); return false; }
      return true;
    } }]
  });
  pendingRefFile = null;
  if (!ok) return;
  let href = url.value.trim();
  if (/^10\.\d{4,}\//.test(href)) href = `https://doi.org/${href}`;
  else if (href && !/^https?:/i.test(href)) href = `https://${href}`;
  const r = { ...(existing || { id: newId('notes') }), cite: cite.value.trim(), url: href || null };
  if (file) {
    try {
      const oldFile = existing?.fileId;
      r.fileId = await saveFile(file, { noteId: n.id, name: file.name, kind: 'file' });
      r.fileName = file.name; r.fileSize = file.size;
      if (oldFile && !allReferencedFiles(n.id).has(oldFile)) deleteFile(oldFile);
    } catch (e) { toast(e.message, 'error'); return; }
  }
  const refs = [...(store.notes.get(n.id).refs || [])];
  const i = refs.findIndex((x) => x.id === r.id);
  if (i >= 0) refs[i] = r; else refs.push(r);
  setRefs(refs);
}

async function addAttachment(f) {
  const n = store.notes.get(S.noteId);
  if (!n || n.trashed) return;
  try {
    const fileId = await saveFile(f, { noteId: n.id, name: f.name, kind: 'file' });
    setRefs([...(n.refs || []), { id: newId('notes'), cite: f.name.replace(/\.[^.]+$/, ''), url: null, fileId, fileName: f.name, fileSize: f.size }]);
    toast('Archivo añadido a la bibliografía', 'ok');
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- Visor ----------
async function openViewer({ fileId, src, name, kind, mime }) {
  let url = src;
  try {
    if (!url) { toast('Abriendo…'); url = await fileUrl(fileId); }
  } catch (e) { toast(e.message, 'error'); return; }
  const meta = fileId ? store.files.get(fileId) : null;
  const type = mime || meta?.mime || '';
  const isImg = kind === 'image' || type.startsWith('image/');
  const isPdf = type === 'application/pdf';
  const body = isImg
    ? el('div', { class: 'viewer-img' }, el('img', { src: url, alt: name || '' }))
    : isPdf ? el('iframe', { class: 'viewer', src: url, title: name || 'PDF' })
      : el('p', {}, 'Este tipo de archivo no se puede previsualizar. Descárgalo para abrirlo.');
  modal({
    title: name || meta?.name || 'Archivo',
    wide: isImg || isPdf,
    body,
    actions: [
      { label: '↗ Abrir en pestaña', onClick: () => { window.open(url, '_blank'); return false; } },
      { label: '⬇ Descargar', onClick: async () => {
        const blob = fileId ? await fileBlob(fileId) : await (await fetch(url)).blob();
        download(name || meta?.name || 'archivo', blob);
        return false;
      } },
      { label: 'Cerrar', primary: true }
    ]
  });
}

// ====================== Ajustes ======================
function openSettings() {
  closeDrawer();
  const used = usageBytes();
  const pct = Math.min(100, (used / LIMITS.quotaBytes) * 100);
  const live = liveNotes().length;
  const publicMode = getMode() === 'public';
  const idleSel = el('select', { onchange: (e) => { localStorage.setItem('drfolio.idle', e.target.value); toast('Guardado', 'ok'); } },
    [5, 15, 30, 60].map((m) => el('option', { value: m, selected: String(m) === String(idleMinutes()) }, `${m} min`)));
  modal({
    title: 'Ajustes',
    body: [
      el('div', { class: 'settings-row' }, el('span', {}, 'Cuenta'), el('b', {}, auth.currentUser?.email || '')),
      el('div', { class: 'settings-row' }, el('span', {}, 'Este dispositivo'),
        el('span', {}, publicMode ? '🟠 Ordenador público (sin copia offline)' : '🟢 De confianza (funciona sin conexión)')),
      publicMode ? el('div', { class: 'settings-row' }, el('span', {}, 'Cerrar sesión por inactividad'), idleSel) : null,
      el('div', {},
        el('div', { class: 'settings-row', style: { borderBottom: 0 } }, el('span', {}, 'Espacio usado'),
          el('span', {}, `${formatBytes(used)} de 1 GB · ${live} notas · ${store.files.size} archivos`)),
        el('div', { class: 'meter' }, el('div', { style: { width: `${pct.toFixed(1)}%` } }))),
      el('div', { class: 'settings-row' }, el('span', {}, 'Copia de seguridad'),
        el('span', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' } },
          el('button', { class: 'btn sm', type: 'button', onclick: () => exportBackup(false) }, 'Solo notas'),
          el('button', { class: 'btn sm', type: 'button', onclick: () => exportBackup(true) }, 'Con archivos'))),
      el('div', { class: 'settings-row' }, el('span', {}, 'Archivos sin usar'),
        el('button', { class: 'btn sm', type: 'button', onclick: cleanOrphans }, 'Limpiar')),
      el('div', { class: 'settings-row' }, el('span', { class: 'muted small' }, `Dr.Folio v${APP_VERSION}`),
        el('button', { class: 'btn sm primary danger', type: 'button', onclick: () => doLogout() }, 'Cerrar sesión'))
    ],
    actions: [{ label: 'Cerrar', primary: true }]
  });
}

async function exportBackup(withFiles) {
  saveSoon.flush();
  const data = {
    app: 'Dr.Folio', version: APP_VERSION, exportedAt: new Date().toISOString(),
    folders: [...store.folders.values()], tags: [...store.tags.values()],
    notes: [...store.notes.values()], files: [...store.files.values()]
  };
  if (withFiles) {
    toast(`Preparando ${store.files.size} archivos…`, '', 4000);
    data.fileData = {};
    for (const f of store.files.values()) {
      try {
        const blob = await fileBlob(f.id);
        data.fileData[f.id] = await new Promise((res) => {
          const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob);
        });
      } catch { /* archivo no disponible */ }
    }
  }
  const stamp = new Date().toISOString().slice(0, 10);
  download(`drfolio-copia-${stamp}${withFiles ? '-completa' : ''}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
}

async function cleanOrphans() {
  const used = allReferencedFiles(null);
  const old = Date.now() - 10 * 60 * 1000;
  const orphans = [...store.files.values()].filter((f) => !used.has(f.id) && (f.createdAt || 0) < old);
  if (!orphans.length) { toast('No hay archivos sin usar', 'ok'); return; }
  const size = orphans.reduce((s, f) => s + (f.size || 0), 0);
  if (!await confirm('Limpiar archivos', `Hay ${orphans.length} archivo(s) que ya no usa ninguna nota (${formatBytes(size)}). ¿Borrarlos?`, { okLabel: 'Borrar', danger: true })) return;
  orphans.forEach((f) => deleteFile(f.id));
  toast('Archivos borrados', 'ok');
}

async function doLogout(reason) {
  if (S.loggingOut) return;
  S.loggingOut = true;
  saveSoon.flush();
  stopSync();
  revokeAll();
  await logout();
  if (reason) sessionStorage.setItem('drfolio.logoutReason', reason);
  location.replace(location.pathname);
}

// ---------- Inactividad (ordenador público) ----------
function idleMinutes() { return parseInt(localStorage.getItem('drfolio.idle') || '15', 10); }
function startInactivityWatch() {
  let last = Date.now();
  const bump = () => { last = Date.now(); };
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => document.addEventListener(ev, bump, { passive: true, capture: true }));
  setInterval(() => {
    if (Date.now() - last > idleMinutes() * 60000) doLogout('Sesión cerrada por inactividad.');
  }, 20000);
}

// Para depurar desde la consola
window.drfolio = { store, S, version: APP_VERSION, escapeHtml };
