// Vademécum (v1.18.0): datos de las fichas, «Mis notas», texto de las pautas, búsqueda e importación.
//
//   drugs/{id}  Ficha ligera (se sincroniza siempre; es lo que se consulta en la guardia, también sin conexión):
//               name (principio activo), brands[] (nombres comerciales), folderId|null, presentations[] (una por línea),
//               regimens[] (pautas, ver REG_FIELDS), favorite, reviewed (false = «⚠ Pendiente de revisar»), reviewedAt,
//               importedAt, lastViewedAt (última consulta → «Recientes»), trashed, trashedAt, createdAt, updatedAt,
//               bodyAt (= drugBodies.updatedAt; 0 = sin notas), files[] (imágenes de «Mis notas»), links[] (notas
//               enlazadas desde «Mis notas»), size
//   drugBodies/{id}  { html, text, updatedAt }  «Mis notas» (el mismo editor de las notas). Solo se descarga al abrir
//               la ficha y solo si bodyAt > 0 (las fichas sin notas no gastan ninguna lectura).
//   drugFolders/{id} misma forma que folders (árbol propio: p. ej. Analgésicos › AINE).
//
// Regla (como en las notas): al cambiar «Mis notas», drugs.bodyAt y drugBodies.updatedAt reciben el mismo valor en el
// mismo lote. Un cuerpo en memoria está al día si su updatedAt ≥ bodyAt de la ficha.
import { getDoc, getDocs, query, where, documentId, writeBatch } from '../vendor/libs.js';
import { db } from './db.js';
import { store, ref, col, commitBatch } from './store.js';
import { norm } from './util.js';
import { regType, scopeKey, PREG_CATS } from './chuletario.js';

const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
const arr = (x) => (Array.isArray(x) ? x : []);

/** Campos de una pauta. line = texto para el informe retocado a mano (si lineAuto === false) */
export const REG_FIELDS = [
  ['indication', 'Indicación', 'Dolor agudo'], ['pres', 'Presentación', '25 mg comp'], ['route', 'Vía', 'VO'],
  ['dose', 'Dosis', '1 comp'], ['freq', 'Frecuencia', 'cada 8 h'], ['duration', 'Duración', '5 días'], ['max', 'Dosis máxima', '75 mg/día']
];
/** Campos calculados de la ficha (no van en la copia de seguridad: se recalculan al restaurar) */
export const DRUG_DERIVED = ['files', 'links', 'size', 'bodyAt'];

/** Línea para el tratamiento del informe, generada de los campos: «Dexketoprofeno 25 mg comp: 1 comp cada 8 h durante 5 días» */
/** ¿La pauta tiene campos detallados (vía, dosis, frecuencia…)? Si no, la línea sale del texto de la dosis (v1.22.0) */
export const hasDetail = (r = {}) => ['pres', 'route', 'dose', 'freq', 'duration', 'max'].some((k) => str(r[k]).trim());
export function genLine(name, r = {}) {
  if (!hasDetail(r) && str(r.text).trim()) return `${str(name).trim()}${str(name).trim() ? ': ' : ''}${str(r.text).trim().replace(/\s*\n\s*/g, ' ')}`;
  const head = [str(name).trim(), str(r.pres).trim()].filter(Boolean).join(' ');
  const dur = str(r.duration).trim();
  const parts = [r.dose, r.route, r.freq].map((x) => str(x).trim()).filter(Boolean);
  if (dur) parts.push(/^\d/.test(dur) ? `durante ${dur}` : dur);
  return head + (parts.length ? `${head ? ': ' : ''}${parts.join(' ')}` : '');
}
/** Texto que se copia (el retocado a mano, o el generado) */
export const lineOf = (name, r) => (r && r.lineAuto === false && str(r.line).trim() ? str(r.line).trim() : genLine(name, r));
/** Resumen de una pauta: «Dolor agudo · IV · 50 mg · cada 8 h · máx 150 mg/día» */
export function regSummary(r = {}) {
  return [r.route, r.dose, r.freq, r.duration, r.max ? `máx ${str(r.max).replace(/^m[aá]x(\.|imo|ima)?\s*/i, '')}` : '']
    .map((x) => str(x).trim()).filter(Boolean).join(' · ');
}

