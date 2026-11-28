// Chat personal (v1.19.0): bandeja TEMPORAL para pasarse textos, enlaces, fotos y documentos entre dispositivos
// (p. ej. del ordenador del hospital al móvil), como «Notas para mí» de WhatsApp o Telegram.
//
//   chat/{id}      { text, files:[fileId], pinned, device:'phone'|'desktop'|'public', devId, createdAt, editedAt }
//   files/{id}     con chatId mientras el archivo dependa del chat (al convertirlo en nota/prerredactado pasa a noteId/snippetId)
//   settings/chat  { ttlDays: 7|30|90|0 (0 = nunca), updatedAt }  → común a todos los dispositivos
//
// Lecturas: solo se escuchan en tiempo real los últimos PAGE mensajes y los fijados. Los anteriores se cargan al subir
// (una consulta por página, sin tiempo real). Caducidad: los no fijados se borran (con sus archivos) al abrir la app,
// por lotes y respetando el límite diario (budget/addQuota de backup.js). En «Ordenador público» no se limpia.
import { query, orderBy, limit, startAfter, where, onSnapshot, getDocs, writeBatch, doc, collection, deleteField, documentId } from '../vendor/libs.js';
import { db, getMode } from './db.js';
import { store, col, ref, newId, put, patch } from './store.js';
import { compressImage, saveFile, fileUrl, fileBlob } from './files.js';
import { budget, addQuota } from './backup.js';
import { writeNote } from './bodies.js';
import { sanitize, escapeHtml } from './editor.js';
import { bodyHash } from './snipbody.js';
import { el, $, debounce, norm, formatBytes, download, nodesToPlain } from './util.js';
import { toast, modal, confirm, menu, picker } from './ui.js';
import { icon } from './icons.js';
import { copyText } from './snippets.js';
import { LIMITS } from './config.js';

const PAGE = 200;
const DAY = 86400000;
export const TTL_OPTIONS = [[7, '7 días'], [30, '30 días'], [90, '90 días'], [0, 'Nunca']];
export const DEVICES = { phone: ['smartphone', 'Móvil'], desktop: ['monitor', 'Ordenador'], public: ['lock', 'Ordenador público'] };

const live = new Map();   // últimos PAGE (tiempo real)
const pins = new Map();   // fijados (tiempo real)
const older = new Map();  // anteriores, cargados al subir (sin tiempo real)
const pending = new Set(); // mensajes con cambios aún sin subir (sin conexión)
const gone = new Set();   // borrados aquí (para no confundirlos con los que salen de la ventana de PAGE)
let unsubs = [];
let liveLoaded = false, liveFromCache = true;
let moreOlder = null;     // ¿hay mensajes anteriores sin cargar? (null = aún no se sabe)
let everything = false;   // se han cargado todos
let loadingOlder = false;
let ctx = {};

// ---------- Dispositivo ----------
const devStore = () => (getMode() === 'public' ? sessionStorage : localStorage); // en público no queda nada en el equipo
export function myDev() {
  const s = devStore();
  let id = s.getItem('drfolio.devId');
  if (!id) { id = Math.random().toString(36).slice(2, 10); s.setItem('drfolio.devId', id); }
  return id;
}
export function deviceKind() {
  if (getMode() === 'public') return 'public';
  return matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820 ? 'phone' : 'desktop';
}
const seenAt = () => Number(devStore().getItem('drfolio.chatSeen')) || 0;
function markSeen() {
  const last = Math.max(0, ...messages().map((m) => m.createdAt || 0));
  if (last > seenAt()) { devStore().setItem('drfolio.chatSeen', String(last)); ctx.onChange?.(); }
}
/** Mensajes nuevos: enviados desde otro dispositivo después de la última vez que se abrió el chat aquí */
export function unreadCount() {
  const seen = seenAt();
  let n = 0;
  for (const m of live.values()) if ((m.createdAt || 0) > seen && m.devId !== myDev()) n++;
  return n;
}

// ---------- Caducidad ----------
export function ttlDays() {
  const v = Number(store.settings?.get('chat')?.ttlDays);
  return TTL_OPTIONS.some(([d]) => d === v) ? v : 30;
}
export function setTtl(days) { put('settings', 'chat', { ttlDays: days, updatedAt: Date.now() }); }
const expiresAt = (m) => (!m.pinned && ttlDays() ? (m.createdAt || 0) + ttlDays() * DAY : null);

