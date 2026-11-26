// Contenido de las notas (desde v1.10.0 cada nota son dos documentos)
//
//   notes/{id}       Datos ligeros para listas, carpetas y búsqueda rápida (se sincronizan siempre):
//                    title, folderId, tags, pinned, trashed, trashedAt, createdAt, updatedAt,
//                    preview (≈200 primeros caracteres), words, refsCount, links (ids de notas enlazadas),
//                    files (ids de imágenes y adjuntos), size (bytes aprox. del contenido)
//   noteBodies/{id}  { html, text, refs, updatedAt } → solo se descarga al ABRIR la nota
//                    (y en segundo plano en los dispositivos de confianza, para buscar en todo sin conexión)
//
// Regla: cada vez que cambia el cuerpo, notes/{id}.updatedAt y noteBodies/{id}.updatedAt reciben el mismo valor
// en el mismo lote. Así, la nota ligera (que llega en tiempo real) dice si la copia local del cuerpo está al día:
// cada cuerpo guardado lleva `v` = el updatedAt de la nota con el que se comprobó.
//
// Notas «antiguas» (sin migrar, ≤ v1.9.0): html/text/refs siguen dentro de notes/{id}. bodyOf() las lee igual.
// La copia local de los cuerpos (dispositivos de confianza) va en IndexedDB «drfolio-bodies» y se borra al cerrar sesión.
import { getDoc, getDocs, query, where, documentId, writeBatch, deleteField } from '../vendor/libs.js';
import { db } from './db.js';
import { store, ref, col, commitBatch } from './store.js';

export const LEGACY_FIELDS = ['html', 'text', 'refs'];
export const DERIVED_FIELDS = ['preview', 'words', 'refsCount', 'links', 'files', 'size'];
export const isLegacy = (n) => !!n && (n.html !== undefined || n.text !== undefined || n.refs !== undefined);

const str = (x) => (typeof x === 'string' ? x : '');
const arr = (x) => (Array.isArray(x) ? x : []);

/** Campos ligeros calculados a partir del contenido */
export function deriveLight({ html = '', text = '', refs = [] }) {
  const links = new Set(), files = new Set();
  for (const m of str(html).matchAll(/data-note="([^"]+)"/g)) links.add(m[1]);
  for (const m of str(html).matchAll(/data-file="([^"]+)"/g)) files.add(m[1]);
  for (const r of arr(refs)) if (r && r.fileId) files.add(r.fileId);
  const t = str(text).replace(/\s+/g, ' ').trim();
  return {
    preview: t.slice(0, 200), words: t ? t.split(' ').length : 0, refsCount: arr(refs).length,
    links: [...links], files: [...files], size: str(html).length + str(text).length
  };
}

// ====================== Copia en memoria (y en IndexedDB) ======================
/** id → { html, text, refs, updatedAt, v } */
export const bodies = new Map();
/** Estado para la interfaz: persist = dispositivo de confianza; syncing/done/total = descarga en segundo plano */
export const bodyState = { persist: false, ready: false, syncing: false, done: 0, total: 0, reads: 0, error: null };
let onState = () => {};

const cleanBody = (d) => ({ html: str(d?.html), text: str(d?.text), refs: arr(d?.refs), updatedAt: Number(d?.updatedAt) || 0 });

/** Contenido de una nota si está disponible ya (memoria o nota antigua), o null */
export function bodyOf(id) {
  const n = store.notes.get(id);
  if (n && isLegacy(n)) return { html: str(n.html), text: str(n.text), refs: arr(n.refs), updatedAt: n.updatedAt || 0, v: n.updatedAt || 0, legacy: true };
  return bodies.get(id) || null;
}
const isFresh = (n, b) => !!b && (b.legacy || (b.v || 0) >= (n?.updatedAt || 0));
/** true si el contenido en memoria corresponde a la última versión conocida de la nota */
export function hasFreshBody(id) { return isFresh(store.notes.get(id), bodyOf(id)); }
/** Número de notas cuyo contenido está disponible (para buscar) */
export function bodiesAvailable() {
  let n = 0;
  for (const x of store.notes.values()) if (isLegacy(x) || bodies.has(x.id)) n++;
  return n;
}

function keep(id, body) {
  bodies.set(id, body);
  if (bodyState.persist) idbQueue(id, body);
}
export function dropBody(id) {
  if (!bodies.delete(id)) return;
  if (bodyState.persist) idbQueue(id, null);
}