// ====================== Búsqueda ======================
const searchCache = new Map(); // id → { k, s }
/** Texto de búsqueda: principio activo, nombres comerciales, presentaciones e indicaciones (sin tildes ni mayúsculas) */
export function drugSearchText(d) {
  const k = `${d.updatedAt}|${d.name}|${(d.brands || []).length}`;
  const c = searchCache.get(d.id);
  if (c && c.k === k) return c.s;
  const s = norm([d.name, ...arr(d.brands), ...arr(d.presentations), ...arr(d.regimens).map((r) => r?.indication)].map(str).join('\n'));
  searchCache.set(d.id, { k, s });
  return s;
}
export const drugMatches = (d, words) => { const s = drugSearchText(d); return words.every((w) => s.includes(w)); };
/** Orden de los resultados: primero los que empiezan por lo buscado (principio activo y luego marca), después A-Z */
export function rankDrugs(list, words) {
  const w = words[0] || '';
  const score = (d) => (norm(d.name).startsWith(w) ? 0 : arr(d.brands).some((b) => norm(b).startsWith(w)) ? 1 : 2);
  return list.sort((a, b) => score(a) - score(b) || byName(a, b));
}
export const byName = (a, b) => str(a.name || 'Sin nombre').localeCompare(str(b.name || 'Sin nombre'), 'es', { sensitivity: 'base', numeric: true });
export const liveDrugs = () => [...store.drugs.values()].filter((d) => !d.trashed);
export const drugKey = (name) => norm(str(name)).replace(/\s+/g, ' ').trim();
/** Ficha (no eliminada) con ese principio activo, o null */
export function drugByName(name) {
  const k = drugKey(name);
  return k ? liveDrugs().find((d) => drugKey(d.name) === k) || null : null;
}

// ====================== «Mis notas» (drugBodies) ======================
/** Campos ligeros calculados a partir de «Mis notas» */
export function deriveDrugLight({ html = '' , text = '' }) {
  const files = new Set(), links = new Set();
  for (const m of str(html).matchAll(/data-file="([^"]+)"/g)) files.add(m[1]);
  for (const m of str(html).matchAll(/data-note="([^"]+)"/g)) links.add(m[1]);
  return { files: [...files], links: [...links], size: str(html).length + str(text).length };
}

const cache = new Map(); // id → { html, text, updatedAt }
const EMPTY = Object.freeze({ html: '', text: '', updatedAt: 0 });
/** «Mis notas» si ya está disponible y al día (o vacía), o null */
export function drugBodyOf(id) {
  const d = store.drugs.get(id);
  if (!d) return null;
  if (!(Number(d.bodyAt) > 0)) return EMPTY;
  const b = cache.get(id);
  return b && b.updatedAt >= d.bodyAt ? b : null;
}
const inflight = new Map();
/** Descarga «Mis notas» si hace falta (1 lectura). Sin conexión usa la copia del dispositivo (puede ir con stale: true). */
export function loadDrugBody(id) {
  const now = drugBodyOf(id);
  if (now) return Promise.resolve(now);
  if (inflight.has(id)) return inflight.get(id);
  const p = getDoc(ref('drugBodies', id)).then((snap) => {
    const fromServer = !snap.metadata.fromCache;
    if (fromServer) store.stats.bodyReads = (store.stats.bodyReads || 0) + 1;
    if (!snap.exists()) {
      if (!fromServer) throw new Error('offline');
      return EMPTY;
    }
    const x = snap.data();
    const b = { html: str(x.html), text: str(x.text), updatedAt: Number(x.updatedAt) || 0 };
    const cur = cache.get(id);
    if (!cur || cur.updatedAt <= b.updatedAt) cache.set(id, b);
    const d = store.drugs.get(id);
    return d && b.updatedAt < (d.bodyAt || 0) ? { ...b, stale: true } : b;
  }).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/**
 * Escribe una ficha: `light` = campos de drugs/{id} (merge); `body` = {html, text} de «Mis notas» o null.
 * Ficha y notas van en el mismo lote (también sin conexión: se suben solas).
 */
export function writeDrug(id, light, body = null, batch = writeBatch(db), { commit = true } = {}) {
  const data = { ...light };
  if (body) {
    const t = Math.max(Date.now(), (store.drugs.get(id)?.bodyAt || 0) + 1);
    const b = { html: str(body.html), text: str(body.text).slice(0, 30000), updatedAt: t };
    Object.assign(data, deriveDrugLight(b), { bodyAt: t });
    batch.set(ref('drugBodies', id), b);
    cache.set(id, b);
  }
  batch.set(ref('drugs', id), data, { merge: true });
  const d = store.drugs.get(id);
  if (d) Object.assign(d, data); else store.drugs.set(id, { id, ...data }); // reflejo inmediato
  return commit ? commitBatch(batch) : batch;
}

/** Borra una ficha y sus notas */
export function deleteDrugDocs(id) {
  const batch = writeBatch(db);
  batch.delete(ref('drugs', id));
  batch.delete(ref('drugBodies', id));
  store.drugs.delete(id);
  cache.delete(id);
  return commitBatch(batch);
}

/** Para la copia de seguridad: descarga todas las notas que falten (o lanza un error: nunca se exporta incompleto) */
export async function ensureAllDrugBodies() {
  const need = [...store.drugs.values()].filter((d) => !drugBodyOf(d.id)).map((d) => d.id);
  for (let i = 0; i < need.length; i += 30) {
    const ids = need.slice(i, i + 30);
    const snap = await getDocs(query(col('drugBodies'), where(documentId(), 'in', ids)));
    for (const s of snap.docs) {
      const x = s.data();
      cache.set(s.id, { html: str(x.html), text: str(x.text), updatedAt: Number(x.updatedAt) || 0 });
    }
  }
  const missing = [...store.drugs.values()].filter((d) => !drugBodyOf(d.id) && !cache.has(d.id));
  if (missing.length) throw new Error(`No se pudieron descargar las notas de ${missing.length} fármaco(s). Comprueba la conexión y vuelve a intentarlo.`);
}
/** Ficha completa (ligera + html/text de «Mis notas», sin campos calculados). Para copias y restaurar. */
export function fullDrug(d) {
  const b = drugBodyOf(d.id) || cache.get(d.id) || EMPTY;
  const rest = { ...d };
  for (const f of DRUG_DERIVED) delete rest[f];
  return { ...rest, html: b.html, text: b.text };
}
/** Tras restaurar: lo escrito ya está al día en memoria */
export function rememberDrugBody(id, b) { cache.set(id, { html: str(b.html), text: str(b.text), updatedAt: Number(b.updatedAt) || 0 }); }
export function clearDrugBodies() { cache.clear(); }

// ====================== Importar (JSON) ======================
// Se aceptan claves en inglés o en español (ver CLAUDE.md, «Vademécum»).
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; return null; };
const list = (x) => (Array.isArray(x) ? x : typeof x === 'string' ? x.split(/\r?\n|;/) : [])
  .map((v) => str(v).replace(/\s+/g, ' ').trim()).filter(Boolean);
