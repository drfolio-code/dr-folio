// Vademécum v1.27.0: «Enlaces y bibliografía» de las fichas (drugs/{id}.resources) y de las carpetas
// (drugFolders/{id}.resources). Sin DOM ni Firebase (se prueba con node).
//
//   resources = [{ id, title, url, kind, note, year, regId?, fileId?, fileName?, fileSize?, createdAt }]
//     kind   'calc' (calculadora) | 'biblio' (artículo / guía) | 'ft' (ficha técnica) | 'web' (otro)
//     url    solo http/https ('' si es un PDF adjunto sin enlace)
//     year   texto corto opcional («2024», «SEEN 2023»)
//     regId  (solo en fichas) indicación a la que va unido; si la pauta ya no existe se ignora y se quita al guardar
//     fileId PDF adjunto en files/ (con drugId o drugFolderId)
// Texto plano siempre: nunca se guarda HTML.
import { norm } from './util.js';

const str = (x) => (typeof x === 'string' ? x : x == null ? '' : String(x));
const arr = (x) => (Array.isArray(x) ? x : []);
const cut = (s, n) => str(s).replace(/\s+/g, ' ').trim().slice(0, n);

/** [kind, título del grupo, icono, nombre en el selector] en el orden en que se muestran */
export const RES_KINDS = [
  ['calc', 'Calculadoras', 'calculator', 'Calculadora'],
  ['biblio', 'Bibliografía', 'book-open', 'Artículo / guía'],
  ['ft', 'Ficha técnica', 'file-text', 'Ficha técnica'],
  ['web', 'Otros', 'link', 'Otro']
];
const KIND_SET = new Set(RES_KINDS.map((k) => k[0]));
export const kindIcon = (k) => (RES_KINDS.find((x) => x[0] === k) || RES_KINDS[3])[2];
export const kindName = (k) => (RES_KINDS.find((x) => x[0] === k) || RES_KINDS[3])[3];
/** Tipo del JSON (inglés o español) → kind */
export function kindKey(x) {
  const k = norm(str(x)).trim();
  if (!k) return '';
  if (KIND_SET.has(k)) return k;
  if (/calc|escala|score/.test(k)) return 'calc';
  if (/ficha|tecnica|cima|\bft\b|smpc|prospecto/.test(k)) return 'ft';
  if (/biblio|articul|guia|guide|paper|revision|review|protocolo|consenso|doc/.test(k)) return 'biblio';
  return 'web';
}

