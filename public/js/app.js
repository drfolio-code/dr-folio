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
import {
  initSnippets, newSnippet, openSnippet, closeSnippet, currentSnippet, flushSnippet, onSnippetsChange, pickSnippetText,
  snippetCard, snippetItemMenu, snippetMatches, snippetsForView, sortSnippets, allSnippets, moveSnippetTo,
  snipSort, setSnipSort, SNIP_SORTS, migrateCategories, copyText,
  onSnippetEditorChange, onSnippetSectionCopy, snippetImageOwner, isSnippetReading
} from './snippets.js';
import { snippetFileIds } from './snipbody.js';
import { MODULES, NAV_HOME, NAV_SEARCH } from './modules.js';
import { initViewport, initTitles, fitTitle } from './viewport.js';
import { openPdfViewer } from './pdfviewer.js';
import { initBackup, openBackup, backupReminder, backupPublicReason, exportJson, progress, lastBackupAt } from './backup.js';
import {
  initBodies, bodyOf, loadBody, hasFreshBody, syncBodies, bodyState, bodiesAvailable, writeNote, deleteNoteDocs,
  isLegacy, deriveLight, pruneBodies, clearBodies, dropBody
} from './bodies.js';
import { legacyNotes, migrateNotes, snippetsToMigrate, migrateSnippets } from './migrate.js';
import { icon, iconOr } from './icons.js';

// ====================== Estado ======================
const S = {
  view: { type: 'home', id: null },
  noteId: null,
  search: '',
  find: '',                                                           // texto de la búsqueda global (#/buscar)
  findFilter: 'all',                                                  // 'all' | id de SEARCH_SOURCES
  sideClosed: localStorage.getItem('drfolio.side') === 'closed',      // barra lateral plegada (ordenador)
  sort: localStorage.getItem('drfolio.sort') || 'updated',
  searchAll: false,                                                   // buscador: todas las notas en vez de la carpeta actual
  folderSort: localStorage.getItem('drfolio.folderSort') || 'manual',  // 'manual' | 'name'
  layout: localStorage.getItem('drfolio.layout') || 'list',            // 'list' | 'grid'
  expanded: new Set(JSON.parse(localStorage.getItem('drfolio.expanded') || '[]')),
  dirty: false,
  loadedHtml: null,
  reading: false,                                                     // nota abierta en modo lectura
  bodyReady: false,                                                   // el contenido de la nota abierta ya está cargado (si no, no se edita ni se guarda)
  contentSearch: false,                                               // ordenador público: «Buscar también en el contenido» activado
  started: false,
  loggingOut: false
};
let editor = null;
let snipEditor = null; // el mismo editor, para los prerredactados

// ====================== Árboles de carpetas ======================
// El mismo explorador (ruta, carpetas, menús, arrastrar, buscar) sirve para Notas y para Prerredactados.
// Cada árbol describe dónde están sus carpetas, sus elementos y sus textos.
const TREES = {
  notes: {
    id: 'notes', col: 'folders', itemCol: 'notes', map: () => store.folders,
    root: 'notes', folder: 'folder', views: ['all', 'pinned', 'recent', 'tag', 'trash'],
    rootHash: '#/notas', rootName: 'Notas', rootIcon: 'notebook-text',
    one: 'nota', many: 'notas',
    items: () => liveNotes(),
    newItem: () => newNote(),
    matches: (n, words) => words.every((w) => searchable(n).includes(w)),
    sortItems: (list) => sortNotes(list),
    block: (list) => notesBlock(list),
    moveItem: (id, folderId) => moveNoteTo(id, folderId),
    folderSort: () => S.folderSort,
    sortValue: () => S.folderSort,
    setSort: (m) => { S.folderSort = m; localStorage.setItem('drfolio.folderSort', m); },
    sortOptions: [['manual', 'Orden manual'], ['name', 'Por nombre']],
    folderSelect: true,
    shortcuts: () => {
      const live = liveNotes();
      return [['notebook-text', 'Todas las notas', live.length, 'all'], ['pin', 'Fijadas', live.filter((n) => n.pinned).length, 'pinned'], ['clock', 'Recientes', null, 'recent']];
    },
    txt: {
      Many: 'Notas', newBtn: '＋ Nota', newOne: 'Nueva nota', newHere: 'Nueva nota aquí', folderHint: 'Nombre (p. ej. Urgencias)',
      loose: 'Notas sin carpeta', itemsHere: 'Notas', rootDest: 'sin carpeta',
      noFolders: 'Aún no tienes carpetas. Crea la primera con «＋ Carpeta» (p. ej. Urgencias).',
      onlySubs: 'No hay notas sueltas en esta carpeta (mira en sus subcarpetas).',
      emptyFolder: 'Carpeta vacía. Crea una nota o una subcarpeta.',
      searchAll: 'Buscar en todas las notas…', searchingAll: 'Buscando en todas las notas', searchAllBtn: 'Buscar en todas',
      noMatch: 'No hay notas que coincidan.'
    }
  },
  snippets: {
    id: 'snippets', col: 'snippetFolders', itemCol: 'snippets', map: () => store.snippetFolders,
    root: 'snippets', folder: 'sfolder', views: ['sall', 'sfav', 'sused', 'srecent'],
    rootHash: '#/snippets', rootName: 'Prerredactados', rootIcon: 'clipboard-list',
    one: 'prerredactado', many: 'prerredactados',
    items: () => allSnippets(),
    newItem: () => newSnippetHere(),
    matches: (s, words) => snippetMatches(s, words),
    sortItems: (list) => sortSnippets(list),
    block: (list, opts) => snippetsBlock(list, opts),
    moveItem: (id, folderId) => moveSnippetTo(id, folderId),
    folderSort: () => (snipSort() === 'manual' ? 'manual' : 'name'),
    sortValue: () => snipSort(),
    setSort: (m) => setSnipSort(m),
    sortOptions: SNIP_SORTS,
    folderSelect: false, // el orden se elige arriba, en «Ordenar»
    shortcuts: () => {
      const all = allSnippets();
      return [['clipboard-list', 'Todos', all.length, 'sall'], ['star', 'Favoritos', all.filter((s) => s.favorite).length, 'sfav'],
        ['flame', 'Más usados', null, 'sused'], ['clock', 'Recientes', null, 'srecent']];
    },
    txt: {
      Many: 'Prerredactados', newBtn: '＋ Prerredactado', newOne: 'Nuevo prerredactado', newHere: 'Nuevo prerredactado aquí',
      folderHint: 'Nombre (p. ej. Traumatología)',
      loose: 'Sin carpeta', itemsHere: 'Prerredactados', rootDest: '«Prerredactados» (sin carpeta)',
      noFolders: 'Aún no tienes carpetas. Crea la primera con «＋ Carpeta» (p. ej. Urgencias).',
      onlySubs: 'No hay prerredactados sueltos en esta carpeta (mira en sus subcarpetas).',
      emptyFolder: 'Carpeta vacía. Crea un prerredactado o una subcarpeta.',
      searchAll: 'Buscar en todos los prerredactados…', searchingAll: 'Buscando en todos los prerredactados', searchAllBtn: 'Buscar en todos',
      noMatch: 'No hay prerredactados que coincidan.'
    }
  }
};
/** Árbol al que pertenece una vista (o null: Inicio) */
const treeOf = (type) => Object.values(TREES).find((T) => type === T.root || type === T.folder || T.views.includes(type)) || null;
const isSnipView = (type = S.view.type) => treeOf(type)?.id === 'snippets';
/** Sección de una vista: 'home' | 'search' | id del árbol ('notes' | 'snippets') — coincide con el id del módulo */
const sectionOf = (type = S.view.type) => (type === 'search' ? 'search' : treeOf(type)?.id || 'home');
/** Nuevo prerredactado en la carpeta abierta (o en Favoritos si estás ahí) */
function newSnippetHere() {
  const v = S.view;
  newSnippet({ folderId: v.type === 'sfolder' ? v.id : null, favorite: v.type === 'sfav' });
}


// ====================== Arranque ======================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

const setScreen = (s) => { document.body.dataset.screen = s; };
initViewport();
initTitles($('#ed-title'), $('#snip-title'));

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
    onDropFiles: (files) => files.forEach((f) => addAttachment(f)),
    tabs: true,
    pickSnippet: pickSnippetText,
    onCopy: (text, btn) => copyOut(text, btn)
  });

  // Editor de prerredactados: el MISMO editor (createEditor) con sus propios elementos y la MISMA barra de formato
  // (toolbarHtml de editor.js; solo añade «Insertar campo»)
  const snipBar = el('div', { id: 'snip-toolbar', class: 'toolbar', role: 'toolbar', 'aria-label': 'Formato' });
  $('#snip-wrap .ed-head').after(snipBar);
  snipEditor = createEditor({
    els: {
      content: $('#snip-content'), toolbar: snipBar, tableTools: $('#snip-table-tools'), bubble: $('#snip-bubble'),
      box: $('#editor'), scroll: $('#snip-scroll'), fileInput: $('#snip-file-image'), toc: null
    },
    markFields: true,
    fields: true,
    tabs: true,
    onChange: onSnippetEditorChange,
    onNoteLink: (id) => {
      if (!store.notes.has(id)) { toast('Esa nota ya no existe', 'error'); return; }
      flushSnippet();
      openNote(id, { push: true });
    },
    onImage: (fileId, src) => openViewer({ fileId, src, name: 'Imagen', kind: 'image' }),
    pickNote: pickNoteForLink,
    uploadImages: (files) => uploadImages(files, { snippetId: snippetImageOwner() }),
    resolveImage: fileUrl,
    noteExists: (id) => store.notes.has(id) && !store.notes.get(id).trashed,
    onDropFiles: () => toast('En los prerredactados solo se pueden añadir imágenes', 'error'),
    pickSnippet: pickSnippetText,
    onCopy: onSnippetSectionCopy
  });

  // Deshacer / rehacer en la cabecera (como Evernote); mousedown sin quitar la selección del texto
  for (const [pre, ed] of [['btn', editor], ['snip', snipEditor]]) {
    for (const k of ['undo', 'redo']) {
      const b = $(`#${pre}-${k}`);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => ed[k]());
    }
  }

  initSnippets({
    editor: snipEditor,
    openMode: () => openMode(),
    fontStep: (d) => setReadSize(readSize() + d),
    updateWakeLock: () => updateWakeLock(),
    purgeSnippetFiles,
    renderList: () => renderList(),
    renderSidebar: () => renderSidebar(),
    pushHash: (replace) => pushHash(replace),
    showList: () => showList(),
    showPane,
    newFolder: (parentId) => newFolder(parentId, TREES.snippets)
  });

  initBackup({
    beforeRun: () => { saveSoon.flush(); flushSnippet(); },
    isPublic: () => getMode() === 'public',
    onChange: () => { if (S.view.type === 'home') renderHomeSoon(); }
  });

  bindUi();
  initHistory();
  applyHash();
  setScreen('app');
  renderAll();

  // Contenido de las notas: en dispositivos de confianza, copia local (IndexedDB) + descarga en segundo plano
  initBodies({ persist: getMode() !== 'public', onChange: onBodiesProgress }).then(() => { scheduleBodySync(); renderFindSoon(); });

  startSync(user.uid, onData, (name, err) => {
    console.error(name, err);
    toast(err.code === 'permission-denied'
      ? 'Sin permiso para leer tus datos. ¿Están publicadas las reglas de Firestore?'
      : `Error de sincronización: ${err.message}`, 'error', 6000);
  });

  if (getMode() === 'public') {
    startInactivityWatch();
    $('#app').classList.add('public');
    $('#pubbar').classList.remove('hidden');
  }
}

// ---------- Datos entrantes ----------
const renderListSoon = debounce(() => renderList(), 60);
const renderSidebarSoon = debounce(() => renderSidebar(), 60);

function onData(name, changed) {
  updateSync();
  if (S.view.type === 'home' && ['notes', 'snippets', 'folders', 'tags', 'files', 'snippetFolders'].includes(name)) renderHomeSoon();
  if (S.view.type === 'search' && ['notes', 'snippets', 'folders', 'snippetFolders', 'tags'].includes(name)) renderFindSoon();
  if (['notes', 'snippets'].includes(name)) renderNavSoon();
  if (name === 'snippets' || name === 'snippetFolders') migrateCategories();
  if (name === 'snippets' && !store.fromCache.snippets) maybeMigrateSnippets();
  if (name === 'notes') {
    for (const id of changed) if (!store.notes.has(id)) dropBody(id);
    if (!store.fromCache.notes) { pruneBodies(); maybeMigrate(); }
    scheduleBodySync();
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
  } else if (name === 'snippets') {
    onSnippetsChange(changed);
    renderSidebarSoon();
    if (isSnipView()) renderListSoon();
  } else if (name === 'snippetFolders') {
    onSnippetsChange(null);
    if (isSnipView()) renderListSoon();
  }
}

function onCurrentNoteRemoteChange() {
  const id = S.noteId;
  const n = store.notes.get(id);
  if (!n) { closeEditor(); return; }
  renderNoteChrome();
  // Si la nota cambió en otro dispositivo y aquí no estás editando, actualizamos el contenido
  const apply = () => {
    if (S.noteId !== id) return;
    const b = bodyOf(id);
    const editingHere = S.dirty || editor.isFocused() || document.activeElement === $('#ed-title');
    if (b && !editingHere && S.bodyReady && b.html !== S.loadedHtml) {
      const sc = $('#ed-scroll').scrollTop;
      editor.setContent(b.html);
      S.loadedHtml = b.html;
      $('#ed-scroll').scrollTop = sc;
      renderToc();
    }
    if (!editingHere && document.activeElement !== $('#ed-title')) { $('#ed-title').value = n.title || ''; fitTitle($('#ed-title')); }
    renderRefs();
  };
  if (hasFreshBody(id)) apply();
  else loadBody(id).then(apply, () => {}); // el contenido nuevo se descarga (1 lectura)
}