const cut = (s, n) => str(s).replace(/\s+/g, ' ').trim().slice(0, n);

/** Una pauta de la importación → pauta de la app */
export function normRegimen(r, id) {
  if (!r || typeof r !== 'object') return null;
  const out = {
    id,
    indication: cut(pick(r, 'indication', 'indicacion', 'indicación'), 200),
    pres: cut(pick(r, 'presentation', 'pres', 'presentacion', 'presentación'), 120),
    route: cut(pick(r, 'route', 'via', 'vía'), 60),
    dose: cut(pick(r, 'dose', 'dosis'), 120),
    freq: cut(pick(r, 'frequency', 'freq', 'frecuencia'), 120),
    duration: cut(pick(r, 'duration', 'duracion', 'duración'), 120),
    max: cut(pick(r, 'max', 'maxDose', 'dosisMaxima', 'dosis_maxima', 'maxima', 'máxima'), 120),
    type: regType(pick(r, 'type', 'tipo', 'etiqueta')) || cut(pick(r, 'type', 'tipo', 'etiqueta'), 30),
    text: str(pick(r, 'text', 'texto', 'dosisTexto', 'dosis_texto', 'posologia', 'posología')).trim().slice(0, 1000)
  };
  const line = cut(pick(r, 'line', 'linea', 'línea', 'informe'), 500);
  out.lineAuto = !line;
  out.line = line;
  return Object.values(out).some((v, i) => i > 0 && v && typeof v === 'string') ? out : null;
}
export const regKey = (r) => norm([r.indication, r.route, r.dose, r.freq, r.text].map(str).join('|')).replace(/\s+/g, ' ');

/**
 * Lee el archivo de importación. Devuelve [{ name, brands, folder: [nombres], presentations, regimens, notes }]
 * o lanza un Error con el motivo. Acepta { format: 'drfolio-vademecum', drugs: [...] } o directamente una lista.
 */