/** URL válida (http/https) o ''. «cima.aemps.es/…» → «https://cima.aemps.es/…» */
export function cleanUrl(u) {
  let s = str(u).trim().replace(/\s+/g, '');
  if (!s) return '';
  if (/^www\.|^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(s) && !/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  if (!/^https?:\/\//i.test(s)) return '';
  try { const x = new URL(s); if (!/^https?:$/.test(x.protocol) || !x.hostname.includes('.')) return ''; return s.slice(0, 1000); } catch { return ''; }
}
/** «https://www.cima.aemps.es/cima/…» → «cima.aemps.es» */
export function domainOf(u) {
  try { return new URL(str(u)).hostname.replace(/^www\./, ''); } catch { return ''; }
}
/** Tipo que se pone solo al pegar la URL (si no se eligió ninguno) */
export const guessKind = (u) => (/(^|\.)cima\.aemps\.es$/i.test(domainOf(u)) ? 'ft' : '');

/** Un recurso del JSON, de la copia o del formulario → recurso limpio, o null */
export function normResource(x, newId, { withReg = true } = {}) {
  if (typeof x === 'string') x = { url: x };
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const pick = (...keys) => { for (const k of keys) if (x[k] != null && x[k] !== '') return x[k]; return null; };
  const url = cleanUrl(pick('url', 'enlace', 'link', 'href'));
  const fileId = typeof x.fileId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x.fileId) ? x.fileId : '';
  if (!url && !fileId) return null;
  const out = {
    id: typeof x.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x.id) ? x.id : newId(),
    title: cut(pick('title', 'titulo', 'título', 'nombre', 'name'), 200) || (url ? domainOf(url) : cut(x.fileName, 200).replace(/\.pdf$/i, '')) || 'PDF',
    url,
    kind: kindKey(pick('kind', 'tipo', 'type')) || guessKind(url) || 'web',
    note: cut(pick('note', 'nota', 'notas', 'descripcion', 'descripción'), 300),
    year: cut(pick('year', 'año', 'ano', 'version', 'versión', 'edicion', 'edición'), 40),
    createdAt: Number(x.createdAt) || Date.now()
  };
  if (withReg && typeof x.regId === 'string' && x.regId) out.regId = x.regId.slice(0, 40);
  if (fileId) {
    out.fileId = fileId;
    out.fileName = cut(x.fileName, 200) || 'documento.pdf';
    out.fileSize = Number(x.fileSize) || 0;
  }
  return out;
}
/** Lista de recursos (del JSON: objetos o URL sueltas, también texto con una URL por línea o «;») */
export function normResources(raw, newId, opts) {
  const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/\r?\n|;/) : raw && typeof raw === 'object' ? [raw] : [];
  const out = [], seen = new Set();
  for (const x of items) {
    const r = normResource(x, newId, opts);
    if (!r) continue;
    const k = resKey(r);
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out.slice(0, 80);
}
/** Clave para no repetir: la URL (sin «www.», «/» final ni mayúsculas en el dominio) o el PDF */
export function resKey(r) {
  if (r?.url) {
    try { const u = new URL(r.url); return `${u.hostname.replace(/^www\./, '').toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`; } catch { return str(r.url); }
  }
  return `file:${r?.fileId || r?.id}`;
}
/** Une recursos sin repetir. regMap = {regId viejo → nuevo} (o función) para conservar la indicación. Devuelve [lista, nº añadidos] */
export function mergeResources(cur, add, { regMap = null, regIds = null } = {}) {
  const out = arr(cur).map((r) => ({ ...r }));
  const seen = new Set(out.map(resKey));
  const ids = new Set(out.map((r) => r.id));
  let n = 0;
  for (const r0 of arr(add)) {
    if (!r0 || (!r0.url && !r0.fileId)) continue;
    const k = resKey(r0);
    if (seen.has(k)) continue;
    const r = { ...r0 };
    if (!r.id || ids.has(r.id)) r.id = `r${Math.random().toString(36).slice(2, 10)}`;
    if (r.regId && regMap) { const m = typeof regMap === 'function' ? regMap(r.regId) : regMap[r.regId]; if (m) r.regId = m; else delete r.regId; }
    seen.add(k); ids.add(r.id); out.push(r); n++;
  }
  return [regIds ? fixRegIds(out, regIds) : out, n];
}
/** Quita el regId de los recursos cuya indicación ya no existe (no se borran) */
export function fixRegIds(resources, regimensOrIds) {
  const ids = regimensOrIds instanceof Set ? regimensOrIds : new Set(arr(regimensOrIds).map((r) => r?.id).filter(Boolean));
  return arr(resources).map((r) => {
    if (!r.regId || ids.has(r.regId)) return r;
    const { regId, ...rest } = r;
    return rest;
  });
}
/** Recursos de las carpetas de una ficha, de la más cercana a la raíz: [{ folder, items }] */
export function folderResources(folderId, folders) {
  const out = [], seen = new Set();
  for (let f = folderId ? folders.get(folderId) : null; f && !seen.has(f.id); f = f.parentId ? folders.get(f.parentId) : null) {
    seen.add(f.id);
    const items = arr(f.resources).filter((r) => r && (r.url || r.fileId));
    if (items.length) out.push({ folder: f, items });
  }
  return out;
}
/** Agrupa por tipo en el orden de RES_KINDS: [{ kind, label, icon, items }] */
export function byKind(list) {
  return RES_KINDS.map(([kind, label, ic]) => ({ kind, label, icon: ic, items: arr(list).filter((x) => (KIND_SET.has((x.r || x).kind) ? (x.r || x).kind : 'web') === kind) }))
    .filter((g) => g.items.length);
}
/** Texto de búsqueda de los recursos de una ficha (título, nota y año) */
export const resSearchText = (resources) => arr(resources).map((r) => [r.title, r.note, r.year].map(str).join(' ')).join('\n');
/** Una línea de texto: «Título (2024) — https://…» */
export const resLine = (r) => `${str(r.title)}${r.year ? ` (${r.year})` : ''}${r.url ? ` — ${r.url}` : r.fileName ? ` — PDF: ${r.fileName}` : ''}`;
/** ¿Se abre con el visor propio? Solo los PDF adjuntos (un PDF de otra web se abre en una pestaña: el CSP y CORS no dejan leerlo) */
export const isPdfRes = (r) => !!r?.fileId;
/** Archivos (PDF) de una lista de recursos */
export const resFileIds = (resources) => arr(resources).map((r) => r?.fileId).filter(Boolean);
