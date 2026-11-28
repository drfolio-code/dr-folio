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
import { getDoc, getDocs, query, where, documentId, writeBatch, doc } from '../vendor/libs.js';
import { db } from './db.js';
import { store, ref, col, commitBatch } from './store.js';
import { norm } from './util.js';
import { regType, scopeKey } from './chuletario.js';
import { normResources, mergeResources, resSearchText } from './drugres.js';
import { pedLine, normCalc, regCalcLine, calcDesc } from './drugped.js';

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
export const hasDetail = (r = {}) => ['pres', 'route', 'dose', 'freq', 'duration', 'max', 'perKg'].some((k) => str(r[k]).trim());
export function genLine(name, r = {}) {
  // v1.36.0: pauta solo con «Cálculo por peso» → «Amoxicilina: 80 mg/kg/día cada 8 h»
  if (!hasDetail(r) && !str(r.text).trim() && normCalc(r.calc)) return `${str(name).trim()}${str(name).trim() ? ': ' : ''}${calcDesc(normCalc(r.calc))}`;
  if (!hasDetail(r) && str(r.text).trim()) return `${str(name).trim()}${str(name).trim() ? ': ' : ''}${str(r.text).trim().replace(/\s*\n\s*/g, ' ')}`;
  const head = [str(name).trim(), str(r.pres).trim()].filter(Boolean).join(' ');
  const dur = str(r.duration).trim();
  // v1.32.0: pauta pediátrica sin dosis escrita → «15 mg/kg»
  const perKg = !str(r.dose).trim() && str(r.perKg).trim() ? `${str(r.perKg).trim()} ${str(r.perKgUnit).trim() || 'mg'}/kg` : '';
  const parts = [r.dose || perKg, r.route, r.freq].map((x) => str(x).trim()).filter(Boolean);
  if (dur) parts.push(/^\d/.test(dur) ? `durante ${dur}` : dur);
  return head + (parts.length ? `${head ? ': ' : ''}${parts.join(' ')}` : '');
}
/** Texto que se copia (el retocado a mano, o el generado) */
/** kg (v1.32.0, pediátrico): con peso y pauta por kg, la línea lleva la dosis calculada */
export const lineOf = (name, r, kg = 0, pres = []) => (kg && (regCalcLine(name, r, kg, pres) || pedLine(name, r, kg))) || (r && r.lineAuto === false && str(r.line).trim() ? str(r.line).trim() : genLine(name, r));
/** Resumen de una pauta: «Dolor agudo · IV · 50 mg · cada 8 h · máx 150 mg/día» */
export function regSummary(r = {}) {
  return [r.route, r.dose, r.freq, r.duration, r.max ? `máx ${str(r.max).replace(/^m[aá]x(\.|imo|ima)?\s*/i, '')}` : '']
    .map((x) => str(x).trim()).filter(Boolean).join(' · ');
}