// ---------- Contenido de las notas en segundo plano ----------
// Confianza: se descargan los que falten o hayan cambiado (queda en IndexedDB → buscar en todo sin conexión).
// Ordenador público: solo si se pide «Buscar también en el contenido».
const scheduleBodySync = debounce(() => {
  if (!bodyState.ready || !store.loaded.notes || store.fromCache.notes || migrating) return;
  if (bodyState.persist || S.contentSearch) syncBodies();
}, 1500);
const onBodiesProgress = debounce(() => {
  if (S.view.type === 'search') renderFind();
  else if (S.search && treeOf(S.view.type)?.id === 'notes') renderList();
}, 400);

// ---------- Migración al formato de dos documentos (v1.10.0) ----------
let migrateAsked = false, migrating = false, migrateFailAt = 0;
// ---------- Prerredactados → texto enriquecido (v1.12.0, en silencio: no borra ni cambia el texto) ----------
let snipMigrating = false, snipMigrateFailAt = 0;
const maybeMigrateSnippets = debounce(async () => {
  if (snipMigrating || !navigator.onLine || store.fromCache.snippets || Date.now() - snipMigrateFailAt < 60000) return;
  if (!snippetsToMigrate().length) return;
  snipMigrating = true;
  try {
    const r = await migrateSnippets();
    if (r.done) toast(`${r.done} prerredactado(s) actualizados a texto con formato`, 'ok', 3500);
  } catch (e) { console.warn('migrateSnippets', e); snipMigrateFailAt = Date.now(); }
  snipMigrating = false;
}, 2500);

function maybeMigrate() {
  if (migrating || getMode() === 'public' || !navigator.onLine || store.fromCache.notes || Date.now() - migrateFailAt < 60000) return;
  const n = legacyNotes().length;
  if (!n) { if (store.loaded.notes) localStorage.setItem('drfolio.migrated', '1'); return; }
  // Ya migrado alguna vez en este dispositivo o muy pocas: en silencio (p. ej. notas creadas con una versión antigua)
  if (localStorage.getItem('drfolio.migrated') || n <= 10) { runMigration(false); return; }
  if (migrateAsked) return;
  migrateAsked = true;
  setTimeout(askMigration, 1200);
}
async function askMigration() {
  const n = legacyNotes().length;
  if (!n || migrating) return;
  const recent = lastBackupAt() && Date.now() - lastBackupAt() < 3 * 86400000;
  const go = await modal({
    title: 'Actualización: notas más rápidas',
    body: [
      el('p', {}, `Dr.Folio va a reorganizar tus ${n.toLocaleString('es-ES')} notas para que la app abra más rápido y gaste menos del plan gratuito: el contenido de cada nota se guarda aparte y se descarga al abrirla.`),
      el('p', {}, 'No se borra nada y puedes seguir usando la app mientras tanto. Si se corta, continúa sola la próxima vez. Puedes hacerlo en varios dispositivos a la vez.'),
      el('p', { class: recent ? 'muted small' : 'bk-warn' }, recent
        ? `Tu última copia de seguridad es del ${longDate(lastBackupAt())}.`
        : 'Recomendado: haz antes una copia de seguridad (Ajustes → Copia de seguridad).')
    ],
    actions: [{ label: 'Más tarde', value: 'later' }, { label: 'Hacer copia primero', value: 'backup' }, { label: 'Actualizar ahora', primary: true, value: 'go' }]
  });
  if (go === 'backup') { await exportJson(true); setTimeout(askMigration, 300); return; }
  if (go === 'go') runMigration(true);
}
async function runMigration(visible) {
  if (migrating) return;
  migrating = true;
  const p = visible ? progress('Actualizando las notas') : null;
  try {
    const res = await migrateNotes({ onProgress: (d, t) => p?.set(t ? d / t : 1, `Notas: ${d.toLocaleString('es-ES')} de ${t.toLocaleString('es-ES')}`, 'Puedes seguir usando la app') });
    if (!res.stopped) localStorage.setItem('drfolio.migrated', '1');
    p?.finish(res.stopped === 'quota'
      ? `⏸ Pausado por el límite gratuito de hoy (${res.done.toLocaleString('es-ES')} de ${res.total.toLocaleString('es-ES')}). Mañana continuará solo.`
      : `✓ Notas actualizadas (${res.total.toLocaleString('es-ES')})`,
    res.versions ? [el('p', { class: 'bk-warn' }, `${res.versions} nota(s) tenían dos versiones distintas: la más reciente se queda y la otra está como «… (otra versión)».`)] : []);
  } catch (e) {
    console.error(e);
    migrateFailAt = Date.now();
    p?.finish(`⚠️ Se interrumpió: ${e.message || e}`, [el('p', {}, 'No se ha perdido nada. Lo que falta se hará la próxima vez que abras la app.')]);
  }
  migrating = false;
  scheduleBodySync();
}

function updateSync() {
  const [cls, txt] = !navigator.onLine ? ['offline', 'Sin conexión'] : hasPending() ? ['pending', 'Sincronizando…'] : ['', 'Sincronizado'];
  $$('.sync-ind').forEach((s) => { s.className = `${s.className.replace(/\b(offline|pending)\b/g, '').trim()} ${cls}`.trim(); s.title = txt; s.textContent = txt; });
}
window.addEventListener('online', updateSync);
window.addEventListener('offline', () => {
  updateSync();
  if (getMode() === 'public') toast('Sin conexión: en un ordenador público los cambios se pierden si cierras la pestaña.', 'error', 6000);
});

// ====================== Interfaz ======================
function bindUi() {
  // Navegación: franja de módulos (tablet/PC), barra inferior (móvil) y barra lateral
  buildNav();
  $('#rail-create').addEventListener('click', (e) => createMenu(e.currentTarget));
  $('#rail-settings').addEventListener('click', openSettings);
  ['#rail-logout', '#btn-logout-home'].forEach((s) => $(s).addEventListener('click', askLogout));
  $('#btn-logout-pub').addEventListener('click', () => doLogout());
  $('#rail-side').addEventListener('click', toggleSide);
  $('#btn-side-close').addEventListener('click', toggleSide);
  $('#app').classList.toggle('side-closed', S.sideClosed);
  ['#btn-new-note', '#btn-new-note-empty'].forEach((s) => $(s).addEventListener('click', () => (isSnipView() ? newSnippetHere() : newNote())));
  $('#btn-layout').addEventListener('click', () => {
    S.layout = S.layout === 'grid' ? 'list' : 'grid';
    localStorage.setItem('drfolio.layout', S.layout);
    renderList();
  });
  $('#btn-list-more').addEventListener('click', (e) => {
    const T = treeOf(S.view.type) || TREES.notes;
    if (S.view.type === T.folder && T.map().has(S.view.id)) folderMenu(e.currentTarget, T.map().get(S.view.id), { here: true, T });
    else rootMenu(e.currentTarget, T);
  });
  $('#btn-settings-home').addEventListener('click', openSettings);
  $('#home-search').addEventListener('click', () => openFind());
  // Búsqueda global
  $('#find-input').addEventListener('input', debounce(() => { S.find = $('#find-input').value; renderFind(); }, 120));
  $('#find-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('#find-input').value = ''; S.find = ''; renderFind(); }
    if (e.key === 'Enter') { e.preventDefault(); $('#find-input').blur(); }
  });
  $('#scrim').addEventListener('click', closeDrawer);
  // «←» de la nota: si la nota tiene su propia entrada en el historial, volvemos atrás (como el botón de Android)
  $('#btn-back').addEventListener('click', () => { if (history.state?.nt && history.state?.d > 0) history.back(); else closeEditor(); });

  // Lista
  $('#search').addEventListener('input', debounce(() => { S.search = $('#search').value; renderList(); }, 120));
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('#search').value = ''; S.search = ''; renderList(); }
    if (e.key === 'Enter') { e.preventDefault(); $('#search').blur(); }
  });
  $('#sort').addEventListener('change', () => {
    const val = $('#sort').value;
    if ($('#sort').dataset.kind === 'snippets') setSnipSort(val);
    else { S.sort = val; localStorage.setItem('drfolio.sort', S.sort); }
    renderList();
  });
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
  $('#btn-edit').addEventListener('click', () => setReading(!S.reading));
  $('#btn-font-down').addEventListener('click', () => setReadSize(readSize() - 1));
  $('#btn-font-up').addEventListener('click', () => setReadSize(readSize() + 1));
  applyReadSize();
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
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveSoon.flush(); flushSnippet(); setSaveStatus('Guardado ✓'); }
    else if (mod && e.key.toLowerCase() === 'k' && !editor.isFocused()) { e.preventDefault(); if (!treeOf(S.view.type)) openFind(); else { showList(); $('#search').focus(); } }
    else if (mod && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); if (isSnipView()) newSnippetHere(); else newNote(); }
    else if (e.key === 'Escape' && !modalOpen()) closeDrawer();
  });

  // Guardar antes de salir
  window.addEventListener('beforeunload', () => { saveSoon.flush(); flushSnippet(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { saveSoon.flush(); flushSnippet(); }
    updateWakeLock(); // el sistema suelta el bloqueo al ocultar la pestaña: lo pedimos otra vez al volver
  });
  window.addEventListener('popstate', onPopState);
}

const closeDrawer = () => $('#app').classList.remove('drawer');
const showList = () => { $('#app').dataset.view = 'list'; };

// ---------- Rutas (#/inicio, #/notas, #/folder/ID/n/NOTA) ----------
// Cada entrada del historial guarda en history.state:
//   d  = cuántas entradas hay por encima de Inicio (el botón 🏠 hace history.go(-d))
//   lv = nivel dentro del explorador de Notas (0 = raíz «Notas», 1 = carpeta principal, 2 = subcarpeta…)
//   nt = 1 si esa entrada es una nota (o un prerredactado) abierta encima de la lista
// Al entrar en una carpeta se apilan también sus carpetas padre, así «atrás» (Android) sube un nivel:
// nota → Cardio → Urgencias → Notas → Inicio (igual en Prerredactados: #/sfolder/ID).
const isExplorer = (t) => !!treeOf(t);

function hashFor(view, noteId) {
  if (view.type === 'home') return '#/inicio';
  if (view.type === 'search') return NAV_SEARCH.route;
  const T = treeOf(view.type);
  let h = T && view.type === T.root ? T.rootHash : `#/${view.type}${view.id ? `/${view.id}` : ''}`;
  if (noteId) h += `/n/${noteId}`;
  else if (isSnipView(view.type) && currentSnippet()) h += `/s/${currentSnippet()}`;
  return h;
}
/** Cadena de rutas desde la raíz del árbol («Notas» o «Prerredactados») hasta la vista (historial y ruta de navegación). */
function chainFor(view) {
  const T = treeOf(view.type);
  if (!T) return [];
  if (view.type === T.root) return [T.rootHash];
  if (view.type === T.folder) {
    const path = folderPath(view.id, T.map());
    return [T.rootHash, ...(path.length ? path.map((f) => `#/${T.folder}/${f.id}`) : [`#/${T.folder}/${view.id}`])];
  }
  return [T.rootHash, hashFor(view)];
}
const lvFor = (view) => Math.max(0, chainFor(view).length - 1);

function pushHash(replace = false) {
  const h = hashFor(S.view, S.noteId);
  if (location.hash === h) return;
  const d = history.state?.d || 0;
  const st = { lv: lvFor(S.view), nt: S.noteId || (isSnipView() && currentSnippet()) ? 1 : 0 };
  if (replace) history.replaceState({ d, ...st }, '', h); else history.pushState({ d: d + 1, ...st }, '', h);
}
function pushChain(chain, from, d) {
  for (let i = from; i < chain.length; i++) history.pushState({ d: d + (i - from) + 1, lv: i, nt: 0 }, '', chain[i]);
}
/** Al arrancar deja Inicio (y las carpetas padre) debajo de la ruta abierta, para que «atrás» suba de nivel. */
function initHistory() {
  if (typeof history.state?.d === 'number') return; // recarga: el historial ya está montado
  const h = location.hash;
  const { view, noteId, snipId } = parseHash(h);
  history.replaceState({ d: 0 }, '', '#/inicio');
  if (view.type === 'home' && !noteId && !snipId) return;
  const chain = chainFor(view);
  if (chain.length) pushChain(chain, 0, 0);
  else history.pushState({ d: 1, lv: 0, nt: 0 }, '', hashFor(view));
  if (noteId || snipId) history.pushState({ d: (history.state?.d || 0) + 1, lv: lvFor(view), nt: 1 }, '', h);
}
function parseHash(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  let view = { type: 'home', id: null };
  let noteId = null;
  let snipId = null;
  if (parts[0] === 'nota' && parts[1]) { noteId = parts[1]; view = { type: 'all', id: null }; }
  else if (parts[0] === 'buscar') view = { type: 'search', id: null };
  else if (['snippets', 'sall', 'sfav', 'sused', 'srecent'].includes(parts[0])) {
    view = { type: parts[0], id: null };
    if (parts[1] === 's') snipId = parts[2];
  }
  else if (parts[0] === 'sfolder' && parts[1]) {
    view = { type: 'sfolder', id: parts[1] };
    if (parts[2] === 's') snipId = parts[3];
  }
  else if (parts[0] === 'notas') {
    view = { type: 'notes', id: null };
    if (parts[1] === 'n') noteId = parts[2];
  }
  else if (['all', 'pinned', 'recent', 'trash'].includes(parts[0])) {
    view = { type: parts[0], id: null };
    if (parts[1] === 'n') noteId = parts[2];
  } else if (['folder', 'tag'].includes(parts[0]) && parts[1]) {
    view = { type: parts[0], id: parts[1] };
    if (parts[2] === 'n') noteId = parts[3];
  }
  return { view, noteId, snipId };
}
function applyHash() {
  const { view, noteId, snipId } = parseHash(location.hash);
  if (view.type !== S.view.type || view.id !== S.view.id) {
    S.search = ''; $('#search').value = ''; S.searchAll = false;
    $('#note-list').scrollTop = 0; // cada carpeta empieza arriba
  }
  S.view = view;
  closeDrawer();
  renderSection();
  renderSidebar(); renderList();
  if (noteId) openNote(noteId, { fromHash: true });
  else if (snipId) { S.noteId = null; openSnippet(snipId, { fromHash: true }); }
  else { closeSnippet({ fromHash: true }); closeEditor({ fromHash: true }); }
}

