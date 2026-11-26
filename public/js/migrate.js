// Migración de las notas al formato de dos documentos (v1.10.0): notes/{id} ligero + noteBodies/{id} con el contenido
//
// Segura e idempotente (como la de prerredactados):
//  - Solo en dispositivos de confianza, con conexión y con las notas recibidas del servidor (no de la caché).
//  - Por grupos (≤ 40 notas, ≤ 2,5 MB), cada grupo en una TRANSACCIÓN: se vuelven a leer las notas y su cuerpo;
//    si otro dispositivo cambia algo a la vez, Firestore repite el grupo con los datos nuevos. Nunca se mezcla.
//  - Una nota ya migrada se salta. Si se corta (sin red, límite diario), lo que falta se hace la próxima vez.
//  - Si una nota tiene contenido en los dos sitios y es distinto (p. ej. un dispositivo con la versión antigua
//    escribió después de migrar), se queda la versión más reciente y la otra se guarda como nota aparte
//    «… (otra versión)»: no se pierde nada.
import { runTransaction, deleteField } from '../vendor/libs.js';
import { db } from './db.js';
import { store, ref, newId } from './store.js';
import { isLegacy, deriveLight, rememberBody } from './bodies.js';
import { budget, addQuota } from './backup.js';
import { htmlFresh, textToHtml, bodyHash } from './snipbody.js';

const str = (x) => (typeof x === 'string' ? x : '');
const arr = (x) => (Array.isArray(x) ? x : []);

export const legacyNotes = () => [...store.notes.values()].filter(isLegacy);

function groupsOf(notes) {
  const out = [];
  let cur = [], bytes = 0;
  for (const n of notes) {
    const b = str(n.html).length + str(n.text).length + 2000;
    if (cur.length && (cur.length >= 40 || bytes + b > 2.5 * 1024 * 1024)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(n.id); bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Migra todas las notas antiguas. onProgress(hechas, total). Devuelve { done, total, versions, stopped }.
 * stopped = 'quota' si se para por el límite diario de escrituras.
 */
export async function migrateNotes({ onProgress = () => {} } = {}) {
  const todo = legacyNotes();
  const total = todo.length;
  let done = 0, versions = 0;
  onProgress(0, total);
  // Cada dispositivo empieza por un grupo distinto (al azar): si hay dos migrando a la vez, casi no se cruzan
  const groups = groupsOf(todo);
  const start = Math.floor(Math.random() * groups.length);
  for (let g = 0; g < groups.length; g++) {
    // Lo que otro dispositivo ya migró (llega en tiempo real) se salta sin transacción
    const ids = groups[(start + g) % groups.length].filter((id) => isLegacy(store.notes.get(id)));
    const skipped = groups[(start + g) % groups.length].length - ids.length;
    if (!ids.length) { done += skipped; onProgress(done, total); continue; }
    if (budget().w < ids.length * 2 + 10) return { done, total, versions, stopped: 'quota' };
    const res = await runTransaction(db, async (tx) => {
      const nSnaps = await Promise.all(ids.map((id) => tx.get(ref('notes', id))));
      const bSnaps = await Promise.all(ids.map((id) => tx.get(ref('noteBodies', id))));
      const out = { migrated: 0, versions: 0, writes: 0, keep: [] };
      nSnaps.forEach((s, i) => {
        if (!s.exists()) return;
        const n = s.data();
        if (!isLegacy(n)) return; // ya migrada (por otro dispositivo)
        const legacy = { html: str(n.html), text: str(n.text), refs: arr(n.refs) };
        const t = Number(n.updatedAt) || Number(n.createdAt) || Date.now();
        let body = { ...legacy, updatedAt: t };
        const light = { ...deriveLight(legacy), html: deleteField(), text: deleteField(), refs: deleteField() };
        const prev = bSnaps[i].exists() ? bSnaps[i].data() : null;
        if (prev && str(prev.html) !== legacy.html) {
          const other = { html: str(prev.html), text: str(prev.text), refs: arr(prev.refs) };
          const prevT = Number(prev.updatedAt) || 0;
          const [win, lose, winT] = prevT > t ? [other, legacy, prevT] : [legacy, other, t];
          body = { ...win, updatedAt: winT };
          Object.assign(light, deriveLight(win), { updatedAt: winT });
          if (lose.html.trim() || lose.text.trim()) {
            const cid = newId('notes');
            const now = Date.now();
            tx.set(ref('noteBodies', cid), { ...lose, updatedAt: now });
            tx.set(ref('notes', cid), {
              title: `${n.title || 'Sin título'} (otra versión)`, folderId: n.folderId ?? null, tags: arr(n.tags),
              pinned: false, trashed: !!n.trashed, trashedAt: n.trashedAt ?? null, createdAt: now, updatedAt: now, ...deriveLight(lose)
            });
            out.versions++; out.writes += 2;
          }
        }
        tx.set(ref('noteBodies', s.id), body);
        tx.update(ref('notes', s.id), light);
        out.keep.push([s.id, body]);
        out.migrated++; out.writes += 2;
      });
      return out;
    });
    addQuota(res.writes, 0);
    res.keep.forEach(([id, b]) => rememberBody(id, b)); // ya tenemos el contenido: no hace falta volver a leerlo
    done += ids.length + skipped; versions += res.versions;
    onProgress(done, total);
  }
  return { done, total, versions, stopped: null };
}

// ====================== Prerredactados → texto enriquecido (v1.12.0) ======================
// Cada prerredactado sin `html` al día (ver snipbody.js) recibe su texto convertido a HTML: un párrafo por línea,
// líneas vacías incluidas, tabuladores y campos {…} tal cual. `body` (texto plano) NO se toca: copiar sigue dando
// exactamente lo mismo que antes. Por grupos (≤ 100) en TRANSACCIONES con los datos del servidor: si otro dispositivo
// lo migra o lo edita a la vez, Firestore repite el grupo y se salta lo que ya esté al día. Idempotente.
export const snippetsToMigrate = () => [...store.snippets.values()].filter((s) => !htmlFresh(s));

export async function migrateSnippets() {
  const todo = snippetsToMigrate().map((s) => s.id);
  let done = 0;
  for (let i = 0; i < todo.length; i += 100) {
    const ids = todo.slice(i, i + 100).filter((id) => store.snippets.has(id) && !htmlFresh(store.snippets.get(id)));
    if (!ids.length) continue;
    if (budget().w < ids.length + 10) return { done, stopped: 'quota' };
    const n = await runTransaction(db, async (tx) => {
      const snaps = await Promise.all(ids.map((id) => tx.get(ref('snippets', id))));
      let k = 0;
      for (const sn of snaps) {
        if (!sn.exists()) continue;
        const d = sn.data();
        if (htmlFresh(d)) continue; // ya migrado o editado con la versión nueva
        const body = str(d.body);
        tx.update(sn.ref, { html: textToHtml(body), bh: bodyHash(body) });
        k++;
      }
      return k;
    });
    addQuota(n, 0);
    done += n;
  }
  return { done, stopped: null };
}