// ====================== Búsqueda ======================
const searchCache = new Map(); // id → { k, s }
/** Texto de búsqueda: principio activo, nombres comerciales, presentaciones, indicaciones y enlaces (título, nota, año; v1.27.0) */
export function drugSearchText(d) {
  const tagNames = arr(d.tags).map((t) => store.drugTags?.get(t)?.name).filter(Boolean);
  const k = `${d.updatedAt}|${d.name}|${(d.brands || []).length}|${(d.resources || []).length}|${tagNames.join(',')}`;
  const c = searchCache.get(d.id);
  if (c && c.k === k) return c.s;
  const s = norm([d.name, ...arr(d.brands), ...arr(d.presentations), ...arr(d.regimens).map((r) => r?.indication), resSearchText(d.resources), ...tagNames].map(str).join('\n'));
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
// v1.32.0: perfil Adulto | Pediátrico (por dispositivo). Cada perfil es un vademécum aparte (fichas, carpetas, etiquetas).
export const drugProfile = () => (localStorage.getItem('drfolio.drugProfile') === 'ped' ? 'ped' : 'adult');
export function setDrugProfile(p) { try { localStorage.setItem('drfolio.drugProfile', p === 'ped' ? 'ped' : 'adult'); } catch { /* nada */ } }
/** Fichas no eliminadas del perfil (por defecto, el activo; 'all' = las dos) */
export const liveDrugs = (profile = drugProfile()) => [...store.drugs.values()].filter((d) => !d.trashed && (profile === 'all' || profOf(d) === profile));
/** Vista de un Map de carpetas/etiquetas solo con las del perfil activo: get/has/set van al Map completo */
export function profileView(map) {
  const ok = (x) => profOf(x) === drugProfile();
  return {
    get: (k) => map.get(k), has: (k) => map.has(k), set: (k, v) => map.set(k, v), delete: (k) => map.delete(k),
    *values() { for (const v of map.values()) if (ok(v)) yield v; },
    *keys() { for (const [k, v] of map) if (ok(v)) yield k; },
    *entries() { for (const e of map) if (ok(e[1])) yield e; },
    [Symbol.iterator]() { return this.entries(); },
    forEach(f) { for (const [k, v] of map) if (ok(v)) f(v, k, this); },
    get size() { let n = 0; for (const v of map.values()) if (ok(v)) n++; return n; }
  };
}
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
  // v1.31.0: el ámbito (scopes, de importar/pegar) se guarda como etiquetas; se conservan las etiquetas propias
  if (Array.isArray(data.scopes) && !('tags' in data)) data.tags = scopesToTags(store.drugs.get(id)?.tags, data.scopes, data.profile || store.drugs.get(id)?.profile, batch);
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

// ====================== Etiquetas (v1.31.0) ======================
// drugTags/{id} {name, color, order, profile, createdAt}; en cada ficha tags[] (ids). Las del ámbito antiguo tienen id fijo
// (así varios dispositivos crean la misma y no se duplican): tag-ap, tag-urg, tag-mont (pediátrico: ptag-…).
export const DEFAULT_TAGS = [['ap', 'Atención Primaria', '#16a34a'], ['urg', 'Urgencias', '#dc2626'], ['mont', 'Montaña', '#2563eb']];
export const profOf = (x) => (x?.profile === 'ped' ? 'ped' : 'adult');
export const scopeTagId = (k, profile) => `${profile === 'ped' ? 'ptag' : 'tag'}-${k}`;
/** Crea (en el lote) la etiqueta por defecto si no existe. Devuelve su id. */
export function ensureScopeTag(k, profile, batch) {
  const id = scopeTagId(k, profile);
  if (!store.drugTags.has(id)) {
    const [, name, color] = DEFAULT_TAGS.find((t) => t[0] === k) || [k, k, null];
    const data = { name, color, order: DEFAULT_TAGS.findIndex((t) => t[0] === k), profile: profile === 'ped' ? 'ped' : 'adult', createdAt: Date.now() };
    store.drugTags.set(id, { id, ...data });
    batch.set(ref('drugTags', id), data);
  }
  return id;
}
/** Etiquetas de una ficha a partir del ámbito: las propias se quedan; las del ámbito siguen a `scopes` */
export function scopesToTags(cur, scopes, profile, batch) {
  const auto = new Set(DEFAULT_TAGS.map(([k]) => scopeTagId(k, profile)));
  const keep = arr(cur).filter((t) => !auto.has(t));
  return [...keep, ...arr(scopes).filter((k) => DEFAULT_TAGS.some((t) => t[0] === k)).map((k) => ensureScopeTag(k, profile, batch))];
}

/** Ids de las etiquetas con esos nombres (sin tildes/mayúsculas); las que no existen se crean en el lote */
export function tagIdsByName(names, profile, batch) {
  const p = profile === 'ped' ? 'ped' : 'adult';
  const out = [];
  for (const name of arr(names)) {
    const k = norm(name).trim();
    if (!k) continue;
    let t = [...store.drugTags.values()].find((x) => profOf(x) === p && norm(x.name).trim() === k);
    if (!t) {
      const sk = DEFAULT_TAGS.find(([, n]) => norm(n) === k || (k === 'rescate' || k === 'rescate de montana' ? n === 'Montaña' : false));
      if (sk) { out.push(ensureScopeTag(sk[0], p, batch)); continue; }
      const id = doc(col('drugTags')).id;
      const data = { name: str(name).slice(0, 40), color: null, order: 100 + store.drugTags.size, profile: p, createdAt: Date.now() };
      store.drugTags.set(id, { id, ...data });
      batch.set(ref('drugTags', id), data);
      t = { id };
    }
    if (!out.includes(t.id)) out.push(t.id);
  }
  return out;
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
  // v1.32.0: pauta pediátrica por kg (opcional)
  const pk = cut(pick(r, 'perKg', 'porKg', 'dosisKg', 'dosisPorKg'), 20);
  if (pk) { out.perKg = pk; out.perKgUnit = cut(pick(r, 'perKgUnit', 'unidadKg', 'unidad'), 10) || 'mg'; }
  // v1.36.0: cálculo por peso (calc / calculo)
  const cc = normCalc(r.calc || r.calculo);
  if (cc) out.calc = cc;
  const line = cut(pick(r, 'line', 'linea', 'línea', 'informe'), 500);
  out.lineAuto = !line;
  out.line = line;
  return Object.values(out).some((v, i) => i > 0 && v && typeof v === 'string') ? out : null;
}
export const regKey = (r) => norm([r.indication, r.route, r.dose, r.freq, r.text, r.perKg].map(str).join('|')).replace(/\s+/g, ' ');

/**
 * Lee el archivo de importación. Devuelve [{ name, brands, folder: [nombres], presentations, regimens, notes }]
 * o lanza un Error con el motivo. Acepta { format: 'drfolio-vademecum', drugs: [...] } o directamente una lista.
 */
/** Texto plano de un HTML sencillo (sin DOM): para buscar y para «Mis notas» importadas con formato */
function htmlPlain(h) {
  return str(h).replace(/<\/(p|h[1-6]|li|div)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/\n{2,}/g, '\n').trim();
}
/** Tablas (imágenes) del JSON de importación: [{title, key, image: 'data:image/png;base64,…'}] */
function normImportTables(x) {
  return arr(x).filter((t) => t && typeof t === 'object').map((t) => {
    const data = str(t.image || t.imagen || t.data);
    const m = data.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/);
    if (!m) return null;
    const title = cut(t.title || t.titulo || t.título || 'Tabla por peso', 150);
    return { title, key: cut(t.key || t.clave || title, 200), mime: m[1], b64: m[2].replace(/\s+/g, ''), source: normSource(t.source || t.fuente) };
  }).filter(Boolean).slice(0, 12);
}
/** Tablas guardadas de una ficha: [{id, fileId, title, key, source, w, h}] */
export const tablesOf = (d) => arr(d?.tables).filter((t) => t && typeof t.fileId === 'string');

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
      ...presFields(pick(it, 'presentations', 'presentaciones')),
      regimens: regs,
      notes: str(pick(it, 'notes', 'notas', 'misNotas', 'mis_notas')).slice(0, 50000)
        || htmlPlain(pick(it, 'notesHtml', 'notasHtml')).slice(0, 50000),
      notesHtml: str(pick(it, 'notesHtml', 'notasHtml')).slice(0, 400000), // v1.33.0: «Mis notas» con formato (se sanea al escribir)
      profile: /^p(ed|edi[aá]trico)$/i.test(str(pick(it, 'profile', 'perfil')).trim()) ? 'ped' : '',
      ...extraFields(it),
      // v1.27.0: enlaces y bibliografía (objetos o URL sueltas; sin indicación: regId no se importa)
      resources: normResources(pick(it, 'resources', 'enlaces', 'bibliografia', 'bibliografía', 'links'), () => `r${newRegId()}`, { withReg: false })
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
    fluids: lst(pick(it, 'fluids', 'sueros', 'suerosCompatibles', 'sueros_compatibles'), 40),
    observations: lst(pick(it, 'observations', 'observaciones')),
    contraindications: lst(pick(it, 'contraindications', 'contraindicaciones')),
    compat: lst(pick(it, 'compat', 'compatibility', 'compatibilidad', 'ySite', 'compatibilidadY')),
    scopes: [...new Set(list(pick(it, 'scopes', 'scope', 'ambito', 'ámbito', 'ambitos', 'ámbitos')).map(scopeKey).filter(Boolean))],
    source: normSource(pick(it, 'source', 'fuente')),
    tables: normImportTables(pick(it, 'tables', 'tablas')), // v1.33.0: imágenes (tablas por peso) en data:image/…;base64
    tagNames: [...new Set(list(pick(it, 'tags', 'etiquetas')).map((x) => str(x).replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean))], // v1.31.0
    // v1.34.3: actualización de un archivo ya importado (p. ej. Guía de Aragón v2): presentaciones de antes, para saber si las has cambiado
    guideUpdate: Number(pick(it, 'guideUpdate')) || 0,
    presOld: list(pick(it, 'presOld')).map((x) => str(x).replace(/\s+/g, ' ').trim())
  };
}
/** Campos de lista ampliados (para unir sin repetir) */
export const EXTRA_LISTS = ['fluids', 'observations', 'contraindications', 'compat', 'scopes'];