// ---------- Datos ----------
/** Todos los mensajes cargados, del más antiguo al más reciente */
export function messages() {
  const all = new Map(older);
  for (const m of live.values()) all.set(m.id, m);
  for (const m of pins.values()) all.set(m.id, m);
  return [...all.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
export const chatReady = () => liveLoaded;
const getMsg = (id) => live.get(id) || pins.get(id) || older.get(id) || null;
const fileMeta = (fid) => store.files.get(fid) || null;
const fileNames = (m) => (m.files || []).map((f) => fileMeta(f)?.name || '').join(' ');

function applySnap(map, snap, isLive) {
  const fromServer = !snap.metadata.fromCache;
  let oldest = Infinity;
  for (const d of snap.docs) oldest = Math.min(oldest, d.data().createdAt || 0);
  for (const ch of snap.docChanges()) {
    const id = ch.doc.id;
    if (fromServer && !ch.doc.metadata.hasPendingWrites && ch.type !== 'removed') store.stats.reads.chat = (store.stats.reads.chat || 0) + 1;
    if (ch.type === 'removed') {
      const m = map.get(id);
      map.delete(id);
      // Sale de la ventana de los últimos PAGE (no se ha borrado): pasa a «anteriores»
      if (isLive && m && !gone.has(id) && snap.size >= PAGE && (m.createdAt || 0) <= oldest) { older.set(id, m); moreOlder = true; }
    } else {
      map.set(id, { id, ...ch.doc.data() });
      older.delete(id);
    }
  }
  for (const d of snap.docs) { if (d.metadata.hasPendingWrites) pending.add(d.id); else pending.delete(d.id); }
}

export function startChat(appCtx) {
  ctx = appCtx;
  stopChat();
  const onErr = (e) => console.error('chat', e);
  unsubs.push(onSnapshot(query(col('chat'), orderBy('createdAt', 'desc'), limit(PAGE)), { includeMetadataChanges: true }, (snap) => {
    applySnap(live, snap, true);
    liveLoaded = true;
    liveFromCache = snap.metadata.fromCache;
    if (!liveFromCache && moreOlder === null) moreOlder = snap.size >= PAGE;
    changed();
    if (!liveFromCache) cleanupSoon();
  }, onErr));
  unsubs.push(onSnapshot(query(col('chat'), where('pinned', '==', true)), { includeMetadataChanges: true }, (snap) => {
    applySnap(pins, snap, false);
    changed();
  }, onErr));
  initView();
}
export function stopChat() { unsubs.forEach((u) => u()); unsubs = []; }

/** Carga la página anterior de mensajes (al subir). Devuelve cuántos llegaron. */
async function loadOlder() {
  if (loadingOlder || moreOlder === false || everything) return 0;
  // Desde el más antiguo de la ventana (los fijados pueden ser mucho más antiguos: no cuentan)
  let oldest = Infinity;
  for (const m of [...live.values(), ...older.values()]) oldest = Math.min(oldest, m.createdAt || 0);
  if (oldest === Infinity) return 0;
  loadingOlder = true;
  try {
    const snap = await getDocs(query(col('chat'), orderBy('createdAt', 'desc'), startAfter(oldest), limit(PAGE)));
    if (!snap.metadata.fromCache) store.stats.reads.chat = (store.stats.reads.chat || 0) + Math.max(1, snap.size);
    for (const d of snap.docs) if (!live.has(d.id) && !pins.has(d.id)) older.set(d.id, { id: d.id, ...d.data() });
    if (!snap.metadata.fromCache) moreOlder = snap.size >= PAGE;
    return snap.size;
  } catch (e) { console.warn('chat older', e); return 0; } finally { loadingOlder = false; }
}

/** Todos los mensajes del chat (copia de seguridad, búsqueda en todo, limpiar archivos). Necesita conexión. */
export async function fetchAllChat() {
  const snap = await getDocs(col('chat'));
  if (snap.metadata.fromCache) throw new Error('Sin conexión: no se pudo leer el chat');
  store.stats.reads.chat = (store.stats.reads.chat || 0) + Math.max(1, snap.size);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function loadEverything() {
  const all = await fetchAllChat();
  for (const m of all) if (!live.has(m.id) && !pins.has(m.id)) older.set(m.id, m);
  everything = true; moreOlder = false;
}

/** Archivos que usan los mensajes cargados (para no borrarlos al eliminar una nota, etc.) */
export function chatFileIds() {
  const ids = new Set();
  for (const m of messages()) (m.files || []).forEach((f) => ids.add(f));
  return ids;
}
/** Archivos de files/ con chatId cuyo mensaje sigue existiendo (consulta los que no estén cargados). Para «Limpiar». */
export async function chatFilesInUse() {
  const inUse = chatFileIds();
  const unknown = new Set();
  for (const f of store.files.values()) if (f.chatId && !inUse.has(f.id) && !getMsg(f.chatId)) unknown.add(f.chatId);
  const ids = [...unknown];
  for (let i = 0; i < ids.length; i += 30) {
    const snap = await getDocs(query(col('chat'), where(documentId(), 'in', ids.slice(i, i + 30))));
    if (snap.metadata.fromCache) throw new Error('Sin conexión');
    for (const d of snap.docs) (d.data().files || []).forEach((f) => inUse.add(f));
  }
  return inUse;
}

// Cambios en un mensaje: se reflejan al instante en las copias cargadas
function localPatch(id, data) {
  for (const map of [live, pins, older]) { const m = map.get(id); if (m) Object.assign(m, data); }
  if (data.pinned === true) { const m = getMsg(id); if (m) pins.set(id, m); }
  if (data.pinned === false) pins.delete(id);
  pending.add(id);
  changed();
}
function patchMsg(id, data) { localPatch(id, data); patch('chat', id, data); }

// ---------- Enviar ----------
const isImage = (f) => /^image\//.test(f.type || '');
async function storeFile(f, chatId) {
  if (isImage(f)) {
    try {
      const blob = await compressImage(f);
      return await saveFile(blob, { chatId, name: f.name || 'imagen', kind: 'image' });
    } catch (e) { if (/supera/.test(e.message)) throw e; /* formato que no se puede abrir (p. ej. HEIC): se guarda tal cual */ }
  }
  return saveFile(f, { chatId, name: f.name || 'archivo', kind: isImage(f) ? 'image' : 'file' });
}

export async function sendMessage(text, files = []) {
  text = String(text || '').replace(/^\s*\n/, '').replace(/\s+$/, '');
  if (!text.trim() && !files.length) return false;
  const id = newId('chat');
  const ids = [];
  for (const f of files) {
    try { ids.push(await storeFile(f, id)); } catch (e) { toast(`${f.name || 'Archivo'}: ${e.message}`, 'error', 5000); }
  }
  if (!text.trim() && !ids.length) return false;
  const data = { text: text.trim() ? text : '', files: ids, pinned: false, device: deviceKind(), devId: myDev(), createdAt: Date.now(), editedAt: null };
  live.set(id, { id, ...data });
  pending.add(id);
  put('chat', id, data);
  changed({ bottom: true });
  markSeen();
  return true;
}

// ---------- Borrar (a mano o por caducidad) ----------
/**
 * Borra mensajes y los archivos que solo dependen de ellos (files.chatId = el mensaje y nadie más los usa).
 * Lotes ≤ 450 operaciones; se para si se acaba el margen del día. Devuelve { done, stopped }.
 */
async function deleteMessages(list, { wait = true } = {}) {
  const others = ctx.filesKnown?.() ? ctx.otherFileRefs() : null; // sin saberlo con seguridad, los archivos se quedan
  const left = budget();
  let batch = null, n = 0, done = 0;
  // Sin esperar (borrado a mano): se aplica al instante en local y se sube solo al volver la conexión
  const commit = async () => {
    if (!n) return;
    const p = batch.commit();
    addQuota(0, n); left.d -= n; batch = null; n = 0;
    if (wait) await p; else p.catch((e) => toast(`No se pudo borrar: ${e.message}`, 'error'));
  };
  for (const m of list) {
    const ops = [];
    if (others) {
      for (const fid of m.files || []) {
        const f = fileMeta(fid);
        if (!f || f.chatId !== m.id || others.has(fid)) continue;
        const chunks = collection(db, 'users', store.uid, 'files', fid, 'chunks');
        for (let i = 0; i < (f.chunks || 0); i++) ops.push(doc(chunks, String(i).padStart(3, '0')));
        ops.push(ref('files', fid));
      }
    }
    ops.push(ref('chat', m.id));
    if (ops.length + n > left.d) { await commit(); if (ops.length > left.d) return { done, stopped: true }; }
    for (const r of ops) {
      if (batch && n >= 450) await commit();
      if (!batch) batch = writeBatch(db);
      batch.delete(r); n++;
    }
    gone.add(m.id);
    for (const map of [live, pins, older]) map.delete(m.id);
    done++;
  }
  await commit();
  changed();
  return { done, stopped: false };
}

async function removeMessage(m) {
  if (!await confirm('Eliminar mensaje', (m.files || []).length ? 'Se borrarán el mensaje y sus archivos (los que hayas pasado a una nota o prerredactado se quedan).' : '¿Eliminar este mensaje?', { okLabel: 'Eliminar', danger: true })) return;
  try {
    const r = await deleteMessages([m], { wait: false });
    if (r.stopped) toast('Límite diario de borrados alcanzado: inténtalo mañana', 'error', 5000);
  } catch (e) { toast(`No se pudo eliminar: ${e.message}`, 'error'); }
}

let cleaning = false;
const CLEAN_KEY = 'drfolio.chatClean';
/** Limpieza de caducados: al abrir la app, con conexión, datos del servidor y como mucho cada 6 h por dispositivo */
export async function cleanupChat({ force = false } = {}) {
  if (cleaning || getMode() === 'public' || !navigator.onLine || liveFromCache) return null;
  if (!store.loaded.settings || store.fromCache.settings || !store.loaded.files) return null;
  const ttl = ttlDays();
  if (!ttl) return null;
  if (!force && Date.now() - (Number(localStorage.getItem(CLEAN_KEY)) || 0) < 6 * 3600000) return null;
  cleaning = true;
  let removed = 0, stopped = false;
  try {
    const cut = Date.now() - ttl * DAY;
    let after = null;
    for (let round = 0; round < 50 && !stopped; round++) {
      const q = after ? query(col('chat'), where('createdAt', '<', cut), orderBy('createdAt'), startAfter(after), limit(100))
        : query(col('chat'), where('createdAt', '<', cut), orderBy('createdAt'), limit(100));
      const snap = await getDocs(q);
      if (snap.metadata.fromCache || !snap.size) break;
      store.stats.reads.chat = (store.stats.reads.chat || 0) + snap.size;
      after = snap.docs[snap.docs.length - 1];
      const victims = snap.docs.map((x) => ({ id: x.id, ...x.data() })).filter((m) => !m.pinned);
      if (victims.length) { const r = await deleteMessages(victims); removed += r.done; stopped = r.stopped; }
      if (snap.size < 100) break;
    }
    if (!stopped) localStorage.setItem(CLEAN_KEY, String(Date.now()));
  } catch (e) { console.warn('chat cleanup', e); } finally { cleaning = false; }
  return { removed, stopped };
}
const cleanupSoon = debounce(() => cleanupChat(), 4000);
export const settingsChanged = () => { changed(); cleanupSoon(); };

// ---------- Convertir en nota / prerredactado ----------
const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]|\bwww\.[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;
const hrefOf = (u) => (/^www\./i.test(u) ? `https://${u}` : u);
function linkedHtml(line) {
  let out = '', last = 0;
  for (const m of line.matchAll(URL_RE)) {
    out += escapeHtml(line.slice(last, m.index)) + `<a href="${escapeHtml(hrefOf(m[0]))}">${escapeHtml(m[0])}</a>`;
    last = m.index + m[0].length;
  }
  return out + escapeHtml(line.slice(last));
}
function contentOf(m, { images = true, files = true } = {}) {
  const lines = String(m.text || '').split('\n');
  const parts = m.text ? lines.map((l) => (l ? `<p>${linkedHtml(l)}</p>` : '<p><br></p>')) : [];
  const imgs = [], others = [];
  for (const fid of m.files || []) { const f = fileMeta(fid); if (!f) continue; (f.kind === 'image' || /^image\//.test(f.mime || '') ? imgs : others).push(f); }
  if (images) for (const f of imgs) parts.push(`<p><img data-file="${escapeHtml(f.id)}" alt=""></p>`);
  const refs = files ? others.map((f) => ({ id: newId('notes'), cite: (f.name || 'Archivo').replace(/\.[^.]+$/, ''), url: null, fileId: f.id, fileName: f.name || 'archivo', fileSize: f.size || 0 })) : [];
  const html = sanitize(parts.join(''));
  const plain = nodesToPlain([...new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstChild.childNodes]);
  return { html, text: plain, refs, imgs, others };
}
const titleOf = (m) => {
  const first = String(m.text || '').split('\n').find((l) => l.trim()) || '';
  return (first.trim() || fileMeta((m.files || [])[0])?.name || 'Del chat').slice(0, 120);
};
/** Los archivos dejan de depender del chat: así no se borran al caducar el mensaje */
const adopt = (files, owner) => files.forEach((f) => patch('files', f.id, { chatId: deleteField(), ...owner }));

function toNewNote(m) {
  const c = contentOf(m);
  const id = newId('notes');
  const now = Date.now();
  writeNote(id, { title: titleOf(m), folderId: null, tags: [], pinned: false, trashed: false, trashedAt: null, createdAt: now, updatedAt: now },
    { html: c.html, text: c.text, refs: c.refs });
  adopt([...c.imgs, ...c.others], { noteId: id });
  toast('Nota creada en «Notas» ✓', 'ok');
  ctx.openNote(id);
}

async function toExistingNote(m) {
  const id = await ctx.pickNote('Añadir al final de la nota…');
  if (!id) return;
  const c = contentOf(m);
  try {
    await ctx.appendToNote(id, c);
    adopt([...c.imgs, ...c.others], { noteId: id });
    const t = store.notes.get(id)?.title || 'Sin título';
    toast(`Añadido al final de «${t}» ✓`, 'ok', 3500);
  } catch (e) { toast(e.message === 'offline' ? 'Sin conexión: no se pudo abrir esa nota' : `No se pudo añadir: ${e.message}`, 'error'); }
}

function toSnippet(m) {
  const c = contentOf(m, { files: false });
  const id = newId('snippets');
  const now = Date.now();
  const data = { title: titleOf(m), body: c.text, html: c.html, bh: bodyHash(c.text), category: '', folderId: null, favorite: false, order: now, uses: 0, lastUsedAt: null, createdAt: now, updatedAt: now };
  store.snippets.set(id, { id, ...data });
  put('snippets', id, data);
  adopt(c.imgs, { snippetId: id });
  if (c.others.length) toast('Los PDF y archivos no caben en un prerredactado: siguen en el chat', 'error', 5000);
  else toast('Prerredactado creado ✓', 'ok');
  ctx.openSnippet(id);
}

// ---------- Editar ----------
async function editMessage(m) {
  const ta = el('textarea', { rows: 8, class: 'chat-edit' });
  ta.value = m.text || '';
  const ok = await modal({ title: 'Editar mensaje', body: ta, actions: [{ label: 'Cancelar' }, { label: 'Guardar', primary: true, value: true }] });
  if (!ok) return;
  const text = ta.value.replace(/\s+$/, '');
  if (text === (m.text || '')) return;
  if (!text.trim() && !(m.files || []).length) { removeMessage(m); return; }
  patchMsg(m.id, { text, editedAt: Date.now() });
}

// ====================== Vista ======================
const V = {
  q: '',              // búsqueda dentro del chat
  searchOpen: false,
  staged: [],         // archivos preparados para enviar: [{file, url}]
  sending: false,
  focusId: null,      // mensaje a resaltar (desde Buscar)
  first: true         // primera vez que se pinta (abajo del todo)
};
const nodes = new Map(); // id → { key, node } (se reutilizan: las imágenes no parpadean)
const thumbs = new Map(); // fileId → { url, ratio }
let imgIO = null, topIO = null;
const desktop = () => matchMedia('(pointer: fine)').matches && !matchMedia('(pointer: coarse)').matches;
const filter = () => ctx.chatFilter?.() || null; // 'pins' = solo fijados
export const chatVisible = () => document.querySelector('#app')?.dataset.section === 'chat' && document.visibilityState === 'visible';

function changed({ bottom = false } = {}) {
  if (bottom) V.forceBottom = true;
  renderSoon();
  ctx.onChange?.();
}
const renderSoon = debounce(() => { if (chatVisible() || V.forceBottom) render(); else V.stale = true; }, 50);

function initView() {
  if (V.ready) return;
  V.ready = true;
  const input = $('#chat-input');
  const fit = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight + 2, Math.max(120, window.innerHeight * 0.4))}px`; };
  input.addEventListener('input', () => { fit(); updateSend(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && desktop()) { e.preventDefault(); submit(); }
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); stage(files); }
  });
  $('#chat-form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  $('#chat-attach').addEventListener('click', () => $('#chat-file').click());
  $('#chat-file').addEventListener('change', (e) => { const fs = [...e.target.files]; e.target.value = ''; stage(fs); });
  // Arrastrar archivos encima del chat
  const sec = $('#chat');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  sec.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); sec.classList.add('drop-over'); });
  sec.addEventListener('dragleave', (e) => { if (!sec.contains(e.relatedTarget)) sec.classList.remove('drop-over'); });
  sec.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); sec.classList.remove('drop-over'); stage([...e.dataTransfer.files]); });
  // Buscar dentro del chat
  $('#chat-search-btn').addEventListener('click', () => toggleSearch());
  $('#chat-search').addEventListener('input', debounce(() => { V.q = $('#chat-search').value; V.forceBottom = true; render(); }, 120));
  $('#chat-search').addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleSearch(false); if (e.key === 'Enter') { e.preventDefault(); $('#chat-search').blur(); } });
  $('#chat-menu').addEventListener('click', (e) => chatMenu(e.currentTarget));
  $('#chat-pins').addEventListener('click', () => ctx.openPins());
  $('#chat-back').addEventListener('click', () => history.back());
  $('#chat-down').addEventListener('click', () => scrollBottom(true));
  const sc = $('#chat-scroll');
  sc.addEventListener('scroll', () => { $('#chat-down').classList.toggle('hidden', atBottom()); }, { passive: true });
  // Teclado o barra que cambia el alto: si estabas abajo, sigues abajo
  // (también cuando una imagen termina de cargar y crece el contenido)
  V.wasBottom = true;
  sc.addEventListener('scroll', () => { V.wasBottom = atBottom(); }, { passive: true });
  const ro = new ResizeObserver(() => { if (V.wasBottom && !V.focusId) sc.scrollTop = sc.scrollHeight; });
  ro.observe(sc); ro.observe($('#chat-list'));
  imgIO = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { imgIO.unobserve(en.target); loadThumb(en.target); } }), { root: sc, rootMargin: '400px 0px' });
  topIO = new IntersectionObserver((ents) => { if (ents.some((en) => en.isIntersecting)) olderNow(); }, { root: sc, rootMargin: '300px 0px 0px 0px' });
  updateSend();
}

const atBottom = () => { const sc = $('#chat-scroll'); return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80; };
function scrollBottom(smooth = false) {
  const sc = $('#chat-scroll');
  if (smooth) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); else sc.scrollTop = sc.scrollHeight;
}
async function olderNow() {
  if (filter() || V.q || loadingOlder || moreOlder === false || !liveLoaded) return;
  const got = await loadOlder();
  if (got) render();
  else renderSoon();
}

function toggleSearch(open = !V.searchOpen) {
  V.searchOpen = open;
  $('#chat-searchbar').classList.toggle('hidden', !open);
  $('#chat-search-btn').classList.toggle('on', open);
  if (open) $('#chat-search').focus();
  else { $('#chat-search').value = ''; V.q = ''; V.forceBottom = true; render(); }
}

function chatMenu(anchor) {
  const ttl = ttlDays();
  menu(anchor, [
    { icon: 'pin', label: `Ver fijados (${pins.size})`, onClick: () => ctx.openPins() },
    { icon: 'search', label: 'Buscar en el chat', onClick: () => toggleSearch(true) },
    '-',
    { icon: 'hourglass', label: `Caducidad: ${ttl ? `${ttl} días` : 'nunca'}…`, onClick: () => chooseTtl() }
  ]);
}
export async function chooseTtl() {
  const sel = el('select', {}, TTL_OPTIONS.map(([d, l]) => el('option', { value: d, selected: d === ttlDays() }, l)));
  const ok = await modal({
    title: 'Caducidad del chat',
    body: [el('p', {}, 'Los mensajes NO fijados se borran solos (con sus archivos) pasado este tiempo. Los fijados no caducan nunca.'),
      el('label', {}, 'Borrar los mensajes a los', sel),
      el('p', { class: 'muted small' }, 'Se aplica en todos tus dispositivos. La limpieza se hace al abrir la app con conexión.')],
    actions: [{ label: 'Cancelar' }, { label: 'Guardar', primary: true, value: true }]
  });
  if (!ok) return;
  setTtl(Number(sel.value));
  localStorage.removeItem(CLEAN_KEY);
  toast('Guardado', 'ok');
}

// ---------- Componer ----------
function stage(files) {
  for (const f of files) {
    if (!f) continue;
    if (!isImage(f) && f.size > LIMITS.maxFileBytes) { toast(`«${f.name}» supera ${formatBytes(LIMITS.maxFileBytes)}`, 'error', 4000); continue; }
    if (isImage(f) && f.size > 60 * 1024 * 1024) { toast(`«${f.name}» es demasiado grande`, 'error'); continue; }
    V.staged.push({ file: f, url: isImage(f) ? URL.createObjectURL(f) : null });
  }
  renderStaged();
  $('#chat-input').focus();
}
function renderStaged() {
  const box = $('#chat-staged');
  box.classList.toggle('hidden', !V.staged.length);
  box.replaceChildren(...V.staged.map((s, i) => el('div', { class: 'chat-chip' },
    s.url ? el('img', { src: s.url, alt: '' }) : el('span', { class: 'chat-chip-ico' }, icon(/pdf/.test(s.file.type) ? 'file-text' : 'file')),
    el('span', { class: 'chat-chip-name' }, s.file.name || 'archivo', el('small', {}, formatBytes(s.file.size))),
    el('button', { type: 'button', class: 'x', 'aria-label': `Quitar ${s.file.name || 'archivo'}`, onclick: () => {
      if (s.url) URL.revokeObjectURL(s.url);
      V.staged.splice(i, 1); renderStaged(); updateSend();
    } }, icon('x')))));
  updateSend();
}
function updateSend() {
  const can = !V.sending && (!!$('#chat-input').value.trim() || V.staged.length > 0);
  $('#chat-send').disabled = !can;
}
async function submit() {
  if (V.sending) return;
  const input = $('#chat-input');
  const text = input.value;
  const files = V.staged.map((s) => s.file);
  if (!text.trim() && !files.length) return;
  V.sending = true; updateSend();
  $('#chat-form').classList.add('busy');
  try {
    const ok = await sendMessage(text, files);
    if (ok) {
      input.value = '';
      V.staged.forEach((s) => s.url && URL.revokeObjectURL(s.url));
      V.staged = [];
      renderStaged();
      input.dispatchEvent(new Event('input'));
      if (V.q) toggleSearch(false);
    }
  } finally {
    V.sending = false; updateSend();
    $('#chat-form').classList.remove('busy');
  }
}
/** Texto y archivos que llegan de fuera (Compartir en Android) */
export function stageShared({ text = '', files = [] }) {
  const input = $('#chat-input');
  if (text) { input.value = input.value ? `${input.value}\n${text}` : text; input.dispatchEvent(new Event('input')); }
  if (files.length) stage(files); else input.focus();
}
/** v1.38.0: ¿hay un mensaje a medio escribir o archivos preparados? (no se vuelve a Inicio) */
export const chatDraft = () => !!($('#chat-input')?.value.trim() || V.staged.length);
export function focusComposer() { setTimeout(() => $('#chat-input').focus(), 60); }

// ---------- Pintar ----------
const dayFmt = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const dayFmtY = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const startOf = (ms) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
function dayLabel(ms) {
  const t = startOf(Date.now()), d = startOf(ms);
  if (d === t) return 'Hoy';
  if (d === t - DAY || (t - d < 1.5 * DAY && t - d > 0.5 * DAY)) return 'Ayer';
  const s = (new Date(ms).getFullYear() === new Date().getFullYear() ? dayFmt : dayFmtY).format(new Date(ms));
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function expiryText(m) {
  const exp = expiresAt(m);
  if (!exp) return null;
  const left = exp - Date.now();
  if (left > 3 * DAY) return null;
  if (left <= 0) return 'caduca hoy';
  const h = Math.ceil(left / 3600000);
  return h < 24 ? `caduca en ${h} h` : `caduca en ${Math.ceil(left / DAY)} día${Math.ceil(left / DAY) > 1 ? 's' : ''}`;
}

/** Texto con enlaces web pulsables (sin vistas previas externas) */
function textNodes(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(el('a', { href: hrefOf(m[0]), target: '_blank', rel: 'noopener noreferrer' }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

async function loadThumb(img) {
  const fid = img.dataset.fid;
  try {
    const url = await fileUrl(fid);
    img.src = url;
  } catch { img.closest('.chat-img')?.classList.add('broken'); }
}

function fileNode(m, fid) {
  const f = fileMeta(fid);
  if (!f) return el('div', { class: 'chat-file missing' }, icon('file'), ' Archivo no disponible');
  const isImg = f.kind === 'image' || /^image\//.test(f.mime || '');
  if (isImg) {
    const t = thumbs.get(fid);
    const img = el('img', { alt: f.name || 'imagen', dataset: { fid }, draggable: false });
    if (t?.ratio) img.style.aspectRatio = String(t.ratio);
    img.addEventListener('load', () => { if (img.naturalWidth) thumbs.set(fid, { ratio: img.naturalWidth / img.naturalHeight }); img.style.aspectRatio = String(img.naturalWidth / img.naturalHeight); });
    imgIO?.observe(img);
    return el('button', { type: 'button', class: 'chat-img', title: 'Ver a pantalla completa', onclick: (e) => { if (ctx.longPressed(e.currentTarget.closest('.msg'))) return; ctx.openViewer({ fileId: fid, name: f.name, kind: 'image', full: true }); } }, img);
  }
  const pdf = f.mime === 'application/pdf' || /\.pdf$/i.test(f.name || '');
  return el('button', { type: 'button', class: 'chat-file', title: pdf ? 'Abrir PDF' : 'Abrir o descargar',
    onclick: (e) => { if (ctx.longPressed(e.currentTarget.closest('.msg'))) return; ctx.openViewer({ fileId: fid, name: f.name, kind: 'file', mime: f.mime }); } },
  el('span', { class: 'chat-file-ico' }, icon(pdf ? 'file-text' : 'file')),
  el('span', { class: 'chat-file-name' }, f.name || 'archivo', el('small', {}, `${pdf ? 'PDF · ' : ''}${formatBytes(f.size)}`)));
}

function msgKey(m) {
  return JSON.stringify([m.text, m.files, m.pinned, m.editedAt, pending.has(m.id), expiryText(m), V.focusId === m.id, (m.files || []).map((f) => !!fileMeta(f))]);
}
function bubble(m) {
  const mine = m.devId === myDev();
  const [devIco, devName] = DEVICES[m.device] || DEVICES.desktop;
  const exp = expiryText(m);
  const node = el('div', { class: `msg ${mine ? 'mine' : 'theirs'} ${m.pinned ? 'pinned' : ''} ${V.focusId === m.id ? 'focus' : ''}`, dataset: { id: m.id } },
    el('div', { class: 'msg-b' },
      m.pinned ? el('span', { class: 'msg-pin', title: 'Fijado: no caduca' }, icon('pin')) : null,
      (m.files || []).length ? el('div', { class: 'msg-files' }, m.files.map((f) => fileNode(m, f))) : null,
      m.text ? el('div', { class: 'msg-t' }, textNodes(m.text)) : null,
      el('div', { class: 'msg-m' },
        el('span', { class: 'msg-dev', title: `Enviado desde: ${devName}` }, icon(devIco), ` ${devName}`),
        m.editedAt ? el('span', {}, '· editado') : null,
        exp ? el('span', { class: 'msg-exp', title: 'Fíjalo para que no se borre' }, icon('hourglass'), ` ${exp}`) : null,
        pending.has(m.id) ? el('span', { class: 'msg-pend', title: 'Se enviará al volver la conexión' }, icon('clock'), ' pendiente') : null,
        el('span', { class: 'msg-time' }, timeFmt.format(new Date(m.createdAt || 0))))),
    el('div', { class: 'msg-acts' },
      m.text ? el('button', { type: 'button', class: 'icon-btn sm', title: 'Copiar el texto', 'aria-label': 'Copiar el texto', onclick: (e) => copyMsg(m, e.currentTarget) }, icon('copy')) : null,
      el('button', { type: 'button', class: 'icon-btn sm', title: 'Más acciones', 'aria-label': 'Más acciones', onclick: (e) => msgMenu(e.currentTarget, m) }, icon('ellipsis'))));
  ctx.bindContext(node.querySelector('.msg-b'), (anchor) => msgMenu(anchor, m));
  return node;
}

async function copyMsg(m, btn) {
  if (!await copyText(m.text || '')) { toast('No se pudo copiar', 'error'); return; }
  toast('Copiado ✓', 'ok', 1600);
  if (btn) { btn.classList.add('done'); setTimeout(() => btn.classList.remove('done'), 1400); }
}

function msgMenu(anchor, m0) {
  const m = getMsg(m0.id) || m0;
  const files = (m.files || []).map(fileMeta).filter(Boolean);
  menu(anchor, [
    m.text ? { icon: 'copy', label: 'Copiar el texto', onClick: () => copyMsg(m) } : null,
    ...files.map((f) => ({ icon: 'download', label: `Descargar «${f.name || 'archivo'}»`, onClick: async () => {
      try { download(f.name || 'archivo', await fileBlob(f.id)); } catch (e) { toast(e.message, 'error'); }
    } })),
    { icon: m.pinned ? 'pin-off' : 'pin', label: m.pinned ? 'Quitar de fijados' : 'Fijar (no caduca)', onClick: () => { patchMsg(m.id, { pinned: !m.pinned }); toast(m.pinned ? 'Quitado de fijados' : 'Fijado: no caducará', 'ok'); } },
    '-',
    { icon: 'notebook-text', label: 'Convertir en nota nueva', onClick: () => toNewNote(m) },
    { icon: 'file-plus', label: 'Añadir al final de una nota…', onClick: () => toExistingNote(m) },
    { icon: 'clipboard-list', label: 'Convertir en prerredactado', onClick: () => toSnippet(m) },
    '-',
    { icon: 'pencil', label: m.text ? 'Editar el texto' : 'Añadir texto', onClick: () => editMessage(m) },
    { icon: 'trash-2', label: 'Eliminar', danger: true, onClick: () => removeMessage(m) }
  ]);
}

export function chatMatches(m, words) {
  const s = norm(`${m.text || ''} ${fileNames(m)}`);
  return words.every((w) => s.includes(w));
}
/** Para la búsqueda global: del más reciente al más antiguo */
export const chatSearch = (words) => messages().filter((m) => chatMatches(m, words)).reverse();
/** Tarjeta para la búsqueda global */
export function chatCard(m, { onOpen }) {
  const t = String(m.text || '').trim();
  const names = (m.files || []).map((f) => fileMeta(f)?.name).filter(Boolean);
  const [devIco, devName] = DEVICES[m.device] || DEVICES.desktop;
  return el('div', { class: 'note-card chat-card', role: 'button', tabindex: '0', onclick: () => onOpen(m.id), onkeydown: (e) => { if (e.key === 'Enter') onOpen(m.id); } },
    el('div', { class: 't' }, m.pinned ? icon('pin') : null, el('span', {}, t.split('\n')[0] || names[0] || 'Mensaje')),
    t.includes('\n') || (t && names.length) ? el('div', { class: 's' }, t.split('\n').slice(1).join(' ') || names.join(', ')) : null,
    el('div', { class: 'm' }, icon('message-circle'), el('span', {}, `Chat · ${dayLabel(m.createdAt)} ${timeFmt.format(new Date(m.createdAt || 0))}`),
      el('span', {}, '·'), icon(devIco), el('span', {}, devName),
      names.length ? [el('span', {}, '·'), icon('paperclip'), el('span', {}, `${names.length} archivo${names.length > 1 ? 's' : ''}`)] : null));
}

/** Pinta la lista conservando la posición (el primer mensaje visible no se mueve) */
export function render() {
  if (!V.ready) return;
  V.stale = false;
  const sc = $('#chat-scroll');
  const box = $('#chat-list');
  const pinsMode = filter() === 'pins';
  // Cabecera
  $('#chat-back').classList.toggle('hidden', !pinsMode);
  $('#chat-title').replaceChildren(icon(pinsMode ? 'pin' : 'message-circle'), pinsMode ? ' Fijados' : ' Chat personal');
  $('#chat-form').classList.toggle('hidden', pinsMode);
  $('#chat-search-btn').classList.toggle('hidden', pinsMode);
  const np = pins.size;
  $('#chat-pins').classList.toggle('hidden', pinsMode || !np || !!V.q);
  $('#chat-pins').replaceChildren(icon('pin'), el('b', {}, ' Fijados'), el('span', { class: 'muted' }, ` · ${np}`), el('span', { class: 'spacer' }), el('span', { class: 'muted small' }, 'no caducan'));

  // Ancla: primer mensaje visible
  const forceBottom = V.forceBottom || V.first;
  let anchor = null, anchorTop = 0;
  if (!forceBottom && !atBottom()) {
    const top = sc.getBoundingClientRect().top;
    for (const n of box.children) {
      if (!n.dataset.id) continue;
      const r = n.getBoundingClientRect();
      if (r.bottom > top) { anchor = n.dataset.id; anchorTop = r.top - top; break; }
    }
  }
  const wasBottom = !anchor;

  const words = norm(V.q.trim()).split(/\s+/).filter(Boolean);
  let list = messages();
  if (pinsMode) list = list.filter((m) => m.pinned);
  if (words.length) list = list.filter((m) => chatMatches(m, words));
  const out = [];
  if (!pinsMode && !words.length && liveLoaded) {
    if (moreOlder) {
      const s = el('div', { class: 'chat-older' }, el('button', { type: 'button', class: 'btn sm', onclick: () => olderNow() }, icon('chevron-up'), loadingOlder ? ' Cargando…' : ' Mensajes anteriores'));
      out.push(s);
      setTimeout(() => topIO?.observe(s), 300);
    } else if (list.length) out.push(el('div', { class: 'chat-start muted small' }, 'Principio del chat · los mensajes no fijados se borran solos', ttlDays() ? ` a los ${ttlDays()} días` : ' (caducidad: nunca)'));
  }
  if (words.length && !everything && moreOlder !== false) {
    out.push(el('div', { class: 'chat-older' }, el('button', { type: 'button', class: 'btn sm', onclick: async (e) => {
      e.currentTarget.disabled = true; e.currentTarget.textContent = 'Cargando…';
      try { await loadEverything(); } catch (err) { toast(err.message, 'error'); }
      V.forceBottom = true; render();
    } }, icon('search'), ' Buscar también en los mensajes anteriores')));
  }
  let lastDay = null;
  const used = new Set();
  for (const m of list) {
    const d = startOf(m.createdAt || 0);
    if (d !== lastDay) { out.push(el('div', { class: 'chat-day' }, el('span', {}, dayLabel(m.createdAt || 0)))); lastDay = d; }
    const key = msgKey(m);
    let c = nodes.get(m.id);
    if (!c || c.key !== key) { c = { key, node: bubble(m) }; nodes.set(m.id, c); }
    used.add(m.id);
    out.push(c.node);
  }
  for (const id of [...nodes.keys()]) if (!used.has(id) && !getMsg(id)) nodes.delete(id);
  if (!list.length) {
    out.push(el('div', { class: 'chat-empty' }, !liveLoaded ? 'Cargando…'
      : words.length ? `Sin mensajes que coincidan con «${V.q.trim()}».`
        : pinsMode ? 'No hay mensajes fijados. Fija un mensaje (⋯ → Fijar) para que no caduque nunca.'
          : [el('p', { class: 'big' }, icon('message-circle')),
            el('p', {}, 'Envíate textos, enlaces, fotos y documentos para tenerlos en todos tus dispositivos.'),
            el('p', { class: 'small' }, `Es una bandeja temporal: lo que no fijes se borra solo${ttlDays() ? ` a los ${ttlDays()} días` : ''}.`)]));
  }
  box.replaceChildren(...out);

  if (forceBottom || wasBottom) {
    V.wasBottom = true;
    scrollBottom();
    requestAnimationFrame(() => scrollBottom());
  } else {
    const n = box.querySelector(`[data-id="${CSS.escape(anchor)}"]`);
    if (n) sc.scrollTop += n.getBoundingClientRect().top - sc.getBoundingClientRect().top - anchorTop;
  }
  if (V.focusId) {
    const n = box.querySelector(`[data-id="${CSS.escape(V.focusId)}"]`);
    if (n) { n.scrollIntoView({ block: 'center' }); const id = V.focusId; setTimeout(() => { if (V.focusId === id) { V.focusId = null; nodes.delete(id); renderSoon(); } }, 2500); }
  }
  V.forceBottom = false;
  V.first = false;
  $('#chat-down').classList.toggle('hidden', atBottom());
  if (chatVisible() && !pinsMode) markSeen();
}

/** Al entrar en la sección (o volver a la pestaña) */
export function chatShown({ focusId = null, compose = false } = {}) {
  if (focusId) { V.focusId = focusId; V.q = ''; $('#chat-search').value = ''; if (!getMsg(focusId)) V.focusId = null; }
  if (!focusId) V.forceBottom = V.forceBottom || V.stale || V.first;
  render();
  if (compose) focusComposer();
}
document.addEventListener('visibilitychange', () => { if (chatVisible()) { if (V.stale) render(); else markSeen(); } });

// ---------- Compartir desde otras apps (Android, share_target del manifest) ----------
export const SHARE_CACHE = 'drfolio-share';
/** Si la app se abrió desde «Compartir», recoge lo compartido (lo guardó sw.js) y lo deja listo para enviar */
export async function consumeShare() {
  if (!/[?&]share=1\b/.test(location.search)) return false;
  history.replaceState(history.state, '', location.pathname + location.hash);
  if (!('caches' in window)) return false;
  try {
    const c = await caches.open(SHARE_CACHE);
    const metaRes = await c.match('./__share/meta');
    if (!metaRes) return false;
    const meta = await metaRes.json();
    const files = [];
    for (const f of meta.files || []) {
      const r = await c.match(`./__share/${f.i}`);
      if (r) files.push(new File([await r.blob()], f.name || 'archivo', { type: f.type || 'application/octet-stream' }));
    }
    await caches.delete(SHARE_CACHE);
    const parts = [meta.title, meta.text, meta.url].map((x) => String(x || '').trim()).filter(Boolean);
    const text = parts.filter((p, i) => !parts.some((q, j) => j !== i && q.includes(p) && q.length > p.length)).filter((p, i, a) => a.indexOf(p) === i).join('\n');
    stageShared({ text, files });
    return true;
  } catch (e) { console.warn('share', e); return false; }
}
/** Vuelve a pintar (p. ej. cuando llegan los datos de los archivos) */
export const refreshChat = () => renderSoon();