export function parseDrugImport(text, newRegId) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('El archivo no es un JSON válido.'); }
  const items = Array.isArray(raw) ? raw : Array.isArray(raw?.drugs) ? raw.drugs : Array.isArray(raw?.farmacos) ? raw.farmacos : Array.isArray(raw?.fármacos) ? raw.fármacos : null;
  if (!items) throw new Error('No se encuentra la lista de fármacos («drugs»). Mira el formato en las instrucciones.');
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const name = cut(pick(it, 'name', 'nombre', 'principioActivo', 'principio_activo', 'principio activo'), 150);
    if (!name) continue;
    const folderRaw = pick(it, 'folder', 'carpeta', 'grupo', 'group');
    const folder = (Array.isArray(folderRaw) ? folderRaw.map(str) : str(folderRaw).split(/\s*(?:›|>|\/)\s*/))
      .map((f) => cut(f, 100)).filter(Boolean).slice(0, 8);
    const regs = arr(pick(it, 'regimens', 'pautas', 'posologia', 'posología')).map((r) => normRegimen(r, newRegId())).filter(Boolean).slice(0, 50);
    out.push({
      name,
      brands: list(pick(it, 'brands', 'marcas', 'nombresComerciales', 'nombres_comerciales', 'comerciales')).map((b) => b.slice(0, 80)).slice(0, 40),
      folder,
      presentations: list(pick(it, 'presentations', 'presentaciones')).map((p) => p.slice(0, 150)).slice(0, 60),
      regimens: regs,
      notes: str(pick(it, 'notes', 'notas', 'misNotas', 'mis_notas')).slice(0, 50000),
      ...extraFields(it)
    });
  }
  if (!out.length) throw new Error('El archivo no tiene ningún fármaco con nombre («name»).');
  return out;
}

/** Une listas sin repetir (sin tildes ni mayúsculas). Devuelve [lista, nº añadidos] */
export function mergeList(cur, add) {
  const seen = new Set(arr(cur).map((x) => norm(x).trim()));
  const outList = [...arr(cur)];
  let n = 0;
  for (const x of arr(add)) { const k = norm(x).trim(); if (k && !seen.has(k)) { seen.add(k); outList.push(x); n++; } }
  return [outList, n];
}

// ====================== Campos ampliados (v1.22.0) ======================
const CATS = PREG_CATS.map(([c]) => c).filter(Boolean);
/** Embarazo: «C», «Cat. C», {cat, note} / {categoria, nota} → { cat, note } */
export function normPregnancy(x) {
  if (!x) return { cat: '', note: '' };
  if (typeof x === 'string') {
    const m = x.match(/^\s*(?:cat(?:egor[ií]a)?\.?\s*)?([ABCDXN])\b/i);
    return m ? { cat: m[1].toUpperCase(), note: x.replace(m[0], '').replace(/^[\s:.\-–]+/, '').trim().slice(0, 3000) } : { cat: 'N', note: x.trim().slice(0, 3000) };
  }
  let cat = str(pick(x, 'cat', 'categoria', 'categoría', 'category')).trim().toUpperCase();
  if (/^(NOTA|PRECAUCION|PRECAUCIÓN)/.test(cat)) cat = 'N';
  return { cat: CATS.includes(cat) ? cat : '', note: str(pick(x, 'note', 'nota', 'texto', 'text')).trim().slice(0, 3000) };
}
export function normSource(x) {
  if (!x) return { text: '', url: '' };
  if (typeof x === 'string') { const u = x.match(/https?:\/\/\S+/); return { text: x.replace(u?.[0] || '', '').trim().slice(0, 200), url: u ? u[0] : '' }; }
  const url = str(pick(x, 'url', 'enlace', 'link')).trim();
  return { text: str(pick(x, 'text', 'texto', 'name', 'nombre')).trim().slice(0, 200), url: /^https?:\/\//i.test(url) ? url.slice(0, 500) : '' };
}
const lst = (x, n = 300) => list(x).map((v) => v.slice(0, n)).slice(0, 60);
/** Campos nuevos de una ficha importada (JSON) */
function extraFields(it) {
  return {
    pregnancy: normPregnancy(pick(it, 'pregnancy', 'embarazo')),
    fluids: lst(pick(it, 'fluids', 'sueros', 'suerosCompatibles', 'sueros_compatibles'), 40),
    observations: lst(pick(it, 'observations', 'observaciones')),
    contraindications: lst(pick(it, 'contraindications', 'contraindicaciones')),
    compat: lst(pick(it, 'compat', 'compatibility', 'compatibilidad', 'ySite', 'compatibilidadY')),
    scopes: [...new Set(list(pick(it, 'scopes', 'scope', 'ambito', 'ámbito', 'ambitos', 'ámbitos')).map(scopeKey).filter(Boolean))],
    source: normSource(pick(it, 'source', 'fuente'))
  };
}
/** Campos de lista ampliados (para unir sin repetir) */
export const EXTRA_LISTS = ['fluids', 'observations', 'contraindications', 'compat', 'scopes'];