/** Marcas de una presentación (v1.23.0): drugs.presBrands = [{ p: '37,5/325 mg comp', b: ['Zaldiar', 'Pazital'] }] */
export function presBrandsOf(d, pres) {
  const k = norm(str(pres)).replace(/\s+/g, ' ').trim();
  if (!k) return [];
  const x = arr(d?.presBrands).find((e) => norm(str(e?.p)).replace(/\s+/g, ' ').trim() === k);
  return arr(x?.b).filter((b) => typeof b === 'string' && b.trim());
}
/** Presentaciones del JSON: texto, o { text|presentation|presentacion, brands|marcas } → { presentations, presBrands } */
function presFields(raw) {
  const presentations = [], presBrands = [];
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n|;/) : [];
  for (const x of items) {
    if (x && typeof x === 'object') {
      const t = cut(pick(x, 'text', 'texto', 'presentation', 'presentacion', 'presentación', 'name', 'nombre'), 150);
      if (!t) continue;
      presentations.push(t);
      const b = list(pick(x, 'brands', 'marcas', 'brand', 'marca')).map((v) => v.slice(0, 80));
      if (b.length) presBrands.push({ p: t, b });
    } else { const t = cut(x, 150); if (t) presentations.push(t); }
  }
  return { presentations: presentations.slice(0, 60), presBrands: presBrands.slice(0, 60) };
}

