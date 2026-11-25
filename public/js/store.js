// Datos en memoria sincronizados con Firestore en tiempo real
//
// Estructura en Firestore (todo bajo users/{uid}/):
//   folders/{id}  { name, parentId|null, color, order, createdAt, updatedAt }
//   tags/{id}     { name, color, createdAt }
//   notes/{id}    { title, html, text, folderId|null, tags:[tagId], pinned, trashed, trashedAt,
//                   refs:[{id, cite, url, fileId, fileName, fileSize}], createdAt, updatedAt }
//   files/{id}    { noteId, name, mime, size, kind:'image'|'file', chunks, createdAt }
//   files/{id}/chunks/{000..}  { d: base64 }
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot } from '../vendor/libs.js';
import { db } from './db.js';

export const store = {
  uid: null,
  folders: new Map(),
  tags: new Map(),
  notes: new Map(),
  files: new Map(),
  pending: {},     // escrituras pendientes de subir por colección
  loaded: {},      // primera carga completada por colección
  fromCache: {}
};

const COLS = ['folders', 'tags', 'notes', 'files'];
let unsubs = [];

export const col = (name) => collection(db, 'users', store.uid, name);
export const ref = (name, id) => doc(db, 'users', store.uid, name, id);
export const newId = (name) => doc(col(name)).id;

/** Empieza a escuchar cambios. onChange(colName, changedIds:Set, snap) */
export function startSync(uid, onChange, onError) {
  store.uid = uid;
  stopSync();
  for (const name of COLS) {
    const un = onSnapshot(col(name), { includeMetadataChanges: true }, (snap) => {
      const map = store[name];
      const changed = new Set();
      for (const ch of snap.docChanges()) {
        changed.add(ch.doc.id);
        if (ch.type === 'removed') map.delete(ch.doc.id);
        else map.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() });
      }
      store.pending[name] = snap.metadata.hasPendingWrites;
      store.fromCache[name] = snap.metadata.fromCache;
      store.loaded[name] = true;
      onChange(name, changed, snap);
    }, (err) => onError(name, err));
    unsubs.push(un);
  }
}

export function stopSync() {
  unsubs.forEach((u) => u());
  unsubs = [];
}

export const hasPending = () => COLS.some((c) => store.pending[c]);
export const allLoaded = () => COLS.every((c) => store.loaded[c]);

// Las escrituras se aplican al instante en local (también sin conexión) y se suben solas.
// No esperamos a la promesa para no bloquear la interfaz sin red; solo registramos errores.
let errorHandler = (e) => console.error(e);
export const setWriteErrorHandler = (fn) => { errorHandler = fn; };
const guard = (p) => { p.catch((e) => errorHandler(e)); return p; };

export const put = (name, id, data) => guard(setDoc(ref(name, id), data, { merge: true }));
export const patch = (name, id, data) => guard(updateDoc(ref(name, id), data));
export const remove = (name, id) => guard(deleteDoc(ref(name, id)));

// ---------- Ayudas sobre carpetas ----------
export function childFolders(parentId) {
  return [...store.folders.values()]
    .filter((f) => (f.parentId || null) === (parentId || null))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'es'));
}

export function folderPath(id) {
  const path = [];
  let f = store.folders.get(id);
  const seen = new Set();
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    path.unshift(f);
    f = f.parentId ? store.folders.get(f.parentId) : null;
  }
  return path;
}

export function descendantIds(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of store.folders.values()) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
    }
  }
  return out;
}

/** Lista plana del árbol para selectores */
export function flatFolders(parentId = null, depth = 0, out = []) {
  for (const f of childFolders(parentId)) {
    out.push({ ...f, depth });
    flatFolders(f.id, depth + 1, out);
  }
  return out;
}

export function liveNotes() {
  return [...store.notes.values()].filter((n) => !n.trashed);
}

export function tagByName(name) {
  const k = name.trim().toLowerCase();
  return [...store.tags.values()].find((t) => t.name.toLowerCase() === k);
}

/** Bytes aproximados ocupados en Firestore */
export function usageBytes() {
  let b = 0;
  for (const f of store.files.values()) b += Math.ceil((f.size || 0) * 1.37) + 300;
  for (const n of store.notes.values()) b += (n.html?.length || 0) + (n.text?.length || 0) + 500;
  for (const f of store.folders.values()) b += 200 + (f.name?.length || 0);
  for (const t of store.tags.values()) b += 150 + (t.name?.length || 0);
  return b;
}
