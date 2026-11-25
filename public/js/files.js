// Imágenes y adjuntos (PDF…) guardados en Firestore en trozos (plan gratuito, sin Storage)
import { collection, doc, getDocs, writeBatch, deleteDoc } from '../vendor/libs.js';
import { db } from './db.js';
import { store, ref, newId, put } from './store.js';
import { LIMITS } from './config.js';

const urlCache = new Map();    // fileId -> objectURL
const loading = new Map();     // fileId -> Promise<objectURL>

const chunksCol = (fileId) => collection(db, 'users', store.uid, 'files', fileId, 'chunks');

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Reduce una imagen a JPEG/PNG ligero. Devuelve Blob. */
export async function compressImage(file) {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    if (file.size <= LIMITS.imageTargetBytes * 2) return file;
  }
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    // Formato que el navegador no sabe abrir (p. ej. HEIC fuera de Safari)
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i); i.onerror = rej;
      i.src = URL.createObjectURL(file);
    });
    bmp = img;
  }
  const w0 = bmp.width, h0 = bmp.height;
  let scale = Math.min(1, LIMITS.imageMaxSide / Math.max(w0, h0));
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const isPng = file.type === 'image/png';
  let quality = 0.82;
  let blob = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    canvas.width = Math.max(1, Math.round(w0 * scale));
    canvas.height = Math.max(1, Math.round(h0 * scale));
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    // PNG solo si es pequeño (capturas con texto se ven mejor); si no, JPEG
    const type = isPng && attempt === 0 ? 'image/png' : 'image/jpeg';
    blob = await new Promise((r) => canvas.toBlob(r, type, quality));
    if (blob && blob.size <= LIMITS.imageTargetBytes) break;
    if (attempt >= 1) { quality = Math.max(0.5, quality - 0.1); scale *= 0.85; }
  }
  if (bmp.close) bmp.close();
  return blob && blob.size < file.size ? blob : (file.size <= LIMITS.chunkBytes * 3 ? file : blob);
}

/**
 * Guarda un archivo y devuelve su id. Las escrituras quedan en cola si no hay conexión.
 * meta: { noteId, name, kind: 'image'|'file' }
 */
export async function saveFile(blob, { noteId, name, kind }) {
  if (blob.size > LIMITS.maxFileBytes) {
    throw new Error(`El archivo supera ${Math.round(LIMITS.maxFileBytes / 1024 / 1024)} MB`);
  }
  const id = newId('files');
  const chunks = Math.max(1, Math.ceil(blob.size / LIMITS.chunkBytes));
  urlCache.set(id, URL.createObjectURL(blob));

  // Trozos en lotes pequeños (límite de 10 MB por petición)
  const PER_BATCH = 6;
  const commits = [];
  for (let start = 0; start < chunks; start += PER_BATCH) {
    const batch = writeBatch(db);
    for (let i = start; i < Math.min(chunks, start + PER_BATCH); i++) {
      const part = blob.slice(i * LIMITS.chunkBytes, (i + 1) * LIMITS.chunkBytes);
      const d = await blobToBase64(part);
      batch.set(doc(chunksCol(id), String(i).padStart(3, '0')), { d });
    }
    commits.push(batch.commit());
  }
  // Los metadatos van al final: si existen, el archivo está completo
  const metaWrite = put('files', id, {
    noteId: noteId || null,
    name: name || (kind === 'image' ? 'imagen' : 'archivo'),
    mime: blob.type || 'application/octet-stream',
    size: blob.size,
    kind,
    chunks,
    createdAt: Date.now()
  });
  Promise.all([...commits, metaWrite]).catch((e) => console.error('Error subiendo archivo', e));
  return id;
}

/** URL local (blob:) para mostrar una imagen o abrir un PDF */
export function fileUrl(id) {
  if (urlCache.has(id)) return Promise.resolve(urlCache.get(id));
  if (loading.has(id)) return loading.get(id);
  const p = (async () => {
    const meta = store.files.get(id);
    const snap = await getDocs(chunksCol(id));
    if (snap.empty) throw new Error('Archivo no disponible (¿sin conexión?)');
    const parts = snap.docs
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((d) => base64ToBytes(d.data().d || ''));
    const blob = new Blob(parts, { type: meta?.mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    urlCache.set(id, url);
    return url;
  })();
  loading.set(id, p);
  p.finally(() => loading.delete(id));
  return p;
}

export async function fileBlob(id) {
  const url = await fileUrl(id);
  return (await fetch(url)).blob();
}

/** Borra un archivo y sus trozos */
export async function deleteFile(id) {
  const meta = store.files.get(id);
  const n = meta?.chunks || 0;
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
  if (n) {
    const batch = writeBatch(db);
    for (let i = 0; i < n; i++) batch.delete(doc(chunksCol(id), String(i).padStart(3, '0')));
    batch.delete(ref('files', id));
    batch.commit().catch((e) => console.error(e));
    return;
  }
  // Sin metadatos: buscamos los trozos que haya
  try {
    const snap = await getDocs(chunksCol(id));
    snap.docs.forEach((d) => deleteDoc(d.ref).catch(() => {}));
  } catch (e) { console.error(e); }
  deleteDoc(ref('files', id)).catch(() => {});
}

export function revokeAll() {
  for (const u of urlCache.values()) URL.revokeObjectURL(u);
  urlCache.clear();
}