// Retroceso por varias entradas (subir varios niveles de carpeta de golpe)
let backNav = null; // { level, done, timer }
function onPopState() {
  if (backNav) { backStep(); return; }
  applyHash();
}
function backStep() {
  clearTimeout(backNav.timer);
  const st = history.state || {};
  if ((st.d || 0) > 0 && ((st.lv ?? 0) > backNav.level || st.nt)) {
    backNav.timer = setTimeout(() => { if (backNav) { const f = backNav.done; backNav = null; f(); } }, 600);
    history.back();
    return;
  }
  const f = backNav.done; backNav = null; f();
}
const backTo = (level) => new Promise((done) => { backNav = { level, done, timer: null }; backStep(); });

/** Navega a una vista del explorador de Notas manteniendo el historial como la ruta de carpetas. */
async function goView(view) {
  const chain = chainFor(view);
  const st = history.state || {};
  const d = st.d || 0;
  if (d === 0) { pushChain(chain, 0, 0); applyHash(); return; }
  const cur = chainFor(S.view);
  let p = 0;
  while (p < cur.length && p < chain.length && cur[p] === chain[p]) p++;
  const keep = Math.max(0, p - 1);
  if (p > 0 && cur.length === p && !st.nt && (st.lv ?? 0) === keep) { pushChain(chain, p, d); applyHash(); return; }
  await backTo(keep);
  const st2 = history.state || {};
  const d2 = st2.d || 0;
  if (d2 === 0) pushChain(chain, 0, 0);
  else {
    const L = Math.min(st2.lv ?? 0, chain.length - 1);
    history.replaceState({ d: d2, lv: L, nt: 0 }, '', chain[L]);
    pushChain(chain, L + 1, d2);
  }
  applyHash();
}

function goHome() {
  saveSoon.flush(); flushSnippet();
  closeDrawer();
  const d = history.state?.d || 0;
  if (d > 0) {
    history.go(-d);
    // Por si el historial no tuviera esas entradas
    setTimeout(() => { if (S.view.type !== 'home') { history.replaceState({ d: 0 }, '', '#/inicio'); applyHash(); } }, 500);
    return;
  }
  history.replaceState({ d: 0 }, '', '#/inicio');
  applyHash();
}

/** Cambia de vista. Devuelve una promesa (la navegación del explorador puede tardar unos milisegundos). */
function setView(view) {
  if (view.type === 'home') { goHome(); return Promise.resolve(); }
  if (view.type === 'search') return openFind();
  saveSoon.flush();
  closeDrawer();
  if (isExplorer(view.type)) {
    S.search = ''; $('#search').value = ''; S.searchAll = false;
    return goView(view);
  }
  const fromHome = S.view.type === 'home';
  closeSnippet({ fromHash: true });
  S.view = view;
  S.search = ''; $('#search').value = '';
  S.noteId = null;
  S.reading = false;
  showEditorEmpty();
  showList();
  renderSection();
  pushHash(!fromHome);
  renderSidebar(); renderList();
  return Promise.resolve();
}

/** Inicio y Buscar ocupan la zona de lista + nota; Notas y Prerredactados usan la lista y el editor. */
function renderSection() {
  const sec = sectionOf();
  $('#app').dataset.section = sec;
  if (sec === 'home') renderHome();
  if (sec === 'search') { if ($('#find-input').value !== S.find) $('#find-input').value = S.find; renderFind(); }
  renderNav();
  updateWakeLock();
}

// ====================== Navegación (franja de módulos y barra inferior) ======================
/** Construye la franja (tablet/PC) y la barra inferior (móvil) a partir de MODULES */
function buildNav() {
  const navBtn = (cls, item, soon) => el('button', {
    class: `${cls} ${soon ? 'soon' : ''}`, type: 'button', dataset: { nav: item.id },
    title: soon ? `${item.name} · Próximamente` : item.name, 'aria-label': soon ? `${item.name} (próximamente)` : item.name,
    onclick: () => navTo(item)
  }, el('span', { class: 'ico' }, iconOr(item.icon)), el('span', { class: 'lbl' }, item.short || item.name));
  // Franja: Inicio, Buscar y todos los módulos (los «Próximamente» en gris)
  const rail = [NAV_HOME, NAV_SEARCH, ...MODULES].map((m) => navBtn('rail-btn', m, m.status && m.status !== 'active'));
  $('#rail-items').replaceChildren(...rail);
  // Arrastrar una nota o carpeta encima de «Notas»/«Prerredactados» la saca a la raíz
  rail.forEach((b) => { const T = TREES[b.dataset.nav]; if (T) dropTarget(b, null, T); });
  // Barra inferior: Inicio · módulos con tab · ＋ Crear (en medio) · Buscar
  const tabs = [NAV_HOME, ...MODULES.filter((m) => m.tab && m.status === 'active'), NAV_SEARCH].map((m) => navBtn('tab', m, false));
  const create = el('button', { class: 'tab tab-create', type: 'button', 'aria-label': 'Crear', title: 'Crear', onclick: (e) => createMenu(e.currentTarget) },
    el('span', { class: 'ico' }, icon('plus')), el('span', { class: 'lbl' }, 'Crear'));
  tabs.splice(Math.ceil(tabs.length / 2), 0, create);
  $('#tabbar').replaceChildren(...tabs);
}