// ====================== Mismo principio activo (v1.24.0) ======================
// «Fentanilo» y «Fentanilo transdérmico», «Glucosa 5%» y «Glucosa hipertónica»… son el mismo principio activo:
// una sola ficha, con la forma en la presentación y en la indicación. Las combinaciones («A/B») son otro fármaco.
const FORM_WORDS = new Set(['transdermico', 'transdermica', 'autoinyector', 'autoinyectable', 'topico', 'topica', 'vaginal', 'otico', 'otica',
  'oftalmico', 'oftalmica', 'colirio', 'nasal', 'rectal', 'depot', 'valerato', 'aceponato', 'retard', 'oral', 'inyectable', 'iv', 'im',
  'crema', 'gel', 'pomada', 'spray', 'inhalado', 'inhalada', 'nebulizado', 'nebulizada', 'hipertonica', 'hipertonico', 'isotonica',
  'sublingual', 'parche', 'parches', 'intranasal', 'bucal', 'jarabe', 'gotas', 'solucion', 'ampollas', 'comprimidos', 'capsulas', 'supositorios']);
const tokens = (name) => str(name).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
const isForm = (t) => FORM_WORDS.has(norm(t)) || /^\d+(?:[.,]\d+)?\s*%$/.test(t);
/** Nº de palabras del principio activo (lo que queda al quitar del final la forma, la vía o el %) */
function baseLen(name) {
  const t = tokens(name);
  let n = t.length;
  while (n > 1 && isForm(t[n - 1])) n--;
  return n;
}
/** Clave del principio activo: «Fentanilo transdérmico» → «fentanilo» · «Cloruro sódico 0,9%» → «cloruro sodico» */
export const baseKey = (name) => drugKey(tokens(name).slice(0, baseLen(name)).join(' '));
/** Nombre del principio activo con sus mayúsculas: «Glucosa hipertónica» → «Glucosa» */
export const baseName = (name) => tokens(name).slice(0, baseLen(name)).join(' ');
/** La forma que sobra: «Fentanilo transdérmico» → «transdérmico» */
export const formOf = (name) => tokens(name).slice(baseLen(name)).join(' ');