/** Guarda un cuerpo recibido del servidor/caché. v = updatedAt de la nota con el que se comprobó. */
function accept(id, data, fromServer) {
  const n = store.notes.get(id);
  const b = cleanBody(data);
  const v = Math.max(b.updatedAt, fromServer ? (n?.updatedAt || 0) : 0);
  const cur = bodies.get(id);
  if (cur && (cur.v || 0) > v) return cur; // ya hay una versión más nueva (p. ej. guardada aquí mismo)
  const body = { ...b, v };
  keep(id, body);
  return body;
}

// ====================== Cargar ======================
const inflight = new Map();
/** Contenido de una nota: al instante si está al día; si no, se descarga (1 lectura). Falla sin conexión y sin copia. */
export function loadBody(id) {
  const n = store.notes.get(id);
  const b = bodyOf(id);
  if (n && isFresh(n, b)) return Promise.resolve(b);
  if (inflight.has(id)) return inflight.get(id);
  const p = getDoc(ref('noteBodies', id)).then((snap) => {
    const fromServer = !snap.metadata.fromCache;
    if (fromServer) countReads(1);
    const n2 = store.notes.get(id);
    if (n2 && isLegacy(n2)) return bodyOf(id);
    if (!snap.exists()) {
      // Sin documento: nota sin contenido (solo si lo dice el servidor; sin conexión no damos nada por vacío)
      if (!fromServer) throw new Error('offline');
      return accept(id, { updatedAt: 0 }, true);
    }
    return accept(id, snap.data(), fromServer);
  }).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

function countReads(k) { bodyState.reads += k; store.stats.bodyReads = bodyState.reads; }

/**
 * Descarga los cuerpos que falten o estén desactualizados (solo esos: 1 lectura por nota).
 * Si faltan casi todos, una sola consulta de la colección entera.
 */
let syncRun = null;
export async function syncBodies() {
  if (syncRun) await syncRun.catch(() => 0); // si ya hay una en marcha, se espera y se repasa lo que quede
  if (syncRun) return syncRun;
  syncRun = (async () => {
    const stale = staleNotes();
    if (!stale.length) return 0;
    bodyState.syncing = true; bodyState.error = null;
    bodyState.total = store.notes.size; bodyState.done = bodyState.total - stale.length;
    onState();
    let got = 0;
    try {
      const all = [...store.notes.values()].filter((n) => !isLegacy(n)).length;
      if (stale.length > 150 && stale.length > all * 0.5) {
        const snap = await getDocs(col('noteBodies'));
        const fromServer = !snap.metadata.fromCache;
        if (fromServer) countReads(Math.max(1, snap.size));
        const seen = new Set();
        for (const d of snap.docs) { seen.add(d.id); if (store.notes.has(d.id)) accept(d.id, d.data(), fromServer); }
        if (fromServer) for (const n of stale) if (!seen.has(n.id)) accept(n.id, { updatedAt: 0 }, true);
        got = stale.length;
        bodyState.done = bodyState.total; onState();
      } else {
        for (let i = 0; i < stale.length; i += 30) {
          const ids = stale.slice(i, i + 30).map((n) => n.id);
          const snap = await getDocs(query(col('noteBodies'), where(documentId(), 'in', ids)));
          const fromServer = !snap.metadata.fromCache;
          if (fromServer) countReads(Math.max(1, snap.size));
          const seen = new Set();
          for (const d of snap.docs) { seen.add(d.id); accept(d.id, d.data(), fromServer); }
          if (fromServer) for (const id of ids) if (!seen.has(id)) accept(id, { updatedAt: 0 }, true);
          got += ids.length;
          bodyState.done += ids.length; onState();
        }
      }
    } catch (e) {
      bodyState.error = e; console.warn('noteBodies', e);
    } finally {
      bodyState.syncing = false; bodyState.done = bodiesAvailable(); bodyState.total = store.notes.size;
      onState();
    }
    return got;
  })().finally(() => { syncRun = null; });
  return syncRun;
}
const staleNotes = () => [...store.notes.values()].filter((n) => !isLegacy(n) && !isFresh(n, bodies.get(n.id)));

/** Para la copia de seguridad / restaurar: todos los cuerpos o error (nunca se exporta una nota sin su contenido) */
export async function ensureAllBodies() {
  await syncBodies();
  const missing = [...store.notes.values()].filter((n) => !bodyOf(n.id));
  if (missing.length) throw new Error(`No se pudo descargar el contenido de ${missing.length} nota(s). Comprueba la conexión y vuelve a intentarlo.`);
}

/** Nota completa (como en ≤ v1.9.0): datos ligeros + html/text/refs, sin los campos calculados. Para copias y restaurar. */
export function fullNote(n) {
  const b = bodyOf(n.id);
  const rest = { ...n };
  for (const f of [...DERIVED_FIELDS, ...LEGACY_FIELDS]) delete rest[f];
  return { ...rest, html: b ? b.html : '', text: b ? b.text : '', refs: b ? b.refs : [] };
}

// ====================== Guardar ======================
/**
 * Escribe una nota: `light` = campos de notes/{id} (merge); `body` = {html, text, refs} completo o null.
 * Cuerpo y datos ligeros van en el mismo lote (también sin conexión: se suben solos).
 * Si la nota era antigua, de paso se migra (se quitan html/text/refs de notes/{id}).
 */
export function writeNote(id, light, body = null) {
  const n = store.notes.get(id);
  const batch = writeBatch(db);
  const data = { ...light };
  if (body) {
    const t = light.updatedAt || Date.now();
    const b = { html: str(body.html), text: str(body.text), refs: arr(body.refs), updatedAt: t };
    Object.assign(data, deriveLight(b), { updatedAt: t });
    batch.set(ref('noteBodies', id), b);
    keep(id, { ...b, v: t });
  }
  const remote = { ...data };
  if (body && n && isLegacy(n)) for (const f of LEGACY_FIELDS) remote[f] = deleteField();
  batch.set(ref('notes', id), remote, { merge: true });
  if (n) { Object.assign(n, data); if (body) for (const f of LEGACY_FIELDS) delete n[f]; } // reflejo inmediato
  else store.notes.set(id, { id, ...data });
  return commitBatch(batch);
}

/** Borra una nota y su contenido */
export function deleteNoteDocs(id) {
  const batch = writeBatch(db);
  batch.delete(ref('notes', id));
  batch.delete(ref('noteBodies', id));
  store.notes.delete(id);
  dropBody(id);
  return commitBatch(batch);
}

/** Tras restaurar: lo escrito ya está al día en memoria (ahorra lecturas) */
export function rememberBody(id, b) { keep(id, { ...cleanBody(b), v: Number(b.updatedAt) || 0 }); }

// ====================== IndexedDB (solo dispositivos de confianza) ======================
const IDB_NAME = 'drfolio-bodies';
let idb = null;
let queue = new Map();
let qTimer = null;

function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('b', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
}
function idbQueue(id, body) {
  if (!idb) return;
  queue.set(id, body);
  if (!qTimer) qTimer = setTimeout(idbFlush, 400);
}
function idbFlush() {
  qTimer = null;
  if (!idb || !queue.size) return;
  const items = queue; queue = new Map();
  try {
    const tx = idb.transaction('b', 'readwrite');
    const os = tx.objectStore('b');
    for (const [id, b] of items) { if (b) os.put({ id, ...b }); else os.delete(id); }
  } catch (e) { console.warn('idb', e); }
}

/**
 * Arranque: en dispositivos de confianza carga la copia local de los cuerpos (sin lecturas).
 * onChange se llama cuando cambia el progreso de la descarga en segundo plano.
 */
export async function initBodies({ persist, onChange }) {
  bodyState.persist = !!persist;
  onState = onChange || (() => {});
  if (persist && 'indexedDB' in window) {
    try {
      idb = await idbOpen();
      const all = await new Promise((res, rej) => {
        const r = idb.transaction('b').objectStore('b').getAll();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => rej(r.error);
      });
      for (const x of all) { const { id, ...b } = x; if (!bodies.has(id)) bodies.set(id, b); }
    } catch (e) { console.warn('idb', e); idb = null; }
  }
  bodyState.ready = true;
  onState();
}

/** Quita de la copia local los cuerpos de notas que ya no existen (llamar con los datos del servidor) */
export function pruneBodies() {
  for (const id of [...bodies.keys()]) if (!store.notes.has(id)) dropBody(id);
}

/** Cerrar sesión: borra la copia local de los cuerpos */
export function clearBodies() {
  bodies.clear();
  queue.clear();
  try { idb?.close(); } catch { /* nada */ }
  idb = null;
  return new Promise((res) => {
    try {
      const r = indexedDB.deleteDatabase(IDB_NAME);
      r.onsuccess = r.onerror = r.onblocked = () => res();
      setTimeout(res, 1500);
    } catch { res(); }
  });
}