/** Marca la sección activa y los recuentos */
function renderNav() {
  const sec = sectionOf();
  $$('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === sec));
  $$('[data-nav]').forEach((b) => { if (b.dataset.nav === sec) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
}
const renderNavSoon = debounce(() => renderNav(), 80);

/** Tocar un acceso: abre su sección; si ya estás en ella, vuelve a su raíz (p. ej. «Notas») */
function navTo(item) {
  if (item.status && item.status !== 'active') { toast(`${item.name}: próximamente`); return; }
  if (item.id === 'home') { goHome(); return; }
  if (item.id === 'search') { openFind(); return; }
  setView(parseHash(item.route).view);
}

/** Barra lateral: plegar/desplegar (ordenador, se recuerda) o abrir/cerrar encima (tablet) */
function toggleSide() {
  if (matchMedia('(min-width: 1100px)').matches) {
    S.sideClosed = !S.sideClosed;
    localStorage.setItem('drfolio.side', S.sideClosed ? 'closed' : 'open');
    $('#app').classList.toggle('side-closed', S.sideClosed);
  } else $('#app').classList.toggle('drawer');
}

async function askLogout() {
  if (getMode() !== 'public' && !await confirm('Cerrar sesión', 'Se borrará la copia sin conexión de este dispositivo. Tus datos siguen guardados en la nube.', { okLabel: 'Cerrar sesión', danger: true })) return;
  doLogout();
}

// ---------- ＋ Crear ----------
/** Menú «Crear»: nota, prerredactado o carpeta, en la carpeta abierta en ese momento */
function createMenu(anchor) {
  const v = S.view;
  const sec = sectionOf();
  const nf = v.type === 'folder' ? store.folders.get(v.id) : null;
  const sf = v.type === 'sfolder' ? store.snippetFolders.get(v.id) : null;
  const inF = (f) => (f ? ` en «${f.name}»` : '');
  const folderItem = (T, f) => ({
    icon: 'folder-plus', label: f ? `Subcarpeta${inF(f)}` : `Carpeta de ${T.many}`,
    onClick: async () => {
      const id = await newFolder(f?.id || null, T);
      if (id && sec !== T.id) setView({ type: T.folder, id });
    }
  });
  menu(anchor, [
    { icon: 'notebook-text', label: `Nota${inF(nf)}`, onClick: () => newNote() },
    { icon: 'clipboard-list', label: `Prerredactado${inF(sf)}`, onClick: () => (sec === 'snippets' ? newSnippetHere() : setView({ type: 'snippets', id: null }).then(() => newSnippet())) },
    '-',
    ...(sec === 'notes' ? [folderItem(TREES.notes, nf)] : sec === 'snippets' ? [folderItem(TREES.snippets, sf)]
      : [folderItem(TREES.notes, null), folderItem(TREES.snippets, null)])
  ]);
}

// ====================== Búsqueda global (#/buscar) ======================
// Cada fuente busca en un tipo de elemento. Para añadir el Vademécum: una entrada más aquí.
const byUpdated = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
const SEARCH_SOURCES = [
  {
    id: 'notes', name: 'Notas', icon: 'notebook-text', all: 'Ver todas las notas',
    loaded: () => store.loaded.notes,
    run: (words) => liveNotes().filter((n) => words.every((w) => searchable(n).includes(w))).sort(byUpdated),
    card: (n, q) => noteCard(n, { search: q, sort: 'updated' })
  },
  {
    id: 'snippets', name: 'Prerredactados', icon: 'clipboard-list', all: 'Ver todos los prerredactados',
    loaded: () => store.loaded.snippets,
    run: (words) => allSnippets().filter((s) => snippetMatches(s, words)).sort(byUpdated),
    card: (s, q) => snippetCard(s, { search: q, showPath: true, onLongPress: longPressed, onOpen: openSnippetFromSearch })
  }
];

/** Abre Buscar. Es una sección de primer nivel: «atrás» desde ella vuelve a Inicio. */
async function openFind() {
  saveSoon.flush(); flushSnippet();
  closeDrawer();
  if (S.view.type !== 'search' || S.noteId || currentSnippet()) {
    await backTo(-1);
    history.pushState({ d: (history.state?.d || 0) + 1, lv: 0, nt: 0 }, '', NAV_SEARCH.route);
    applyHash();
  } else if (S.find) { S.find = ''; $('#find-input').value = ''; renderFind(); }
  $('#find-input').focus();
}

/** Prerredactado abierto desde Buscar: se abre dentro de Prerredactados y «atrás» vuelve a Buscar */
function openSnippetFromSearch(id) {
  S.view = { type: 'snippets', id: null };
  S.search = ''; $('#search').value = '';
  renderSection(); renderSidebar(); renderList();
  openSnippet(id, { push: true });
}

const renderFindSoon = debounce(() => { if (S.view.type === 'search') renderFind(); }, 80);
function renderFind() {
  const q = S.find;
  const words = norm(q.trim()).split(/\s+/).filter(Boolean);
  const res = SEARCH_SOURCES.map((src) => ({ src, list: words.length && src.loaded() ? src.run(words) : [] }));
  const total = res.reduce((t, r) => t + r.list.length, 0);
  if (S.findFilter !== 'all' && !SEARCH_SOURCES.some((x) => x.id === S.findFilter)) S.findFilter = 'all';
  const chip = (id, label, n) => el('button', {
    class: `find-chip ${S.findFilter === id ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(S.findFilter === id),
    onclick: () => { S.findFilter = id; renderFind(); $('#find-scroll').scrollTop = 0; }
  }, label, words.length ? el('span', { class: 'n' }, n) : null);
  $('#find-filters').replaceChildren(chip('all', 'Todo', total), ...res.map((r) => chip(r.src.id, [icon(r.src.icon), ` ${r.src.name}`], r.list.length)));

  const box = $('#find-results');
  if (!words.length) {
    box.replaceChildren(el('div', { class: 'find-hint' }, el('p', { class: 'big' }, icon('search')),
      el('p', {}, 'Busca a la vez en tus notas y prerredactados.'),
      el('p', { class: 'small' }, 'Sin tildes ni mayúsculas: «tension» encuentra «Tensión». Varias palabras = deben aparecer todas.')));
    return;
  }
  if (res.every((r) => !r.src.loaded())) { box.replaceChildren(el('div', { class: 'list-empty' }, 'Cargando…')); return; }
  const shown = res.filter((r) => S.findFilter === 'all' || r.src.id === S.findFilter);
  const out = [];
  const cs = contentSearchBar();
  if (cs && (S.findFilter === 'all' || S.findFilter === 'notes')) out.push(cs);
  for (const { src, list } of shown) {
    if (S.findFilter === 'all' && !list.length) continue;
    const max = S.findFilter === 'all' ? 5 : 300;
    out.push(el('div', { class: 'find-sec' }, el('span', {}, icon(src.icon), ` ${src.name} · ${list.length}`)));
    if (!list.length) { out.push(el('div', { class: 'fx-hint' }, `No hay ${src.name.toLowerCase()} que coincidan.`)); continue; }
    out.push(lazyBlock('home-notes', list.slice(0, max), (it) => src.card(it, q), `find:${src.id}:${S.findFilter}:${q}`));
    if (list.length > max) {
      out.push(el('button', { class: 'btn find-more', type: 'button', onclick: () => { S.findFilter = src.id; renderFind(); $('#find-scroll').scrollTop = 0; } },
        S.findFilter === 'all' ? `${src.all} (${list.length})` : `Mostrando ${max} de ${list.length}. Afina la búsqueda.`));
    }
  }
  if (!out.some((x) => !x.classList.contains('cs-bar'))) out.push(el('div', { class: 'list-empty' }, `Sin resultados para «${q.trim()}».`));
  box.replaceChildren(...out);
}

/**
 * Aviso sobre la búsqueda en el CONTENIDO de las notas (título, etiquetas y vista previa siempre son instantáneos):
 *  - Confianza: mientras se descarga en segundo plano, «Preparando la búsqueda en el contenido… X de N».
 *  - Ordenador público: botón «Buscar también en el contenido» (descarga los cuerpos bajo demanda).
 */
function contentSearchBar() {
  const total = store.notes.size;
  const have = bodiesAvailable();
  if (!total || have >= total) return null;
  if (bodyState.persist || S.contentSearch) {
    if (!bodyState.syncing && !bodyState.error) return null;
    return el('div', { class: 'cs-bar muted small' }, bodyState.error && !bodyState.syncing
      ? `Sin conexión: se busca en el contenido de ${have.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')} notas (y en todos los títulos y etiquetas).`
      : `Preparando la búsqueda en el contenido… ${have.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')} notas`);
  }
  return el('div', { class: 'cs-bar' },
    el('span', { class: 'muted small' }, 'Se busca en títulos, etiquetas y el principio de cada nota.'),
    el('button', { class: 'btn sm', type: 'button', onclick: () => { S.contentSearch = true; syncBodies(); renderFind(); renderList(); } },
      icon('search'), ' Buscar también en el contenido'));
}

// ====================== Barra lateral ======================
function renderAll() { renderSidebar(); renderList(); }

/** Barra lateral según la sección: Notas (vistas, carpetas, etiquetas) o Prerredactados (vistas, carpetas). Inicio y Buscar: sin barra. */
function renderSidebar() {
  const live = liveNotes();
  const tags = [...store.tags.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  $('#tag-suggest').replaceChildren(...tags.map((t) => el('option', { value: t.name }))); // sugerencias del editor
  const sec = sectionOf();
  const T = TREES[sec];
  $('#app').dataset.side = T ? '1' : '0';
  if (!T) { closeDrawer(); return; }
  $('#side-title').textContent = T.rootName;
  const v = S.view;
  const navItem = (ico, lbl, count, type) => el('button', {
    class: `nav-item ${v.type === type ? 'active' : ''}`, type: 'button', onclick: () => setView({ type, id: null })
  }, el('span', { class: 'ico' }, iconOr(ico)), el('span', { class: 'lbl' }, lbl), el('span', { class: 'count' }, count || ''));
  const body = [el('button', { class: 'btn primary block', type: 'button', onclick: () => T.newItem() }, `＋ ${T.txt.newOne}`)];

  if (sec === 'notes') {
    body.push(el('nav', { class: 'side-nav' },
      navItem('notebook-text', 'Todas las notas', live.length, 'all'),
      navItem('pin', 'Fijadas', live.filter((n) => n.pinned).length, 'pinned'),
      navItem('clock', 'Recientes', null, 'recent'),
      navItem('trash-2', 'Papelera', [...store.notes.values()].filter((n) => n.trashed).length, 'trash')));
  } else {
    const all = allSnippets();
    body.push(el('nav', { class: 'side-nav' },
      navItem('clipboard-list', 'Todos', all.length, 'sall'),
      navItem('star', 'Favoritos', all.filter((x) => x.favorite).length, 'sfav'),
      navItem('flame', 'Más usados', null, 'sused'),
      navItem('clock', 'Recientes', null, 'srecent')));
  }

  // Carpetas del árbol de la sección (recuento con subcarpetas)
  const totals = folderTotals(T);
  const rows = [];
  const walk = (parentId, depth) => {
    for (const f of sortedChildren(parentId, T)) {
      const kids = childFolders(f.id, T.map()).length > 0;
      const open = S.expanded.has(f.id);
      const row = el('div', {
        class: `tree-row ${v.type === T.folder && v.id === f.id ? 'active' : ''}`,
        style: { '--depth': depth }, role: 'button', tabindex: '0',
        onclick: (e) => { if (!longPressed(e.currentTarget) && !e.target.closest('.caret,.more')) setView({ type: T.folder, id: f.id }); },
        onkeydown: (e) => { if (e.key === 'Enter') setView({ type: T.folder, id: f.id }); }
      },
        el('span', { class: `caret ${kids ? '' : 'empty'}`, onclick: (e) => { e.stopPropagation(); toggleFolder(f.id); } }, open ? '▼' : '▶'),
        el('span', { class: 'dot', style: f.color ? { background: f.color } : {} }),
        el('span', { class: 'lbl' }, f.name),
        el('span', { class: 'count' }, totals.get(f.id) || ''),
        el('button', { class: 'more', title: 'Opciones', 'aria-label': 'Opciones de carpeta', onclick: (e) => { e.stopPropagation(); folderMenu(e.currentTarget, f, { T }); } }, icon('ellipsis')));
      dropTarget(row, f.id, T);
      bindContext(row, (a) => folderMenu(a, f, { T }));
      rows.push(row);
      if (kids && open) walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  const rootLink = el('button', { type: 'button', class: `side-link ${v.type === T.root ? 'on' : ''}`, title: 'Abrir el explorador de carpetas', onclick: () => setView({ type: T.root, id: null }) }, 'Carpetas');
  dropTarget(rootLink, null, T);
  body.push(el('div', { class: 'side-section' },
    el('div', { class: 'side-title' }, rootLink,
      el('button', { class: 'icon-btn sm', type: 'button', title: 'Nueva carpeta', 'aria-label': 'Nueva carpeta', onclick: () => newFolder(null, T) }, icon('plus'))),
    el('div', { class: 'tree' }, rows.length ? rows : el('div', { class: 'side-empty' }, 'Crea tu primera carpeta con ＋'))));

  if (sec === 'notes') {
    const tagCount = new Map();
    for (const n of live) for (const t of n.tags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    body.push(el('div', { class: 'side-section' },
      el('div', { class: 'side-title' }, el('span', {}, 'Etiquetas')),
      el('div', { class: 'tag-list' }, tags.length ? tags.map((t) => el('div', {
        class: `tag-item ${v.type === 'tag' && v.id === t.id ? 'active' : ''}`, role: 'button', tabindex: '0',
        onclick: (e) => { if (!e.target.closest('.more')) setView({ type: 'tag', id: t.id }); }
      },
        el('span', { class: 'hash', style: t.color ? { color: t.color } : {} }, icon('tag')),
        el('span', { class: 'lbl' }, t.name),
        el('span', { class: 'count' }, tagCount.get(t.id) || ''),
        el('button', { class: 'more', 'aria-label': 'Opciones de etiqueta', onclick: (e) => { e.stopPropagation(); tagMenu(e.currentTarget, t); } }, icon('ellipsis'))
      )) : el('div', { class: 'side-empty' }, 'Añade etiquetas desde una nota'))));
  }
  $('#side-body').replaceChildren(...body);
}

function toggleFolder(id) {
  if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id);
  localStorage.setItem('drfolio.expanded', JSON.stringify([...S.expanded]));
  renderSidebar();
}

// ---------- Carpetas (sirven para los dos árboles: T = TREES.notes | TREES.snippets) ----------
/** Recuento de elementos por carpeta, incluidas sus subcarpetas: Map(id → total) */
function folderTotals(T = TREES.notes, items = T.items()) {
  const direct = new Map();
  for (const n of items) if (n.folderId) direct.set(n.folderId, (direct.get(n.folderId) || 0) + 1);
  const kids = new Map();
  for (const f of T.map().values()) {
    const k = f.parentId || null;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(f.id);
  }
  const out = new Map();
  const seen = new Set();
  const sum = (id) => {
    if (out.has(id)) return out.get(id);
    if (seen.has(id)) return 0; // protección ante ciclos
    seen.add(id);
    const t = (direct.get(id) || 0) + (kids.get(id) || []).reduce((acc, k) => acc + sum(k), 0);
    out.set(id, t);
    return t;
  };
  for (const id of T.map().keys()) sum(id);
  return out;
}

/** Subcarpetas ordenadas según la preferencia (manual = campo `order`, o por nombre) */
function sortedChildren(parentId, T = TREES.notes) {
  const list = childFolders(parentId, T.map());
  if (T.folderSort() !== 'manual') list.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }));
  return list;
}

function setFolderSort(mode, T = TREES.notes) {
  T.setSort(mode);
  renderSidebar(); renderList();
}

/** Subir / bajar una carpeta entre sus hermanas (orden manual). Renumera el campo `order`. */
function shiftFolder(f, dir, T = TREES.notes) {
  if (T.folderSort() !== 'manual') { T.setSort('manual'); toast('Orden manual activado', 'ok'); }
  const sibs = childFolders(f.parentId || null, T.map());
  const i = sibs.findIndex((x) => x.id === f.id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return;
  [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  sibs.forEach((x, k) => {
    const order = (k + 1) * 1000;
    if (x.order !== order) { x.order = order; patch(T.col, x.id, { order }); }
  });
  renderSidebar(); renderList();
}

async function newFolder(parentId, T = TREES.notes) {
  const name = await prompt(parentId ? 'Nueva subcarpeta' : 'Nueva carpeta', '', { placeholder: T.txt.folderHint });
  if (!name) return;
  const id = newId(T.col);
  const now = Date.now();
  const data = { name, parentId: parentId || null, color: null, order: now, createdAt: now, updatedAt: now };
  T.map().set(id, { id, ...data }); // visible al instante
  put(T.col, id, data);
  if (parentId && T.id === 'notes') { S.expanded.add(parentId); localStorage.setItem('drfolio.expanded', JSON.stringify([...S.expanded])); }
  renderSidebar(); renderList();
  return id;
}

function folderMenu(anchor, f, { here = false, T = TREES.notes } = {}) {
  const sibs = childFolders(f.parentId || null, T.map());
  const i = sibs.findIndex((x) => x.id === f.id);
  const inView = S.view.type === T.folder && S.view.id === f.id;
  menu(anchor, [
    here || inView ? null : { icon: 'folder-open', label: 'Abrir', onClick: () => setView({ type: T.folder, id: f.id }) },
    { icon: 'folder-plus', label: 'Nueva subcarpeta', onClick: () => newFolder(f.id, T) },
    { icon: 'file-plus', label: T.txt.newHere, onClick: () => (inView ? T.newItem() : setView({ type: T.folder, id: f.id }).then(() => T.newItem())) },
    '-',
    { icon: 'pencil', label: 'Renombrar', onClick: async () => {
      const name = await prompt('Renombrar carpeta', f.name);
      if (name) patch(T.col, f.id, { name, updatedAt: Date.now() });
    } },
    { icon: 'palette', label: 'Color', onClick: async () => {
      const c = await colorPicker('Color de la carpeta', ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', ''], 'label');
      if (c !== undefined) patch(T.col, f.id, { color: c || null });
    } },
    { icon: 'folder-input', label: 'Mover a…', onClick: () => moveFolder(f, T) },
    i > 0 ? { icon: 'arrow-up', label: 'Subir', onClick: () => shiftFolder(f, -1, T) } : null,
    i >= 0 && i < sibs.length - 1 ? { icon: 'arrow-down', label: 'Bajar', onClick: () => shiftFolder(f, 1, T) } : null,
    '-',
    { icon: 'trash-2', label: 'Eliminar carpeta', danger: true, onClick: () => deleteFolder(f, T) }
  ].filter(Boolean));
}

/** Menú ⋯ de la raíz («Notas» o «Prerredactados») */
function rootMenu(anchor, T = TREES.notes) {
  const cur = T.sortValue();
  menu(anchor, [
    { icon: 'folder-plus', label: 'Nueva carpeta', onClick: () => newFolder(null, T) },
    { icon: 'file-plus', label: T.txt.newOne, onClick: () => T.newItem() },
    '-',
    ...T.sortOptions.map(([value, label]) => ({ icon: cur === value ? '●' : '○', label: `Ordenar: ${label.toLowerCase()}`, onClick: () => setFolderSort(value, T) }))
  ]);
}

// ---------- Mantener pulsado (móvil) / clic derecho (PC) ----------
/** Ancla de menú en un punto de la pantalla */
const pointAnchor = (x, y) => ({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 }) });
/** Abre open(ancla) al mantener pulsado (táctil, 500 ms) o con clic derecho. Tras ello, el clic se ignora. */
function bindContext(node, open, { touch = true } = {}) {
  let timer = null, sx = 0, sy = 0;
  const fire = (x, y) => { node.dataset.lp = String(Date.now()); open(pointAnchor(x, y)); };
  node.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (Date.now() - Number(node.dataset.lp || 0) < 900) return;
    fire(e.clientX, e.clientY);
  });
  if (!touch) return;
  const cancel = () => { clearTimeout(timer); timer = null; };
  node.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    sx = e.clientX; sy = e.clientY;
    cancel();
    timer = setTimeout(() => { timer = null; navigator.vibrate?.(12); fire(sx, sy); }, 500);
  });
  node.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  ['pointerup', 'pointercancel', 'pointerleave', 'dragstart'].forEach((ev) => node.addEventListener(ev, cancel));
}
/** true si el clic llega justo al soltar tras mantener pulsado (hay que ignorarlo) */
const longPressed = (node) => Date.now() - Number(node.dataset.lp || 0) < 900;

// ---------- Arrastrar notas / prerredactados (y carpetas) a una carpeta (ordenador / tablet) ----------
const DRAG_TYPE = 'application/x-drfolio';
let dragging = null; // { tree: 'notes'|'snippets', kind: 'item'|'folder', id }
const canDrag = () => matchMedia('(pointer: fine), (min-width: 640px)').matches;
function makeDraggable(node, kind, id, T = TREES.notes) {
  if (!canDrag()) return;
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    dragging = { tree: T.id, kind, id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_TYPE, `${T.id}:${kind}:${id}`); // tipo propio: el editor no lo pega como texto
    document.body.classList.add('dragging');
  });
  node.addEventListener('dragend', () => {
    dragging = null;
    document.body.classList.remove('dragging');
    $$('.drop-over').forEach((x) => x.classList.remove('drop-over'));
  });
}
const canDropOn = (folderId, T) => {
  if (!dragging || dragging.tree !== T.id) return false; // no se mezclan los dos árboles
  if (dragging.kind === 'item') return true;
  return folderId !== dragging.id && !(folderId && descendantIds(dragging.id, T.map()).has(folderId));
};
/** Zona donde soltar: folderId = carpeta destino, null = raíz (sin carpeta / nivel principal) */
function dropTarget(node, folderId, T = TREES.notes) {
  node.addEventListener('dragover', (e) => {
    if (!canDropOn(folderId, T)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    node.classList.add('drop-over');
  });
  node.addEventListener('dragleave', (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove('drop-over'); });
  node.addEventListener('drop', (e) => {
    node.classList.remove('drop-over');
    if (!canDropOn(folderId, T)) return;
    e.preventDefault(); e.stopPropagation();
    const { kind, id } = dragging;
    dragging = null;
    if (kind === 'item') T.moveItem(id, folderId);
    else moveFolderTo(id, folderId, T);
  });
}
function moveNoteTo(id, folderId) {
  const n = store.notes.get(id);
  if (!n || n.trashed || (n.folderId || null) === (folderId || null)) return;
  n.folderId = folderId || null; // reflejo inmediato
  patch('notes', id, { folderId: folderId || null, updatedAt: Date.now() });
  toast(`Nota movida a ${folderId ? `«${store.folders.get(folderId)?.name || 'carpeta'}»` : '«Notas» (sin carpeta)'}`, 'ok');
  renderList(); renderSidebar();
  if (S.noteId === id) renderNoteChrome();
}
function moveFolderTo(id, parentId, T = TREES.notes) {
  const f = T.map().get(id);
  if (!f || (f.parentId || null) === (parentId || null)) return;
  f.parentId = parentId || null;
  const order = Date.now();
  f.order = order;
  patch(T.col, id, { parentId: parentId || null, order, updatedAt: Date.now() });
  toast(`Carpeta movida a ${parentId ? `«${T.map().get(parentId)?.name || 'carpeta'}»` : 'el nivel principal'}`, 'ok');
  renderList(); renderSidebar();
}

async function moveFolder(f, T = TREES.notes) {
  const banned = descendantIds(f.id, T.map());
  const items = [{ id: '__root', label: '— Nivel principal —' },
    ...flatFolders(null, T.map()).filter((x) => !banned.has(x.id)).map((x) => ({ id: x.id, label: x.name, depth: x.depth }))];
  const target = await picker(`Mover «${f.name}» a…`, items);
  if (!target) return;
  moveFolderTo(f.id, target === '__root' ? null : target, T);
}

/** Eliminar carpeta: no se borra nada, su contenido (subcarpetas y elementos) sube a la carpeta superior */
async function deleteFolder(f, T = TREES.notes) {
  const parent = f.parentId ? T.map().get(f.parentId) : null;
  const items = [...store[T.itemCol].values()].filter((n) => n.folderId === f.id);
  const kids = childFolders(f.id, T.map());
  const dest = parent ? `«${parent.name}»` : T.txt.rootDest;
  const ok = await confirm('Eliminar carpeta',
    items.length || kids.length
      ? `«${f.name}» tiene ${plural(items.length, T.one, T.many)} y ${plural(kids.length, 'subcarpeta', 'subcarpetas')}. No se borra nada: pasarán a ${dest}.`
      : `¿Eliminar la carpeta «${f.name}»?`,
    { okLabel: 'Eliminar carpeta', danger: true });
  if (!ok) return;
  const up = f.parentId || null;
  for (const k of kids) { k.parentId = up; patch(T.col, k.id, { parentId: up }); }
  for (const n of items) { n.folderId = up; patch(T.itemCol, n.id, { folderId: up }); }
  T.map().delete(f.id);
  remove(T.col, f.id);
  if (S.view.type === T.folder && S.view.id === f.id) setView(up ? { type: T.folder, id: up } : { type: T.root, id: null });
  else { renderList(); renderSidebar(); }
}

// ---------- Etiquetas ----------
function tagMenu(anchor, t) {
  menu(anchor, [
    { icon: 'pencil', label: 'Renombrar', onClick: async () => {
      const name = await prompt('Renombrar etiqueta', t.name);
      if (!name || name === t.name) return;
      const other = tagByName(name);
      if (other && other.id !== t.id) { toast('Ya existe una etiqueta con ese nombre', 'error'); return; }
      patch('tags', t.id, { name });
    } },
    { icon: 'palette', label: 'Color', onClick: async () => {
      const c = await colorPicker('Color de la etiqueta', ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', ''], 'label');
      if (c !== undefined) patch('tags', t.id, { color: c || null });
    } },
    '-',
    { icon: 'trash-2', label: 'Eliminar etiqueta', danger: true, onClick: async () => {
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
// Texto de búsqueda de una nota: título + etiquetas + vista previa (siempre, al instante)
// y, si el contenido está descargado (confianza o «Buscar también en el contenido»), todo el texto y la bibliografía.
const searchCache = new Map(); // id -> {k, s}
function searchable(n) {
  const c = searchCache.get(n.id);
  const b = bodyOf(n.id);
  const tagNames = (n.tags || []).map((t) => store.tags.get(t)?.name || '').join(' ');
  const key = `${n.updatedAt}|${n.title}|${tagNames}|${b ? b.v || b.updatedAt || 1 : 0}`;
  if (c && c.k === key) return c.s;
  const refs = b ? (b.refs || []).map((r) => `${r.cite || ''} ${r.fileName || ''}`).join(' ') : '';
  const s = norm(`${n.title || ''}\n${tagNames}\n${b ? b.text || '' : n.preview || ''}\n${refs}`);
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
    else if (v.type === 'recent') list = list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 50);
    else if (v.type === 'notes') list = list.filter((n) => !n.folderId);
    else if (v.type === 'folder') { const ids = descendantIds(v.id); list = list.filter((n) => ids.has(n.folderId)); }
    else if (v.type === 'tag') list = list.filter((n) => (n.tags || []).includes(v.id));
  }
  const q = norm(S.search.trim());
  if (q) {
    const words = q.split(/\s+/);
    list = list.filter((n) => { const s = searchable(n); return words.every((w) => s.includes(w)); });
  }
  if (v.type === 'recent') return list;
  const cmp = {
    updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    title: (a, b) => (a.title || 'Sin título').localeCompare(b.title || 'Sin título', 'es')
  }[S.sort] || ((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return list.sort((a, b) => (v.type !== 'trash' && !!b.pinned - !!a.pinned) || cmp(a, b));
}

function viewTitle() {
  const v = S.view;
  if (v.type === 'notes') return 'Notas';
  if (v.type === 'recent') return 'Recientes';
  if (v.type === 'pinned') return 'Fijadas';
  if (v.type === 'trash') return 'Papelera';
  if (v.type === 'snippets') return 'Prerredactados';
  if (v.type === 'sall') return 'Todos los prerredactados';
  if (v.type === 'sfav') return 'Favoritos';
  if (v.type === 'sused') return 'Más usados';
  if (v.type === 'srecent') return 'Recientes';
  if (v.type === 'folder') return store.folders.get(v.id)?.name || 'Carpeta';
  if (v.type === 'sfolder') return store.snippetFolders.get(v.id)?.name || 'Carpeta';
  if (v.type === 'tag') return `#${store.tags.get(v.id)?.name || 'etiqueta'}`;
  return 'Todas las notas';
}

function snippetNode(n, search = S.search) {
  const b = bodyOf(n.id);
  const text = ((b ? b.text : n.preview) || '').replace(/\s+/g, ' ').trim();
  const q = norm(search.trim()).split(/\s+/).filter(Boolean)[0];
  if (!q || !text) return text.slice(0, 160) || 'Sin contenido';
  const nt = norm(text);
  const i = nt.indexOf(q);
  if (i < 0) return text.slice(0, 160);
  const start = Math.max(0, i - 50);
  const frag = document.createDocumentFragment();
  frag.append(start ? '…' : '', text.slice(start, i), el('mark', {}, text.slice(i, i + q.length)), text.slice(i + q.length, i + q.length + 110));
  return frag;
}

/** El selector «Ordenar» cambia de opciones según el árbol (notas: fecha/título · prerredactados: manual/nombre/uso/recientes) */
function syncSortSelect(T) {
  const sel = $('#sort');
  const kind = T?.id === 'snippets' ? 'snippets' : 'notes';
  if (sel.dataset.kind !== kind) {
    const opts = kind === 'snippets' ? SNIP_SORTS : [['updated', 'Modificadas'], ['created', 'Creadas'], ['title', 'Título']];
    sel.replaceChildren(...opts.map(([value, label]) => el('option', { value }, label)));
    sel.dataset.kind = kind;
  }
  sel.value = kind === 'snippets' ? snipSort() : S.sort;
}

function renderList() {
  if (!treeOf(S.view.type)) return; // Inicio y Buscar no usan la lista
  const v = S.view;
  const T = treeOf(v.type);
  const snip = T?.id === 'snippets';
  $('#list-title').textContent = viewTitle();
  const box = $('#note-list');
  $('#btn-new-note').title = snip ? 'Nuevo prerredactado' : 'Nueva nota';
  $('#btn-layout').classList.toggle('hidden', !T || v.type === 'trash');
  $('#btn-layout').replaceChildren(icon(S.layout === 'grid' ? 'list' : 'layout-grid'));
  $('#btn-layout').title = S.layout === 'grid' ? 'Ver como lista' : 'Ver como cuadrícula';
  $('#btn-list-more').classList.toggle('hidden', !T || !(v.type === T.root || v.type === T.folder));
  syncSortSelect(T);
  $('#sort').classList.toggle('hidden', ['recent', 'sused', 'srecent'].includes(v.type));
  $('#search').placeholder = T && v.type === T.folder ? `Buscar en «${T.map().get(v.id)?.name || 'carpeta'}»…`
    : T && v.type === T.root ? `${T.txt.searchAll}  (Ctrl+K)` : 'Buscar…  (Ctrl+K)';
  renderCrumbs();
  if (snip) { $('#list-trash-bar').classList.add('hidden'); renderSnippetView(box, T); return; }
  $('#list-trash-bar').classList.toggle('hidden', v.type !== 'trash' || !notesForView().length);
  if (!store.loaded.notes) { box.replaceChildren(el('div', { class: 'list-empty' }, 'Cargando notas…')); return; }
  if (v.type === 'folder' && !store.folders.has(v.id)) {
    box.replaceChildren(el('div', { class: 'list-empty' }, store.loaded.folders ? 'Esta carpeta ya no existe.' : 'Cargando carpetas…'));
    return;
  }
  if (v.type === 'notes' || v.type === 'folder') { renderExplorer(box, TREES.notes); return; }
  const notes = notesForView();
  if (!notes.length) {
    box.replaceChildren(el('div', { class: 'list-empty' },
      S.search ? 'No hay notas que coincidan.' : v.type === 'trash' ? 'La papelera está vacía.' : 'Aún no hay notas aquí.'));
    return;
  }
  if (v.type === 'trash') { box.replaceChildren(lazyBlock('trash-list', notes, (n) => noteCard(n))); return; }
  box.replaceChildren(el('div', { class: `fx ${S.layout === 'grid' ? 'grid' : ''}` }, notesBlock(notes)));
}

// ---------- Listas largas: se pintan por partes ----------
// Con miles de notas no se crean miles de tarjetas de golpe: primero LAZY_PAGE y el resto según te acercas al final
// (o con «Mostrar más»). Se recuerda cuántas había a la vista para que al refrescar la lista no salte el desplazamiento.
const LAZY_PAGE = 60;
const lazyShown = new Map(); // clave de la lista → nº de elementos pintados
let lazyIO = null;
function lazyKey() { return `${S.view.type}/${S.view.id}|${S.search}|${S.sort}|${snipSort()}|${S.layout}|${S.searchAll}`; }
function lazyBlock(cls, list, make, key = lazyKey()) {
  const box = el('div', { class: cls });
  let shown = 0;
  const more = el('button', { class: 'btn lazy-more', type: 'button', onclick: () => add(LAZY_PAGE * 3) });
  const add = (k) => {
    const end = Math.min(list.length, shown + k);
    const frag = document.createDocumentFragment();
    for (let i = shown; i < end; i++) frag.append(make(list[i]));
    box.insertBefore(frag, more.isConnected && more.parentNode === box ? more : null);
    shown = end;
    lazyShown.set(key, shown);
    if (shown >= list.length) { more.remove(); lazyIO?.unobserve(more); }
    else { more.textContent = `Mostrar más (${(list.length - shown).toLocaleString('es-ES')})`; if (!more.isConnected) box.append(more); }
  };
  add(Math.max(LAZY_PAGE, lazyShown.get(key) || 0));
  if (shown < list.length && 'IntersectionObserver' in window) {
    lazyIO ||= new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.target.isConnected) lazyIO.unobserve(e.target);
        else if (e.isIntersecting) e.target.click();
      }
    }, { rootMargin: '800px 0px' });
    lazyIO.observe(more);
  }
  if (lazyShown.size > 200) lazyShown.clear();
  return box;
}

/** Prerredactados: explorador de carpetas o una de las vistas fijas (Todos, Favoritos, Más usados, Recientes) */
function renderSnippetView(box, T) {
  const v = S.view;
  if (!store.loaded.snippets) { box.replaceChildren(el('div', { class: 'list-empty' }, 'Cargando prerredactados…')); return; }
  if (v.type === T.folder && !T.map().has(v.id)) {
    box.replaceChildren(el('div', { class: 'list-empty' }, store.loaded.snippetFolders ? 'Esta carpeta ya no existe.' : 'Cargando carpetas…'));
    return;
  }
  if (v.type === T.root || v.type === T.folder) { renderExplorer(box, T); return; }
  let list = snippetsForView(v.type);
  const q = norm(S.search.trim());
  if (q) list = list.filter((s) => snippetMatches(s, q.split(/\s+/)));
  if (!list.length) {
    box.replaceChildren(el('div', { class: 'list-empty' }, q ? 'No hay prerredactados que coincidan.'
      : v.type === 'sfav' ? 'Aún no tienes favoritos. Toca ☆ en un prerredactado para añadirlo.'
        : v.type === 'sused' ? 'Todavía no has copiado ni insertado ningún prerredactado.' : 'Aún no hay prerredactados.'));
    return;
  }
  box.replaceChildren(el('div', { class: `fx ${S.layout === 'grid' ? 'grid' : ''}` }, snippetsBlock(list, { showPath: true })));
}

/** Ruta de navegación: Notas › Urgencias › Cardio (cada tramo vuelve a ese nivel; también se puede soltar ahí) */
function renderCrumbs() {
  const v = S.view;
  const T = treeOf(v.type);
  const bar = $('#crumbs');
  if (!T || v.type === T.root) { bar.classList.add('hidden'); bar.replaceChildren(); return; }
  const segs = [{ label: T.rootName, view: { type: T.root, id: null }, drop: null }];
  if (v.type === T.folder) {
    for (const f of folderPath(v.id, T.map())) segs.push({ label: f.name, view: { type: T.folder, id: f.id }, drop: f.id });
  } else segs.push({ label: viewTitle() });
  const nodes = [];
  segs.forEach((sg, i) => {
    if (i) nodes.push(el('span', { class: 'sep', 'aria-hidden': 'true' }, '›'));
    const last = i === segs.length - 1;
    if (last) { nodes.push(el('span', { class: 'cur', 'aria-current': 'page' }, sg.label)); return; }
    const b = el('button', { type: 'button', onclick: () => setView(sg.view) }, i === 0 ? [icon(T.rootIcon), ` ${T.rootName}`] : sg.label);
    if ('drop' in sg) dropTarget(b, sg.drop, T);
    nodes.push(b);
  });
  bar.replaceChildren(...nodes);
  bar.classList.remove('hidden');
  bar.scrollLeft = bar.scrollWidth; // en móvil, que se vea el final de la ruta
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const matchesWords = (text, words) => { const s = norm(text); return words.every((w) => s.includes(w)); };

function sortNotes(list) {
  const cmp = {
    updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    title: (a, b) => (a.title || 'Sin título').localeCompare(b.title || 'Sin título', 'es')
  }[S.sort] || ((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return list.sort((a, b) => (!!b.pinned - !!a.pinned) || cmp(a, b));
}

/** Explorador (Notas o Prerredactados): raíz o una carpeta (subcarpetas primero, luego sus elementos) */
function renderExplorer(box, T) {
  const v = S.view;
  const folderId = v.type === T.folder ? v.id : null;
  const totals = folderTotals(T);
  const wrap = el('div', { class: `fx ${S.layout === 'grid' ? 'grid' : ''}` });
  const q = norm(S.search.trim());

  if (q) { renderExplorerSearch(wrap, folderId, q.split(/\s+/), totals, T); box.replaceChildren(wrap); return; }

  if (!folderId) {
    const tiles = T.shortcuts();
    wrap.append(el('div', { class: `fx-short n${tiles.length}` }, tiles.map(([ico, label, count, type]) =>
      el('button', { class: 'fx-tile', type: 'button', onclick: () => setView({ type, id: null }) },
        el('span', { class: 'fx-tile-ico' }, iconOr(ico)), el('span', { class: 'fx-tile-lbl' }, label),
        count != null ? el('span', { class: 'fx-tile-n' }, count) : null))));
    // En el móvil no hay barra lateral: Papelera y Etiquetas, aquí
    if (T.id === 'notes') {
      const nTrash = [...store.notes.values()].filter((n) => n.trashed).length;
      wrap.append(el('div', { class: 'fx-extra' },
        el('button', { class: 'fx-tile', type: 'button', onclick: () => setView({ type: 'trash', id: null }) },
          el('span', { class: 'fx-tile-ico' }, icon('trash-2')), el('span', { class: 'fx-tile-lbl' }, 'Papelera'), el('span', { class: 'fx-tile-n' }, nTrash || '')),
        el('button', { class: 'fx-tile', type: 'button', onclick: pickTag },
          el('span', { class: 'fx-tile-ico' }, icon('tag')), el('span', { class: 'fx-tile-lbl' }, 'Etiquetas'), el('span', { class: 'fx-tile-n' }, store.tags.size || ''))));
    }
  }

  wrap.append(el('div', { class: 'fx-actions' },
    el('button', { class: 'btn primary', type: 'button', onclick: () => T.newItem() }, T.txt.newBtn),
    el('button', { class: 'btn', type: 'button', onclick: () => newFolder(folderId, T) }, folderId ? '＋ Subcarpeta' : '＋ Carpeta')));

  const folders = sortedChildren(folderId, T);
  const items = T.sortItems(T.items().filter((n) => (n.folderId || null) === folderId));

  if (folders.length) {
    let sortSel = null;
    if (T.folderSelect) {
      sortSel = el('select', { 'aria-label': 'Ordenar carpetas', onchange: (e) => setFolderSort(e.target.value, T) },
        T.sortOptions.map(([value, label]) => el('option', { value }, label)));
      sortSel.value = T.sortValue();
    }
    wrap.append(el('div', { class: 'fx-sec' }, el('span', {}, `${folderId ? 'Subcarpetas' : 'Carpetas'} · ${folders.length}`), sortSel),
      el('div', { class: 'fx-folders' }, folders.map((f) => folderItem(f, totals, {}, T))));
  } else if (!folderId) {
    wrap.append(el('div', { class: 'fx-hint' }, T.txt.noFolders));
  }

  if (items.length) {
    wrap.append(el('div', { class: 'fx-sec' }, el('span', {}, `${folderId ? T.txt.itemsHere : T.txt.loose} · ${items.length}`)), T.block(items));
  } else if (folderId) {
    wrap.append(el('div', { class: 'fx-hint' }, folders.length ? T.txt.onlySubs : T.txt.emptyFolder));
  }
  box.replaceChildren(wrap);
}

/** Elegir una etiqueta para ver sus notas (móvil) */
async function pickTag() {
  const tags = [...store.tags.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (!tags.length) { toast('Aún no hay etiquetas. Añádelas desde una nota.'); return; }
  const count = new Map();
  for (const n of liveNotes()) for (const t of n.tags || []) count.set(t, (count.get(t) || 0) + 1);
  const id = await picker('Etiquetas', tags.map((t) => ({ id: t.id, label: `# ${t.name}`, sub: `${count.get(t.id) || 0} notas` })), { placeholder: 'Buscar etiqueta…' });
  if (id) setView({ type: 'tag', id });
}

/** Buscar en la carpeta actual (y sus subcarpetas) o en todo el árbol */
function renderExplorerSearch(wrap, folderId, words, totals, T) {
  const scoped = folderId && !S.searchAll;
  const m = T.map();
  const ids = scoped ? descendantIds(folderId, m) : null;
  if (folderId) {
    const name = m.get(folderId)?.name || 'carpeta';
    wrap.append(el('div', { class: 'fx-scope' },
      el('span', {}, scoped ? `Buscando en «${name}» y sus subcarpetas` : T.txt.searchingAll),
      el('button', { class: 'btn sm', type: 'button', onclick: () => { S.searchAll = !S.searchAll; renderList(); } },
        scoped ? T.txt.searchAllBtn : `Solo en «${name}»`)));
  }
  const folders = flatFolders(null, m).filter((f) => f.id !== folderId && (!ids || ids.has(f.id)) && matchesWords(f.name, words))
    .map((f) => m.get(f.id)).filter(Boolean);
  const items = T.sortItems(T.items().filter((n) => (!ids || ids.has(n.folderId)) && T.matches(n, words)));
  const cs = T.id === 'notes' ? contentSearchBar() : null;
  if (cs) wrap.append(cs);
  if (folders.length) wrap.append(el('div', { class: 'fx-sec' }, el('span', {}, `Carpetas · ${folders.length}`)),
    el('div', { class: 'fx-folders' }, folders.slice(0, 30).map((f) => folderItem(f, totals, { showPath: true }, T))));
  wrap.append(el('div', { class: 'fx-sec' }, el('span', {}, `${T.txt.Many} · ${items.length}`)));
  if (items.length) wrap.append(T.block(items.slice(0, 200), { showPath: true }));
  else wrap.append(el('div', { class: 'fx-hint' }, T.txt.noMatch));
}

function notesBlock(notes) {
  return lazyBlock('fx-notes', notes, (n) => noteCard(n));
}

function snippetsBlock(list, { showPath = false } = {}) {
  return lazyBlock('fx-notes', list, (s) => {
    const card = snippetCard(s, { search: S.search, showPath, onLongPress: longPressed });
    // Como las notas: en el móvil se mantiene pulsado para el menú; en ordenador/tablet se arrastra (y clic derecho = menú)
    bindContext(card, (a) => snippetItemMenu(a, s), { touch: !canDrag() });
    makeDraggable(card, 'item', s.id, TREES.snippets);
    return card;
  });
}

/** Tarjeta / fila de carpeta: tocar = abrir; mantener pulsado, clic derecho o ⋯ = opciones; soltar = mover */
function folderItem(f, totals, { showPath = false } = {}, T = TREES.notes) {
  const subs = childFolders(f.id, T.map()).length;
  const n = totals.get(f.id) || 0;
  const open = (e) => { if (!longPressed(item) && !e.target.closest('.fx-more')) setView({ type: T.folder, id: f.id }); };
  const parent = showPath && f.parentId ? folderPath(f.parentId, T.map()).map((x) => x.name).join(' › ') : '';
  const item = el('div', {
    class: 'fx-folder', role: 'button', tabindex: '0', style: f.color ? { '--fc': f.color } : {},
    'aria-label': `Carpeta ${f.name}, ${plural(n, T.one, T.many)}`,
    onclick: open,
    onkeydown: (e) => { if (e.key === 'Enter') setView({ type: T.folder, id: f.id }); }
  },
    el('span', { class: 'fx-ico', 'aria-hidden': 'true' }),
    el('span', { class: 'fx-txt' },
      el('span', { class: 'fx-name' }, f.name),
      el('span', { class: 'fx-meta' }, plural(n, T.one, T.many), subs ? ` · ${plural(subs, 'subcarpeta', 'subcarpetas')}` : ''),
      parent ? el('span', { class: 'fx-meta' }, `en ${parent}`) : null),
    el('button', {
      class: 'fx-more', type: 'button', title: 'Opciones', 'aria-label': `Opciones de ${f.name}`,
      onclick: (e) => { e.stopPropagation(); folderMenu(e.currentTarget, f, { T }); }
    }, icon('ellipsis')));
  bindContext(item, (a) => folderMenu(a, f, { T }));
  dropTarget(item, f.id, T);
  makeDraggable(item, 'folder', f.id, T);
  return item;
}

/** Menú contextual de una nota en la lista (clic derecho / mantener pulsado) */
function noteListMenu(anchor, n) {
  if (n.trashed) {
    menu(anchor, [
      { icon: 'undo-2', label: 'Restaurar', onClick: () => restoreNote(n.id) },
      { icon: 'x', label: 'Eliminar definitivamente', danger: true, onClick: () => deleteForever(n.id) }
    ]);
    return;
  }
  menu(anchor, [
    { icon: 'file-text', label: 'Abrir', onClick: () => openNote(n.id, { push: true }) },
    { icon: 'folder-input', label: 'Mover a carpeta…', onClick: () => moveNote(n.id) },
    { icon: 'pin', label: n.pinned ? 'Quitar de fijadas' : 'Fijar', onClick: () => patch('notes', n.id, { pinned: !n.pinned }) },
    { icon: 'copy-plus', label: 'Duplicar', onClick: () => duplicateNote(n.id) },
    '-',
    { icon: 'trash-2', label: 'Mover a la papelera', danger: true, onClick: () => trashNote(n.id) }
  ]);
}

function noteCard(n, { search = S.search, sort = S.sort } = {}) {
  const path = n.folderId ? folderPath(n.folderId) : [];
  const card = el('button', {
      class: `note-card ${n.id === S.noteId ? 'active' : ''}`, type: 'button',
      onclick: () => { if (!longPressed(card)) openNote(n.id, { push: true }); }
    },
      el('div', { class: 't' }, n.pinned && !n.trashed ? icon('pin', 'pin-mark') : null, el('span', {}, n.title || 'Sin título')),
      el('div', { class: 's' }, snippetNode(n, search)),
      el('div', { class: 'm' },
        el('span', {}, shortDate(n.trashed ? n.trashedAt : (sort === 'created' ? n.createdAt : n.updatedAt))),
        path.length ? el('span', { class: 'f' }, `· ${path[path.length - 1].name}`) : null,
        (n.tags || []).slice(0, 3).map((t) => store.tags.get(t)).filter(Boolean).map((t) => el('span', { class: 'mini-tag' }, t.name)),
        refsCountOf(n) ? el('span', { class: 'refs-n' }, '· ', icon('book-marked'), ` ${refsCountOf(n)}`) : null));
  // En el móvil se mantiene pulsado para el menú; en ordenador/tablet se arrastra a una carpeta (y clic derecho = menú)
  bindContext(card, (a) => noteListMenu(a, n), { touch: !canDrag() });
  if (!n.trashed) makeDraggable(card, 'item', n.id);
  return card;
}

// ====================== Inicio ======================
const renderHomeSoon = debounce(() => { if (S.view.type === 'home') renderHome(); }, 80);

function renderHome() {
  const h = new Date().getHours();
  const saludo = h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
  const fecha = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#home-hello').textContent = `${saludo} · ${fecha}`;
  const counts = { notes: liveNotes().length, snippets: store.snippets.size };
  $('#home-modules').replaceChildren(...MODULES.map((m) => {
    const soon = m.status !== 'active';
    const n = m.count ? counts[m.count] : null;
    return el('button', {
      class: `mod-card ${soon ? 'soon' : ''}`, type: 'button', disabled: soon,
      'aria-label': soon ? `${m.name} (próximamente)` : m.name,
      dataset: { module: m.id },
      onclick: soon ? null : () => setView(parseHash(m.route).view)
    },
      el('span', { class: 'mod-ico' }, iconOr(m.icon)),
      el('span', { class: 'mod-txt' },
        el('span', { class: 'mod-name' }, m.name),
        el('span', { class: 'mod-desc' }, m.desc)),
      soon ? el('span', { class: 'mod-badge' }, 'Próximamente')
        : n ? el('span', { class: 'mod-count' }, n) : null);
  }));
  $('#home-backup').replaceChildren(backupReminder() || '');
  renderHomeNotes();
}

function renderHomeNotes() {
  const box = $('#home-notes');
  if (!store.loaded.notes) { box.replaceChildren(el('div', { class: 'list-empty' }, 'Cargando notas…')); return; }
  const list = liveNotes().sort(byUpdated).slice(0, 5);
  if (!list.length) {
    box.replaceChildren(el('div', { class: 'list-empty' }, 'Aún no hay notas. Toca ＋ y crea la primera.'));
    return;
  }
  box.replaceChildren(...list.map((n) => noteCard(n, { search: '', sort: 'updated' })));
}

// ====================== Notas ======================
function newNote() {
  saveSoon.flush();
  const id = newId('notes');
  const now = Date.now();
  const v = S.view;
  const data = {
    title: '',
    folderId: v.type === 'folder' ? v.id : null,
    tags: v.type === 'tag' ? [v.id] : [],
    pinned: v.type === 'pinned',
    trashed: false, trashedAt: null,
    createdAt: now, updatedAt: now
  };
  writeNote(id, data, { html: '', text: '', refs: [] }); // nota ligera + contenido vacío (visible al instante)
  if (v.type === 'trash' || !treeOf(v.type) || isSnipView(v.type)) {
    // Desde Inicio, Buscar, Prerredactados o la Papelera: la nota se crea en la raíz de Notas
    if (isSnipView(v.type)) closeSnippet({ fromHash: true });
    S.view = { type: 'notes', id: null };
    S.search = ''; $('#search').value = '';
    renderSection();
  }
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
  if (isSnipView()) { closeSnippet({ fromHash: true }); S.view = { type: 'all', id: null }; renderSidebar(); }
  if (!treeOf(S.view.type)) { S.view = { type: 'all', id: null }; renderSection(); renderSidebar(); } // desde Inicio o Buscar
  S.noteId = id;
  S.dirty = false;
  // Las notas nuevas (focusTitle) se abren en edición; el resto, según Ajustes (por defecto, lectura)
  S.reading = !focusTitle && openMode() === 'read';
  showPane('note');
  $('#ed-title').value = n.title || '';
  requestAnimationFrame(() => fitTitle($('#ed-title')));
  // El contenido está en noteBodies/{id}: al instante si ya está en el dispositivo; si no, se descarga (1 lectura).
  // Mientras tanto la nota no se puede editar ni se guarda nada (así nunca se sobrescribe con un contenido vacío).
  const b = bodyOf(id);
  const fresh = hasFreshBody(id);
  S.bodyReady = fresh;
  showBody(b, fresh ? '' : b ? 'Actualizando…' : 'Cargando…');
  $('#ed-scroll').scrollTop = 0;
  renderNoteChrome();
  renderList();
  if (!fromHash) pushHash(!push);
  if (focusTitle) $('#ed-title').focus();
  updateWakeLock();
  if (!fresh) {
    loadBody(id).then((body) => {
      if (S.noteId !== id) return;
      const changed = !b || body.html !== b.html;
      S.bodyReady = true;
      if (changed) showBody(body, ''); else setSaveStatus('');
      renderNoteChrome();
      if (S.dirty) saveSoon();
    }, () => {
      if (S.noteId !== id) return;
      if (b) { // sin conexión: se usa la copia del dispositivo (como antes con la caché de Firestore)
        S.bodyReady = true;
        setSaveStatus('Sin conexión · copia del dispositivo');
        renderNoteChrome();
      } else {
        setSaveStatus('');
        $('#content').dataset.placeholder = 'No se pudo cargar el contenido: sin conexión. Vuelve a abrir la nota cuando tengas internet.';
      }
    });
  }
}

/** Pinta el contenido de la nota abierta (o el aviso de carga si aún no está) */
function showBody(b, status) {
  const c = $('#content');
  c.dataset.placeholder = b ? 'Empieza a escribir…  Puedes pegar texto e imágenes.' : 'Cargando la nota…';
  editor.setContent(b ? b.html : '');
  S.loadedHtml = b ? b.html : '';
  renderToc();
  renderRefs();
  setSaveStatus(status);
}

function closeEditor({ fromHash = false } = {}) {
  saveSoon.flush();
  S.noteId = null;
  S.bodyReady = false;
  S.reading = false;
  showEditorEmpty();
  showList();
  if (!fromHash) pushHash(true);
  renderList();
}
function showEditorEmpty() { showPane('empty'); }

/** Panel derecho: 'note' (editor), 'snip' (prerredactado) o 'empty' */
function showPane(which) {
  $('#editor-wrap').classList.toggle('hidden', which !== 'note');
  $('#snip-wrap').classList.toggle('hidden', which !== 'snip');
  $('#editor-empty').classList.toggle('hidden', which !== 'empty');
  if (which !== 'note') editor?.hideFloating();
  if (which !== 'snip') snipEditor?.hideFloating();
  setTimeout(updateWakeLock);
  if (which !== 'empty') $('#app').dataset.view = 'editor';
  const snip = isSnipView();
  $('#btn-new-note-empty').textContent = snip ? '＋ Nuevo prerredactado' : '＋ Nueva nota';
  $('#editor-empty-msg').textContent = snip ? 'Selecciona un prerredactado o crea uno nuevo.' : 'Selecciona una nota o crea una nueva.';
}

function renderNoteChrome() {
  const n = store.notes.get(S.noteId);
  if (!n) return;
  const trashed = !!n.trashed;
  const reading = S.reading && !trashed;
  const ro = trashed || reading || !S.bodyReady;
  $('#editor-wrap').classList.toggle('readonly', ro);
  $('#editor-wrap').classList.toggle('reading', reading);
  setTimeout(updateWakeLock);
  editor.setReadOnly(ro);
  $('#ed-title').readOnly = ro;
  $('#ed-title').tabIndex = ro ? -1 : 0;
  const eb = $('#btn-edit');
  eb.classList.toggle('hidden', trashed);
  eb.classList.toggle('primary', !reading);
  eb.disabled = !S.bodyReady;
  eb.title = reading ? 'Editar la nota' : 'Terminar de editar (modo lectura)';
  eb.setAttribute('aria-label', eb.title);
  eb.querySelector('.ico').replaceChildren(icon(reading ? 'pencil' : 'check'));
  eb.querySelector('.lbl').textContent = reading ? 'Editar' : 'Listo';
  $('#trash-banner').classList.toggle('hidden', !trashed);
  $('#btn-pin').classList.toggle('on', !!n.pinned);
  $('#btn-pin').title = n.pinned ? 'Quitar de fijadas' : 'Fijar';
  const path = n.folderId ? folderPath(n.folderId) : [];
  $('#ed-folder').replaceChildren(icon('folder'), ` ${path.length ? path.map((f) => f.name).join(' › ') : 'Sin carpeta'}`);

  $('#tag-chips').replaceChildren(...(n.tags || []).map((tid) => store.tags.get(tid)).filter(Boolean).map((t) =>
    el('span', { class: 'chip', style: t.color ? { color: t.color } : {} },
      el('span', { role: 'button', style: { cursor: 'pointer' }, onclick: () => setView({ type: 'tag', id: t.id }) }, `#${t.name}`),
      el('button', { class: 'x', type: 'button', 'aria-label': `Quitar ${t.name}`, onclick: () => removeTagFromNote(t.id) }, '×'))));

  renderRefs();
  renderBacklinks();
  const words = n.words ?? deriveLight(bodyOf(n.id) || {}).words;
  $('#ed-meta').textContent = `Creada: ${longDate(n.createdAt)} · Modificada: ${longDate(n.updatedAt)} · ${words} palabras`;
}

// ---------- Modo lectura ----------
// Preferencias por dispositivo (localStorage): drfolio.noteMode = read|edit, drfolio.readSize = px, drfolio.wakeLock = on|off
const openMode = () => (localStorage.getItem('drfolio.noteMode') === 'edit' ? 'edit' : 'read');
const READ_SIZES = [15, 16, 17, 18, 20, 22, 24, 27, 30];
function readSize() {
  const i = READ_SIZES.indexOf(+localStorage.getItem('drfolio.readSize'));
  return i < 0 ? 3 : i; // por defecto 18 px
}
function setReadSize(i) {
  i = Math.max(0, Math.min(READ_SIZES.length - 1, i));
  localStorage.setItem('drfolio.readSize', String(READ_SIZES[i]));
  applyReadSize();
}
function applyReadSize() {
  const i = readSize();
  $('#editor').style.setProperty('--read-size', `${READ_SIZES[i]}px`); // notas y prerredactados
  ['#btn-font-down', '#snip-font-down'].forEach((b) => { $(b).disabled = i === 0; });
  ['#btn-font-up', '#snip-font-up'].forEach((b) => { $(b).disabled = i === READ_SIZES.length - 1; });
}

function setReading(on) {
  const n = store.notes.get(S.noteId);
  if (!n || n.trashed || (!on && !S.bodyReady)) return;
  if (on) {
    saveSoon.flush();
    document.activeElement?.blur?.();
    window.getSelection()?.removeAllRanges();
  }
  S.reading = on;
  renderNoteChrome();
  if (!on) { editor.focus(); }
  updateWakeLock();
}

async function copyOut(text, btn) {
  if (!text.trim()) { toast('No hay texto que copiar'); return; }
  const ok = await copyText(text);
  if (!ok) { toast('No se pudo copiar', 'error'); return; }
  toast('Copiado ✓', 'ok', 1600);
  if (btn) { btn.classList.add('done'); setTimeout(() => btn.classList.remove('done'), 1400); }
}

// Mantener la pantalla encendida mientras se lee (Wake Lock; si el navegador no lo permite, no pasa nada)
const wakeLockWanted = () => localStorage.getItem('drfolio.wakeLock') !== 'off';
let wakeLock = null;
let wakeBusy = false;
async function updateWakeLock() {
  // Editando (no en lectura): en el móvil se oculta la barra inferior, como Evernote (queda la barra de formato)
  const app = $('#app');
  const visible = app.dataset.view === 'editor' && !['home', 'search'].includes(app.dataset.section);
  const nOpen = !!S.noteId && !$('#editor-wrap').classList.contains('hidden') && !$('#editor-wrap').classList.contains('readonly');
  const sOpen = !!currentSnippet() && !isSnippetReading() && !$('#snip-wrap').classList.contains('hidden');
  app.classList.toggle('editing', visible && (nOpen || sOpen));
  const reading = (S.reading && !!S.noteId && !$('#editor-wrap').classList.contains('hidden')) ||
    (isSnippetReading() && !$('#snip-wrap').classList.contains('hidden'));
  const want = 'wakeLock' in navigator && wakeLockWanted() && reading && document.visibilityState === 'visible' &&
    !['home', 'search'].includes($('#app').dataset.section);
  if (want && !wakeLock && !wakeBusy) {
    wakeBusy = true;
    try {
      const w = await navigator.wakeLock.request('screen');
      w.addEventListener('release', () => { if (wakeLock === w) wakeLock = null; });
      wakeLock = w;
    } catch { wakeLock = null; }
    wakeBusy = false;
    if (wakeLock) updateWakeLock(); // por si cambió algo mientras se pedía
  } else if (!want && wakeLock) {
    const w = wakeLock; wakeLock = null;
    w.release().catch(() => {});
  }
}

// ---------- Guardado ----------
function setSaveStatus(t) { $('#save-status').textContent = t; }

const saveSoon = debounce(saveNow, 800);
function saveNow() {
  if (!S.noteId || !S.dirty || !S.bodyReady) return; // sin el contenido cargado no se guarda nunca
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
  const refs = bodyOf(n.id)?.refs || [];
  writeNote(n.id, { title, updatedAt: Date.now() }, { html, text, refs }); // nota ligera + contenido, en un mismo lote
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
// Índice automático (panel arriba en notas con 2+ títulos): opcional, por defecto no (Ajustes, drfolio.autoToc = on|off).
// El índice de la nota se añade o quita a mano: ⋯ → «Añadir índice» o botón ☰ de la barra.
const autoToc = () => localStorage.getItem('drfolio.autoToc') === 'on';
function toggleNoteToc() {
  const n = store.notes.get(S.noteId);
  if (!n || n.trashed || !S.bodyReady) return;
  const on = editor.toggleTocBlock();
  S.dirty = true;
  saveSoon.cancel();
  saveNow();
  renderToc();
  toast(on ? (editor.headings().length ? 'Índice añadido ✓' : 'Índice añadido: usa «Título 1/2/3» y se rellenará solo') : 'Índice quitado', 'ok', 2500);
}
function renderToc() {
  const hs = editor.headings();
  const toc = $('#toc');
  // Si la nota ya lleva su propio índice insertado, no duplicamos el panel superior
  if (!autoToc() || hs.length < 2 || editor.hasTocBlock()) { toc.classList.add('hidden'); return; }
  toc.classList.remove('hidden');
  $('#toc-list').replaceChildren(...hs.map((h, i) => el('a', {
    class: `l${h.tagName[1]}`, role: 'button', tabindex: '0',
    onclick: () => editor.scrollToHeading(i, { fromToc: true })
  }, h.textContent.replace(/\s+/g, ' ').trim())));
}

// ---------- Enlaces entre notas ----------
function renderBacklinks() {
  const id = S.noteId;
  const back = liveNotes().filter((n) => n.id !== id && (n.links ? n.links.includes(id) : (n.html || '').includes(`data-note="${id}"`)));
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
      { icon: 'undo-2', label: 'Restaurar', onClick: () => restoreNote(n.id) },
      { icon: 'x', label: 'Eliminar definitivamente', danger: true, onClick: () => deleteForever(n.id) }
    ]);
    return;
  }
  menu(anchor, [
    { icon: 'copy', label: 'Copiar nota entera', onClick: () => copyOut(editor.allText()) },
    S.bodyReady ? { icon: 'list', label: editor.hasTocBlock() ? 'Quitar índice' : 'Añadir índice', onClick: toggleNoteToc } : null,
    S.reading ? { icon: 'pencil', label: 'Editar', onClick: () => setReading(false) } : { icon: 'book-open', label: 'Modo lectura', onClick: () => setReading(true) },
    '-',
    { icon: 'folder-input', label: 'Mover a carpeta…', onClick: () => moveNote(n.id) },
    { icon: 'copy-plus', label: 'Duplicar', onClick: () => duplicateNote(n.id) },
    { icon: 'printer', label: 'Imprimir / guardar PDF', onClick: () => { saveSoon.flush(); window.print(); } },
    '-',
    { icon: 'trash-2', label: 'Mover a la papelera', danger: true, onClick: () => trashNote(n.id) }
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

async function duplicateNote(id) {
  saveSoon.flush();
  const n = store.notes.get(id);
  if (!n) return;
  let b;
  try { b = await loadBody(id); } catch { toast('Sin conexión: no se puede duplicar esta nota ahora', 'error'); return; }
  const nid = newId('notes');
  const now = Date.now();
  const data = { title: `${n.title || 'Sin título'} (copia)`, folderId: n.folderId || null, tags: [...(n.tags || [])], pinned: false,
    trashed: false, trashedAt: null, createdAt: now, updatedAt: now };
  writeNote(nid, data, { html: b.html, text: b.text, refs: b.refs });
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
  if (Array.isArray(n.files) && !isLegacy(n)) return new Set(n.files); // campo ligero (no hace falta el contenido)
  const ids = new Set();
  for (const m of (n.html || '').matchAll(/data-file="([^"]+)"/g)) ids.add(m[1]);
  for (const r of n.refs || []) if (r.fileId) ids.add(r.fileId);
  return ids;
}
const refsCountOf = (n) => n.refsCount ?? (n.refs || []).length;
/** Para borrar archivos hay que saber con seguridad qué usa cada nota y cada prerredactado */
const filesKnown = () => !!store.loaded.snippets && [...store.notes.values()].every((n) => isLegacy(n) || Array.isArray(n.files));
/** Archivos en uso por notas (papelera incluida) y prerredactados, salvo la nota / el prerredactado indicado */
function allReferencedFiles(exceptNoteId, exceptSnippetId = null) {
  const ids = new Set();
  for (const n of store.notes.values()) if (n.id !== exceptNoteId) noteFileIds(n).forEach((f) => ids.add(f));
  for (const s of store.snippets.values()) if (s.id !== exceptSnippetId) snippetFileIds(s).forEach((f) => ids.add(f));
  return ids;
}

/** Al eliminar un prerredactado: borra sus imágenes si ninguna nota ni otro prerredactado las usa */
function purgeSnippetFiles(id) {
  const s = store.snippets.get(id);
  if (!s || !filesKnown()) return;
  const mine = snippetFileIds(s);
  for (const f of store.files.values()) if (f.snippetId === id) mine.add(f.id);
  const others = allReferencedFiles(null, id);
  for (const f of mine) if (!others.has(f) && store.files.has(f)) deleteFile(f);
}

function purgeNote(id) {
  const n = store.notes.get(id);
  if (!n) return;
  const others = allReferencedFiles(id);
  const mine = noteFileIds(n);
  for (const f of store.files.values()) if (f.noteId === id) mine.add(f.id);
  if (filesKnown()) for (const f of mine) if (!others.has(f)) deleteFile(f);
  deleteNoteDocs(id); // nota + contenido
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
/** owner: { noteId } (por defecto, la nota abierta) o { snippetId } (prerredactado) */
async function uploadImages(files, owner = { noteId: S.noteId }) {
  const out = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const blob = await compressImage(f);
    const id = await saveFile(blob, { ...owner, name: f.name || 'imagen', kind: 'image' });
    out.push({ id, url: await fileUrl(id) });
  }
  if (!out.length) throw new Error('No se encontraron imágenes');
  return out;
}

// ---------- Bibliografía ----------
/** Bibliografía de la nota abierta (está en su contenido) */
const curRefs = () => bodyOf(S.noteId)?.refs || [];
function renderRefs() {
  const n = store.notes.get(S.noteId);
  if (!n) return;
  const refs = S.bodyReady || bodyOf(n.id) ? curRefs() : [];
  $('#btn-add-ref').disabled = !S.bodyReady;
  $('#ref-empty').classList.toggle('hidden', refs.length > 0);
  $('#ref-list').replaceChildren(...refs.map((r) => {
    const fileMeta = r.fileId ? store.files.get(r.fileId) : null;
    return el('li', {},
      el('div', { class: 'ref-row' },
        el('div', { class: 'ref-main' },
          el('div', { class: 'ref-cite' }, r.cite || r.fileName || r.url || 'Referencia'),
          el('div', { class: 'ref-links' },
            r.url ? el('a', { class: 'ref-chip', href: r.url, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), ` ${prettyUrl(r.url)}`) : null,
            r.fileId ? el('button', {
              class: 'ref-chip', type: 'button',
              onclick: () => openViewer({ fileId: r.fileId, name: r.fileName, kind: 'file', mime: fileMeta?.mime })
            }, icon('file-text'), ` ${r.fileName || 'archivo'}${r.fileSize ? ` · ${formatBytes(r.fileSize)}` : ''}${fileMeta ? '' : ' (subiendo…)'}`) : null)),
        el('button', { class: 'more', type: 'button', 'aria-label': 'Opciones', onclick: (e) => refMenu(e.currentTarget, r) }, icon('ellipsis'))));
  }));
}

function prettyUrl(u) {
  try { const x = new URL(u); return (x.hostname + x.pathname).replace(/\/$/, '').slice(0, 60); } catch { return u.slice(0, 60); }
}

function refMenu(anchor, r) {
  const n = store.notes.get(S.noteId);
  if (!n || n.trashed || !S.bodyReady) return;
  const refs = curRefs();
  const i = refs.findIndex((x) => x.id === r.id);
  menu(anchor, [
    { icon: 'pencil', label: 'Editar', onClick: () => editRef(r) },
    i > 0 ? { icon: 'arrow-up', label: 'Subir', onClick: () => moveRef(i, -1) } : null,
    i < refs.length - 1 ? { icon: 'arrow-down', label: 'Bajar', onClick: () => moveRef(i, 1) } : null,
    '-',
    { icon: 'trash-2', label: 'Quitar referencia', danger: true, onClick: async () => {
      if (!await confirm('Quitar referencia', r.fileId ? 'Se quitará la referencia y su archivo adjunto.' : '¿Quitar esta referencia?', { okLabel: 'Quitar', danger: true })) return;
      setRefs(curRefs().filter((x) => x.id !== r.id));
      if (r.fileId && filesKnown() && !allReferencedFiles(n.id).has(r.fileId) && !noteFileIds(n).has(r.fileId)) deleteFile(r.fileId);
    } }
  ].filter(Boolean));
}

function moveRef(i, d) {
  const refs = [...curRefs()];
  [refs[i], refs[i + d]] = [refs[i + d], refs[i]];
  setRefs(refs);
}

/** Cambia la bibliografía de la nota abierta: se guarda con su contenido (y el recuento en la nota ligera) */
function setRefs(refs) {
  const n = store.notes.get(S.noteId);
  if (!n || !S.bodyReady) return;
  saveSoon.flush(); // primero lo que estés escribiendo
  const b = bodyOf(n.id) || { html: S.loadedHtml || '', text: '' };
  writeNote(n.id, { updatedAt: Date.now() }, { html: b.html, text: b.text, refs });
  renderRefs();
  renderNoteChrome();
}

let pendingRefFile = null;

async function editRef(existing) {
  const n = store.notes.get(S.noteId);
  if (!n || n.trashed || !S.bodyReady) return;
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
      if (oldFile && filesKnown() && !allReferencedFiles(n.id).has(oldFile) && !(bodyOf(n.id)?.html || '').includes(`data-file="${oldFile}"`)) deleteFile(oldFile);
    } catch (e) { toast(e.message, 'error'); return; }
  }
  if (S.noteId !== n.id) return;
  const refs = [...curRefs()];
  const i = refs.findIndex((x) => x.id === r.id);
  if (i >= 0) refs[i] = r; else refs.push(r);
  setRefs(refs);
}

async function addAttachment(f) {
  const n = store.notes.get(S.noteId);
  if (!n || n.trashed || !S.bodyReady) return;
  try {
    const fileId = await saveFile(f, { noteId: n.id, name: f.name, kind: 'file' });
    if (S.noteId !== n.id) return;
    setRefs([...curRefs(), { id: newId('notes'), cite: f.name.replace(/\.[^.]+$/, ''), url: null, fileId, fileName: f.name, fileSize: f.size }]);
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
  const fileName = name || meta?.name || 'archivo';
  const openTab = () => { window.open(url, '_blank'); return false; };
  const save = async () => {
    const blob = fileId ? await fileBlob(fileId) : await (await fetch(url)).blob();
    download(fileName, blob);
    return false;
  };
  if (isPdf) { openPdfViewer({ url, name: name || meta?.name || 'PDF', onOpenTab: openTab, onDownload: save }); return; }
  const body = isImg
    ? el('div', { class: 'viewer-img' }, el('img', { src: url, alt: name || '' }))
    : el('p', {}, 'Este tipo de archivo no se puede previsualizar. Descárgalo para abrirlo.');
  modal({
    title: name || meta?.name || 'Archivo',
    wide: isImg,
    body,
    actions: [
      { label: '↗ Abrir en pestaña', onClick: openTab },
      { label: '⬇ Descargar', onClick: save },
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
  let closeSettings = null;
  modal({
    title: 'Ajustes',
    body: [
      el('div', { class: 'settings-row' }, el('span', {}, 'Cuenta'), el('b', {}, auth.currentUser?.email || '')),
      el('div', { class: 'settings-row' }, el('span', {}, 'Este dispositivo'),
        el('span', {}, publicMode ? '🟠 Ordenador público (sin copia offline)' : '🟢 De confianza (funciona sin conexión)')),
      publicMode ? el('div', { class: 'settings-row' }, el('span', {}, 'Cerrar sesión por inactividad'), idleSel) : null,
      el('div', { class: 'settings-row' }, el('span', {}, 'Abrir notas en', el('br'), el('span', { class: 'muted small' }, 'Solo en este dispositivo')),
        el('select', { onchange: (e) => { localStorage.setItem('drfolio.noteMode', e.target.value); toast('Guardado', 'ok'); } },
          el('option', { value: 'read', selected: openMode() === 'read' }, '📖 Lectura'),
          el('option', { value: 'edit', selected: openMode() === 'edit' }, '✏️ Edición'))),
      el('div', { class: 'settings-row' }, el('span', {}, 'Índice automático en notas con títulos',
        el('br'), el('span', { class: 'muted small' }, 'Si no, añádelo cuando quieras: ⋯ → «Añadir índice»')),
        el('select', { onchange: (e) => { localStorage.setItem('drfolio.autoToc', e.target.value); if (S.noteId) renderToc(); toast('Guardado', 'ok'); } },
          el('option', { value: 'off', selected: !autoToc() }, 'No'),
          el('option', { value: 'on', selected: autoToc() }, 'Sí'))),
      el('div', { class: 'settings-row' }, el('span', {}, 'Pantalla encendida al leer una nota',
        el('br'), el('span', { class: 'muted small' }, 'wakeLock' in navigator ? 'Solo en este dispositivo' : 'Este navegador no lo permite')),
        el('select', { disabled: !('wakeLock' in navigator), onchange: (e) => { localStorage.setItem('drfolio.wakeLock', e.target.value); updateWakeLock(); toast('Guardado', 'ok'); } },
          el('option', { value: 'on', selected: wakeLockWanted() }, 'Sí'),
          el('option', { value: 'off', selected: !wakeLockWanted() }, 'No'))),
      el('div', {},
        el('div', { class: 'settings-row', style: { borderBottom: 0 } }, el('span', {}, 'Espacio usado'),
          el('span', {}, `${formatBytes(used)} de 1 GB · ${live} notas · ${store.snippets.size} prerredactados · ${store.files.size} archivos`)),
        el('div', { class: 'meter' }, el('div', { style: { width: `${pct.toFixed(1)}%` } }))),
      el('div', { class: 'settings-row' }, el('span', {}, 'Copia de seguridad',
        publicMode ? [el('br'), el('span', { class: 'muted small' }, backupPublicReason)] : null),
        publicMode ? el('span', { class: 'muted' }, '🔒 No disponible')
          : el('button', { class: 'btn sm', type: 'button', onclick: () => { closeSettings?.(); openBackup(); } }, 'Exportar / Restaurar…')),
      el('div', { class: 'settings-row' }, el('span', {}, 'Archivos sin usar'),
        el('button', { class: 'btn sm', type: 'button', onclick: cleanOrphans }, 'Limpiar')),
      el('div', { class: 'settings-row' }, el('span', { class: 'muted small' }, `Dr.Folio v${APP_VERSION}`),
        el('button', { class: 'btn sm primary danger', type: 'button', onclick: () => doLogout() }, 'Cerrar sesión'))
    ],
    actions: [{ label: 'Cerrar', primary: true }],
    onOpen: (_, c) => { closeSettings = c; }
  });
}

async function cleanOrphans() {
  if (!filesKnown()) { toast('Espera a que termine la actualización de las notas y vuelve a intentarlo', 'error', 4500); return; }
  const used = allReferencedFiles(null);
  const old = Date.now() - 10 * 60 * 1000;
  const orphans = [...store.files.values()].filter((f) => !used.has(f.id) && (f.createdAt || 0) < old);
  if (!orphans.length) { toast('No hay archivos sin usar', 'ok'); return; }
  const size = orphans.reduce((s, f) => s + (f.size || 0), 0);
  if (!await confirm('Limpiar archivos', `Hay ${orphans.length} archivo(s) que ya no usa ninguna nota ni prerredactado (${formatBytes(size)}). ¿Borrarlos?`, { okLabel: 'Borrar', danger: true })) return;
  orphans.forEach((f) => deleteFile(f.id));
  toast('Archivos borrados', 'ok');
}

async function doLogout(reason) {
  if (S.loggingOut) return;
  S.loggingOut = true;
  saveSoon.flush();
  flushSnippet();
  stopSync();
  revokeAll();
  await clearBodies(); // copia local del contenido de las notas
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