/** Grupos de fichas (no en la papelera) con el mismo principio activo: [{ key, name, items: [fichas] }] */
export function duplicateGroups(drugs = liveDrugs()) {
  const m = new Map();
  for (const d of drugs) {
    const k = baseKey(d.name);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(d);
  }
  return [...m.entries()].filter(([, v]) => v.length > 1).map(([key, items]) => {
    const exact = items.find((d) => drugKey(d.name) === key);
    // La que se queda: la que se llama justo como el principio activo; si no, la que tiene más pautas
    const keep = exact || [...items].sort((a, b) => (b.regimens || []).length - (a.regimens || []).length)[0];
    return { key, name: exact ? exact.name : baseName(keep.name), keep, items: [keep, ...items.filter((d) => d !== keep)] };
  });
}
/** Presentaciones iguales aunque se escriban distinto (mcg = µg, ml = mL, espacios) */
const presKey = (p) => norm(str(p)).replace(/mcg/g, 'µg').replace(/\s+/g, '').replace(/\.$/, '');
export function mergePres(cur, add) {
  const seen = new Set(arr(cur).map(presKey));
  const out = [...arr(cur)];
  for (const p of arr(add)) { const k = presKey(p); if (k && !seen.has(k)) { seen.add(k); out.push(p); } }
  return out;
}
/**
 * Ficha resultante de unir un grupo (no escribe nada). Las pautas de las otras fichas llevan su forma en la
 * indicación si no la dicen ya («Dolor crónico · transdérmico»). Devuelve { light, others, notesFrom }.
 */
export function mergeGroupLight(g, newRegId) {
  const keep = g.keep;
  const light = {
    name: g.name, brands: [...arr(keep.brands)], presentations: [...arr(keep.presentations)], regimens: [...arr(keep.regimens)],
    presBrands: arr(keep.presBrands).map((e) => ({ p: e.p, b: [...arr(e.b)] })), favorite: g.items.some((d) => d.favorite),
    ...(g.items.some((d) => Array.isArray(d.tags)) ? { tags: [...new Set(g.items.flatMap((d) => arr(d.tags)))] } : {}),
    reviewed: g.items.every((d) => d.reviewed !== false), source: keep.source || null,
    resources: arr(keep.resources).map((r) => ({ ...r }))
  };
  for (const f of EXTRA_LISTS) light[f] = [...arr(keep[f])];
  const ids = new Set(light.regimens.map((r) => r.id));
  const keys = new Set(light.regimens.map(regKey));
  for (const d of g.items.slice(1)) {
    const form = formOf(d.name);
    light.brands = mergeList(light.brands, d.brands)[0];
    light.presentations = mergePres(light.presentations, d.presentations);
    for (const f of EXTRA_LISTS) light[f] = mergeList(light[f], d[f])[0];
    for (const e of arr(d.presBrands)) {
      const cur = light.presBrands.find((x) => presKey(x.p) === presKey(e.p));
      if (cur) cur.b = mergeList(cur.b, e.b)[0]; else light.presBrands.push({ p: e.p, b: [...arr(e.b)] });
    }
    if (!light.source?.text && !light.source?.url && (d.source?.text || d.source?.url)) light.source = { ...d.source };
    const regMap = {}; // pauta de esta ficha → pauta de la que se queda (para los enlaces unidos a una indicación)
    for (const r0 of arr(d.regimens)) {
      const r = { ...r0 };
      const said = norm([r.indication, r.route, r.pres, r.text].map(str).join(' '));
      if (form && !said.includes(norm(form).slice(0, 7))) r.indication = r.indication ? `${r.indication} · ${form}` : form;
      if (keys.has(regKey(r))) { const same = light.regimens.find((x) => regKey(x) === regKey(r)); if (same && r0.id) regMap[r0.id] = same.id; continue; }
      if (!r.id || ids.has(r.id)) r.id = newRegId();
      if (r0.id) regMap[r0.id] = r.id;
      ids.add(r.id); keys.add(regKey(r));
      light.regimens.push(r);
    }
    light.resources = mergeResources(light.resources, d.resources, { regMap })[0];
  }
  if (!light.resources.length) delete light.resources;
  if (!light.source) delete light.source;
  return { light, others: g.items.slice(1), notesFrom: g.items.filter((d) => d.bodyAt > 0) };
}
/** Ficha que ya existe con ese principio activo (la de nombre exacto primero) */
export function drugByBase(name) {
  const k = baseKey(name);
  if (!k) return null;
  const all = liveDrugs().filter((d) => baseKey(d.name) === k);
  return all.find((d) => drugKey(d.name) === drugKey(name)) || all.find((d) => drugKey(d.name) === k) || all[0] || null;
}
/** Pautas que vienen de «Fentanilo transdérmico» al unirse a «Fentanilo»: la forma va en la indicación */
export function withForm(regs, fromName, toName) {
  const form = formOf(fromName);
  if (!form || drugKey(fromName) === drugKey(toName)) return regs;
  return arr(regs).map((r) => {
    const said = norm([r.indication, r.route, r.pres, r.text].map(str).join(' '));
    return said.includes(norm(form).slice(0, 7)) ? r : { ...r, indication: r.indication ? `${r.indication} · ${form}` : form };
  });
}

// ====================== Presentaciones por vía de administración (v1.26.0) ======================
// La vía sale de la forma (comp, colirio, parche…) y, en ampollas, viales, jeringas y sueros, de las indicaciones que
// usan esa presentación (IV, IM, SC…); si ninguna la usa, de todas las indicaciones inyectables de la ficha.
const INJ_LABEL = { IV: 'Intravenosa (IV)', IM: 'Intramuscular (IM)', SC: 'Subcutánea (SC)' };
export const PRES_GROUPS = ['Oral', 'Sublingual', 'Intravenosa (IV)', 'IV / IM', 'IV / SC', 'IV / IM / SC', 'Intramuscular (IM)', 'IM / SC',
  'Subcutánea (SC)', 'Inyectable', 'Infiltración', 'Intraarticular', 'Inhalada', 'Nebulizada', 'Intranasal', 'Tópica', 'Oftálmica', 'Ótica',
  'Vaginal', 'Rectal', 'Transdérmica', 'Gas medicinal', 'Otras'];
const FORM_RULES = [
  [/colirio|oftalm/, 'Oftálmica'], [/otic|oido/, 'Ótica'], [/vaginal|ovulo/, 'Vaginal'],
  [/supositorio|\bsup\b|rectal|microenema|enema/, 'Rectal'], [/parche|transderm|aposito/, 'Transdérmica'],
  [/nebuliz/, 'Nebulizada'], [/spray nasal|polvo nasal|nasal|intranasal/, 'Intranasal'],
  [/sublingual|\bsl\b/, 'Sublingual'],
  [/inh\b|aerosol|turbuhaler|accuhaler|ellipta|respimat|nexthaler|breezhaler|inhalacion|inhalador/, 'Inhalada'],
  [/bala|gas medicinal|\bgas\b|concentrador|gafas nasales|mascarilla/, 'Gas medicinal'],
  [/crema|pomada|\bgel\b|locion|champu|laca|polvo|unguento|\d% solucion|solucion acuosa|colutorio|para chupar|spray|apli/, 'Tópica'],
  [/\bcomp|caps|capsula|sobre|jarabe|suspension|\bsusp\b|\boral\b|grageas|liotab|bucodispers|chicle|gotas|solucion|bebible|masticable|granulado|frasco|\bvo\b/, 'Oral']
];
const INJ_RE = /\bamp\b|ampolla(?! bebible)|vial|\bjer\b|jeringa|pluma|flexpen|kwikpen|solostar|flextouch|autoinyector|bolsa|^[\d.,]+\s*ml$|\d% [\d.,]+ ml$/;
function routeKinds(r) {
  const t = norm([r.type, r.route].map(str).join(' '));
  const k = new Set();
  if (/\biv\b|bolo|perfus|intraven|\bio\b/.test(t)) k.add('IV');
  if (/\bim\b|intramusc/.test(t)) k.add('IM');
  if (/\bsc\b|subcut/.test(t) && !/infiltr/.test(t)) k.add('SC');
  if (/infiltr|bloqueo/.test(t)) k.add('INF');
  if (/intraarticular/.test(t)) k.add('IA');
  if (/nebuliz/.test(t)) k.add('NEB');
  if (/intranasal/.test(t)) k.add('IN');
  return k;
}
function injLabel(k) {
  if (k.has('IA')) return 'Intraarticular';
  if (k.has('INF') && !k.has('IV')) return 'Infiltración';
  if (k.has('NEB') && !k.has('IV') && !k.has('IM')) return 'Nebulizada';
  const v = ['IV', 'IM', 'SC'].filter((x) => k.has(x));
  if (!v.length) return k.has('IN') ? 'Intranasal' : '';
  return v.length === 1 ? INJ_LABEL[v[0]] : v.join(' / ');
}
/** Vía de administración de una presentación (uno de PRES_GROUPS) */
export function presGroup(d, pres) {
  const ov = presInfoOf(d, pres).g; // v1.39.2: vía elegida a mano
  if (ov) return ov;
  const p = norm(str(pres)).trim();
  if (!INJ_RE.test(p)) {
    for (const [re, g] of FORM_RULES) if (re.test(p)) return g;
  }
  const pk = p.replace(/\s+/g, '');
  const own = new Set(), all = new Set();
  for (const r of arr(d?.regimens)) {
    const k = routeKinds(r || {});
    for (const x of k) all.add(x);
    if (norm(str(r?.pres)).replace(/\s+/g, '') === pk) for (const x of k) own.add(x);
  }
  if (/autoinyector/.test(p)) return 'Intramuscular (IM)';
  if (/pluma|flexpen|kwikpen|solostar|flextouch|\bjer\b|jeringa/.test(p) && !own.size) return 'Subcutánea (SC)';
  if (INJ_RE.test(p) || /\bml\b/.test(p)) {
    if (/nebuliz/.test(p)) return 'Nebulizada';
    const l = injLabel(own) || (/\biv\b|perfus/.test(p) ? INJ_LABEL.IV : /\bim\b/.test(p) ? INJ_LABEL.IM : '') || injLabel(all);
    return l || 'Inyectable';
  }
  return 'Otras';
}
// v1.39.1: dentro de cada vía, por forma (Líquidos · Comprimidos · Cápsulas · Sobres…) y de menor a mayor dosis.
// La primera forma que aparece en el texto manda («1 g comp., comp. efervescentes, sobres» → Comprimidos).
const FORM_KINDS = [
  ['Gotas', /\bgotas\b/],
  ['Jarabe, solución y suspensión', /jarabe|\bsol\b|solucion|\bsusp\b|suspension|elixir|\d\s*(mg|mcg|µg|g|ui)\s*\/\s*\d*\s*ml|ampollas? bebibles?|viales? bebibles?|bebible/],
  ['Comprimidos', /\bcomp\b|comprimid|tableta|gragea|liotab|\bbucodispers/],
  ['Cápsulas', /\bcaps\b|capsula|perla/],
  ['Sobres y granulado', /\bsobres?\b|granulado|polvo para|\bstick/],
  ['Supositorios', /\bsup\b|supositorio/],
  ['Enemas', /enema|canula rectal/],
  ['Ampollas', /\bamp\b|ampolla/],
  ['Viales', /\bvial/],
  ['Jeringas y plumas', /\bjer\b|jeringa|pluma|flexpen|kwikpen|solostar|flextouch|autoinyector/],
  ['Sueros y bolsas', /bolsa|\bfrasco\b.*ml|^[\d.,]+\s*ml$|\d% [\d.,]+ ml$/],
  ['Inhaladores', /inhalador|turbuhaler|accuhaler|ellipta|respimat|nexthaler|breezhaler|aerosol|\binh\b|polvo para inhal/],
  ['Nebulización', /nebuliz/],
  ['Cremas, pomadas y geles', /crema|pomada|\bgel\b|unguento/],
  ['Lociones, sprays y otros', /locion|champu|spray|solucion cutanea|colutorio|laca|apositos?|parche/],
  ['Colirios', /colirio/]
];
const VARIANTS = [/bucodispers|liotab|flas/, /eferves/, /mastica/, /liberaci|retard|\bprolongad|\bmodificad|\bretardad/, /gastrorresist|recubiert/];
export const FORM_LABELS = FORM_KINDS.map(([l]) => l);
/** v1.39.2: vía y forma elegidas a mano para una presentación: drugs.presInfo = [{ p, g (vía de PRES_GROUPS), f (forma de FORM_LABELS) }] */
export function presInfoOf(d, pres) {
  const k = norm(str(pres)).replace(/\s+/g, ' ').trim();
  const x = arr(d?.presInfo).find((e) => norm(str(e?.p)).replace(/\s+/g, ' ').trim() === k);
  return { g: PRES_GROUPS.includes(x?.g) ? x.g : '', f: FORM_LABELS.includes(x?.f) || x?.f === 'Otras' ? x.f : '' };
}
/** Forma de una presentación: { label, order } (order = posición en FORM_KINDS; 99 si no se sabe) */
export function presKind(p) {
  const t = norm(str(p));
  let best = null;
  for (const [i, [label, re]] of FORM_KINDS.entries()) {
    const m = t.match(re);
    if (m && (!best || m.index < best.at)) best = { label, order: i, at: m.index };
  }
  return best ? { label: best.label, order: best.order } : { label: 'Otras', order: 99 };
}
/** Dosis de una presentación en mg (o en su unidad) para ordenar: «1 g comp» → 1000 · «100 mg/ml» → 100 · «250 mg/5 ml» → 50 */
export function presAmount(p) {
  const t = str(p).replace(/(\d)\.(\d{3})\b/g, '$1$2');
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|μg|g|ui|mEq|mmol|%)?(?:\s*\/\s*(\d+(?:[.,]\d+)?)?\s*ml)?/i);
  if (!m) return Infinity;
  let v = Number(m[1].replace(',', '.'));
  const u = (m[2] || '').toLowerCase();
  if (u === 'g') v *= 1000; else if (u === 'mcg' || u === 'µg' || u === 'μg') v /= 1000;
  if (m[3]) v /= Number(m[3].replace(',', '.')) || 1;
  return v;
}
const variantOf = (p) => { const t = norm(str(p).split(',')[0]); const i = VARIANTS.findIndex((re) => re.test(t)); return i < 0 ? 0 : i + 1; };
/** Presentaciones de una vía en subgrupos por forma, cada uno de menor a mayor dosis (las normales antes que
 *  bucodispersables, efervescentes, masticables o de liberación prolongada): [{ label, items }] */
export function presSubgroups(items, d = null) {
  const m = new Map();
  for (const p of arr(items)) {
    const f = presInfoOf(d, p).f;
    const k = f ? { label: f, order: f === 'Otras' ? 99 : FORM_LABELS.indexOf(f) } : presKind(p);
    if (!m.has(k.label)) m.set(k.label, { label: k.label, order: k.order, items: [] });
    m.get(k.label).items.push(p);
  }
  const out = [...m.values()].sort((a, b) => a.order - b.order);
  for (const g of out) g.items = g.items.map((p, i) => ({ p, i, v: variantOf(p), a: presAmount(p) }))
    .sort((x, y) => x.v - y.v || x.a - y.a || x.i - y.i).map((x) => x.p);
  return out.map(({ label, items }) => ({ label, items }));
}
/** Presentaciones agrupadas por vía: [{ group, items: [texto] }] en el orden de PRES_GROUPS */
export function presByGroup(d) {
  const m = new Map();
  for (const p of arr(d?.presentations)) {
    const g = presGroup(d, p);
    if (!m.has(g)) m.set(g, []);
    m.get(g).push(p);
  }
  // «Otras» sola junto a un único grupo → va con ese grupo (p. ej. «monodosis» de un colirio)
  if (m.has('Otras') && m.size === 2) { const g = [...m.keys()].find((x) => x !== 'Otras'); m.get(g).push(...m.get('Otras')); m.delete('Otras'); }
  return PRES_GROUPS.filter((g) => m.has(g)).map((g) => ({ group: g, items: m.get(g) }));
}
