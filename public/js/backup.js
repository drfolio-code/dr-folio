// Copia de seguridad: exportar (JSON completo versionado y .zip legible) y restaurar (fusionar / reemplazar)
//
// Formato del JSON (formatVersion 1):
//   { format: 'drfolio-backup', formatVersion: 1, app: 'Dr.Folio', appVersion, exportedAt (ISO), exportedAtMs,
//     withFiles, counts: {colección: n}, data: { folders, tags, notes, files, snippets, snippetFolders, drugFolders, drugs },
//     fileData: { fileId: base64 } }            ← solo si withFiles
// También se aceptan las copias antiguas (≤ v1.8.0): colecciones en la raíz y fileData como «data:…;base64,…».
// Cada documento se guarda tal cual (sin el campo id). Las notas van COMPLETAS, como antes de v1.10.0
// (datos de notes/{id} + html/text/refs de noteBodies/{id}, sin los campos calculados): el formato no cambia.
// Vademécum (v1.18.0): `drugs` también COMPLETOS (drugs/{id} + html/text de drugBodies/{id}, sin campos calculados) y
// `drugFolders`. Las copias anteriores no los traen y se leen igual (listas vacías).
// Chat personal (v1.19.0): `chat` (todos los mensajes, se leen del servidor al exportar) y `settings` (caducidad).
// Si una copia no los trae (anterior a v1.19.0), «Reemplazar» no borra el chat ni los ajustes.
import { writeBatch, doc, collection } from '../vendor/libs.js';
import { db } from './db.js';
import { store, ref, allLoaded } from './store.js';
import { ensureAllBodies, fullNote, deriveLight, rememberBody, DERIVED_FIELDS } from './bodies.js';
import { fileBlob, blobToBase64, base64ToBytes } from './files.js';
import { sanitize, escapeHtml } from './editor.js';
import { APP_VERSION, LIMITS } from './config.js';
import { el, download, formatBytes, longDate } from './util.js';
import { modal, toast } from './ui.js';
import { icon } from './icons.js';
import { htmlOf } from './snipbody.js';
import { ensureAllDrugBodies, fullDrug, deriveDrugLight, rememberDrugBody, DRUG_DERIVED, lineOf, regSummary, presBrandsOf } from './drugbody.js';
import { normResources, folderResources, byKind, domainOf } from './drugres.js';

export const BACKUP_FORMAT = 'drfolio-backup';
export const BACKUP_VERSION = 1;
const COLS = ['folders', 'tags', 'files', 'notes', 'snippetFolders', 'snippets', 'drugFolders', 'drugs', 'settings', 'chat']; // orden de escritura
const OPTIONAL = ['settings', 'chat']; // si la copia no los trae, no se borran al reemplazar
const COL_NAMES = {
  notes: 'Notas', folders: 'Carpetas', tags: 'Etiquetas', snippets: 'Prerredactados',
  snippetFolders: 'Carpetas de prerredactados', drugs: 'Fármacos (Vademécum)', drugFolders: 'Carpetas del Vademécum',
  files: 'Archivos (imágenes y PDF)', chat: 'Mensajes del chat', settings: 'Ajustes comunes'
};
/** Colecciones que se guardan como dos documentos (ligero + contenido) */
const BODY_COL = { notes: 'noteBodies', drugs: 'drugBodies' };
const LAST_KEY = 'drfolio.lastBackup';   // ms de la última copia JSON guardada en este dispositivo
const JOB_KEY = 'drfolio.restoreJob';    // restauración que se quedó a medias (límite diario)
const QUOTA_KEY = 'drfolio.quota';       // escrituras/borrados hechos hoy por las restauraciones
const DAY_WRITES = 20000;                // plan Spark: 20.000 escrituras y 20.000 borrados al día
const DAY_RESERVE = 1500;                // margen para el uso normal de la app ese día
const REMIND_DAYS = 7;

let hooks = { beforeRun: () => {}, isPublic: () => false, onChange: () => {}, allChat: async () => [] };
let chatLocal = new Map(); // mensajes del chat del servidor (para comparar al restaurar: no están todos en memoria)
export function initBackup(h) { hooks = { ...hooks, ...h }; }

const PUBLIC_REASON = 'No disponible en «Ordenador público»: así no quedan copias de tus notas en ordenadores ajenos. Hazla desde tu móvil o tu ordenador.';
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
  del(k) { localStorage.removeItem(k); }
};
const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};
const plural = (n, one, many) => `${n.toLocaleString('es-ES')} ${n === 1 ? one : many}`;
const tsOf = (d) => Number(d?.updatedAt ?? d?.createdAt ?? 0) || 0;
const clean = (d) => { const { id, ...rest } = d; return rest; };

// ====================== Recordatorio ======================
export const lastBackupAt = () => Number(localStorage.getItem(LAST_KEY)) || 0;
const markBackup = () => { localStorage.setItem(LAST_KEY, String(Date.now())); hooks.onChange(); };
export const pendingJob = () => ls.get(JOB_KEY);

/** Aviso discreto para Inicio (o null): última copia hace > 7 días o restauración a medias */
export function backupReminder() {
  if (hooks.isPublic() || !allLoaded()) return null;
  const job = pendingJob();
  if (job) {
    return el('div', { class: 'backup-remind warn' }, '⏸ Restauración a medias (',
      plural(job.done, 'escritura', 'escrituras'), ' de ', job.total.toLocaleString('es-ES'), ') · ',
      el('button', { type: 'button', class: 'link-btn', onclick: () => openBackup() }, 'Continuar'));
  }
  if (!store.notes.size && !store.snippets.size) return null;
  const last = lastBackupAt();
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  if (last && days <= REMIND_DAYS) return null;
  return el('div', { class: 'backup-remind' },
    last ? `💾 Última copia hace ${plural(days, 'día', 'días')} · ` : '💾 Aún no has hecho ninguna copia · ',
    el('button', { type: 'button', class: 'link-btn', onclick: () => openBackup() }, 'Hacer copia'));
}

// ====================== Ventana de progreso ======================
export function progress(title) {
  const txt = el('p', { class: 'bk-txt' }, 'Preparando…');
  const bar = el('div', { style: { width: '0%' } });
  const sub = el('p', { class: 'muted small bk-sub' }, '');
  const extra = el('div', { class: 'bk-extra' });
  let closeFn = null;
  const closed = modal({ title, body: [txt, el('div', { class: 'meter bk-meter' }, bar), sub, extra], actions: [], cls: 'backup', onOpen: (_, c) => { closeFn = c; } });
  return {
    closed,
    set(frac, text, subText) {
      bar.style.width = `${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%`;
      if (text != null) txt.textContent = text;
      if (subText != null) sub.textContent = subText;
    },
    finish(text, nodes = []) {
      bar.style.width = '100%';
      txt.textContent = text;
      sub.textContent = '';
      extra.replaceChildren(...nodes.filter(Boolean), el('div', { class: 'bk-actions' },
        el('button', { type: 'button', class: 'btn', onclick: () => closeFn?.() }, 'Cerrar')));
    },
    close: () => closeFn?.()
  };
}

/** Botones para guardar el archivo: hoja de compartir (móvil) o descarga */
function deliverButtons(blob, name, { onSaved } = {}) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  const canShare = !!(navigator.canShare && navigator.share && (() => { try { return navigator.canShare({ files: [file] }); } catch { return false; } })());
  const phone = matchMedia('(pointer: coarse)').matches;
  const saved = () => { onSaved?.(); status.textContent = '✓ Guardada'; };
  const status = el('span', { class: 'muted small' }, '');
  const share = canShare ? el('button', {
    type: 'button', class: `btn ${phone ? 'primary' : ''}`,
    onclick: async () => {
      try { await navigator.share({ files: [file], title: name }); saved(); } catch (e) {
        if (e?.name !== 'AbortError') { toast('No se pudo compartir: se descarga', 'error'); download(name, blob); saved(); }
      }
    }
  }, '📤 Guardar en Archivos / Drive…') : null;
  const dl = el('button', { type: 'button', class: `btn ${!share || !phone ? 'primary' : ''}`, onclick: () => { download(name, blob); saved(); } }, '⬇ Descargar');
  return el('div', { class: 'bk-actions' }, share, dl, status);
}

// ====================== Exportar JSON ======================
/** Construye la copia completa como Blob (por partes: no crea una cadena gigante en memoria) */
export async function buildBackup({ withFiles, onProgress = () => {} }) {
  onProgress(0, 'Descargando el contenido de las notas…');
  await ensureAllBodies(); // las notas solo se exportan completas
  await ensureAllDrugBodies(); // y los fármacos, con «Mis notas»
  const data = {};
  let chatMissing = false;
  for (const c of COLS) {
    if (c === 'chat') {
      onProgress(0, 'Leyendo el chat…');
      try { data.chat = await hooks.allChat(); } catch { data.chat = []; chatMissing = true; }
      continue;
    }
    data[c] = c === 'notes' ? [...store.notes.values()].map(fullNote)
      : c === 'drugs' ? [...store.drugs.values()].map(fullDrug) : [...store[c].values()];
  }
  if (chatMissing) delete data.chat; // sin conexión: la copia va sin chat (y al restaurarla no se borra el chat)
  const counts = Object.fromEntries(COLS.map((c) => [c, (data[c] || []).length]));
  const head = {
    format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, app: 'Dr.Folio', appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(), exportedAtMs: Date.now(), withFiles: !!withFiles, counts, data
  };
  const parts = [JSON.stringify(head).slice(0, -1)]; // sin la «}» final
  const missing = [];
  if (withFiles) {
    parts.push(',"fileData":{');
    const files = data.files;
    let first = true, done = 0, bytes = 0;
    const total = files.reduce((s, f) => s + (f.size || 0), 0) || 1;
    for (const f of files) {
      onProgress(bytes / total, `Archivos: ${done + 1} de ${files.length}`, f.name || '');
      try {
        const b64 = await blobToBase64(await fileBlob(f.id));
        parts.push(`${first ? '' : ','}${JSON.stringify(f.id)}:${JSON.stringify(b64)}`);
        first = false;
      } catch { missing.push(f.name || f.id); }
      done++; bytes += f.size || 0;
    }
    parts.push('}');
  }
  parts.push('}');
  onProgress(1, 'Listo');
  return { blob: new Blob(parts, { type: 'application/json' }), counts, missing, chatMissing };
}

/** Copia completa (.json). Devuelve una promesa que se resuelve al cerrar la ventana. */
export function exportJson(withFiles) {
  hooks.beforeRun();
  const p = progress('Copia de seguridad');
  runExportJson(p, withFiles);
  return p.closed;
}
async function runExportJson(p, withFiles) {
  try {
    const { blob, counts, missing, chatMissing } = await buildBackup({ withFiles, onProgress: (f, t, s) => p.set(f, t, s) });
    const name = `drfolio-copia-${stamp()}${withFiles ? '-completa' : '-sin-archivos'}.json`;
    p.finish(`Copia lista · ${formatBytes(blob.size)}`, [
      summaryTable(counts),
      missing.length ? el('p', { class: 'bk-warn' }, `⚠️ ${missing.length} archivo(s) no se pudieron leer (¿sin conexión?): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`) : null,
      chatMissing ? el('p', { class: 'bk-warn' }, '⚠️ Sin conexión: la copia no incluye los mensajes del chat.') : null,
      el('p', { class: 'muted small' }, name),
      deliverButtons(blob, name, { onSaved: markBackup })
    ]);
  } catch (e) { console.error(e); p.finish(`⚠️ No se pudo hacer la copia: ${e.message || e}`); }
}

function summaryTable(counts, extra = {}) {
  const rows = [
    ['notes', 'notebook-text'], ['folders', 'folder'], ['tags', 'tag'], ['snippets', 'clipboard-list'], ['snippetFolders', 'folder'],
    ['drugs', 'pill'], ['drugFolders', 'folder'], ['chat', 'message-circle'], ['files', 'image']
  ];
  return el('table', { class: 'bk-table' }, el('tbody', {},
    rows.map(([c, ico]) => el('tr', {}, el('td', {}, icon(ico), ` ${COL_NAMES[c]}`), el('td', {}, (counts[c] || 0).toLocaleString('es-ES'),
      extra[c] ? el('span', { class: 'muted small' }, ` ${extra[c]}`) : null)))));
}

// ====================== Exportar .zip legible ======================
const BAD = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;
function safeName(s, fallback) {
  const n = String(s || '').replace(BAD, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 80).trim();
  return n || fallback;
}
/** Nombre único dentro de una carpeta del zip */
function uniqueIn(used, dir, name) {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  let n = name, i = 2;
  while (used.has(`${dir}/${n}`.toLowerCase())) n = `${base} (${i++})${ext}`;
  used.add(`${dir}/${n}`.toLowerCase());
  return n;
}
/** Ruta relativa entre dos rutas del zip (segmentos codificados para usarlos en href/src) */
function rel(fromDir, toPath) {
  const a = fromDir ? fromDir.split('/') : [], b = toPath.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i).map(encodeURIComponent)].join('/');
}
const PAGE_CSS = `
:root{color-scheme:light dark;--fg:#1d2a33;--muted:#6b7a86;--bg:#fff;--line:#dfe5ea;--accent:#0e7490;--soft:#f3f6f8}
@media (prefers-color-scheme:dark){:root{--fg:#e4eaee;--muted:#8d9ba5;--bg:#141a1f;--line:#2b363e;--accent:#22a7c4;--soft:#1c252c}}
body{font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg);max-width:860px;margin:0 auto;padding:24px 18px 60px}
a{color:var(--accent)} img{max-width:100%;height:auto;border-radius:6px}
h1.title{font-size:28px;margin:6px 0 4px} .meta{color:var(--muted);font-size:13px;margin-bottom:18px}
.crumbs{font-size:13px;color:var(--muted)} .tag{display:inline-block;background:var(--soft);border-radius:10px;padding:1px 8px;margin-right:4px}
table{border-collapse:collapse;margin:10px 0;max-width:100%} td,th{border:1px solid var(--line);padding:5px 8px;vertical-align:top}
blockquote{border-left:3px solid var(--line);margin:8px 0;padding:2px 12px;color:var(--muted)}
pre{background:var(--soft);padding:10px;border-radius:6px;overflow:auto}
.note-toc{background:var(--soft);border-radius:8px;padding:8px 14px;margin:10px 0} .note-toc ul{margin:4px 0;padding-left:18px}
ul[data-checklist] li,li[data-checked]{list-style:none} li[data-checked="1"]::before{content:"☑ "} li[data-checked="0"]::before{content:"☐ "}
.refs{border-top:1px solid var(--line);margin-top:30px;padding-top:10px;font-size:15px}
.tree ul{list-style:none;padding-left:18px;margin:2px 0} .tree li{margin:2px 0} .muted{color:var(--muted)}
.snip{white-space:pre-wrap;background:var(--soft);padding:12px;border-radius:8px;font:15px/1.5 ui-monospace,Menlo,Consolas,monospace}`;
const page = (title, body) => `<!doctype html>\n<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${PAGE_CSS}</style></head><body>${body}</body></html>\n`;

/** Prepara el HTML de una nota para verlo fuera de la app */
function noteHtml(n, ctx) {
  const dir = ctx.noteDir.get(n.id);
  const pathOf = (id) => ctx.notePath.get(id);
  const docu = new DOMParser().parseFromString(sanitize(n.html || ''), 'text/html');
  const body = docu.body;
  body.querySelectorAll('.sec-copy').forEach((x) => x.remove());
  body.querySelectorAll('.fold-hidden, .foldable').forEach((x) => x.classList.remove('fold-hidden', 'foldable'));
  body.querySelectorAll('img[data-file]').forEach((img) => {
    const p = ctx.filePath.get(`${n.id}/${img.dataset.file}`);
    if (p) img.setAttribute('src', rel(dir, p)); else img.replaceWith(docu.createTextNode('[imagen no disponible]'));
  });
  body.querySelectorAll('a[data-note]').forEach((a) => {
    const p = pathOf(a.dataset.note);
    if (p) a.setAttribute('href', rel(dir, p)); else a.removeAttribute('href');
  });
  body.querySelectorAll('a[data-drug]').forEach((a) => {
    const p = pathOf(`d:${a.dataset.drug}`);
    if (p) a.setAttribute('href', rel(dir, p)); else a.removeAttribute('href');
  });
  // Índice: lista de los títulos
  const heads = [...body.querySelectorAll('h1, h2, h3')];
  heads.forEach((h, i) => { h.id = `t${i + 1}`; });
  body.querySelectorAll('.note-toc').forEach((toc) => {
    toc.replaceChildren();
    const ul = docu.createElement('ul');
    heads.forEach((h) => {
      const li = docu.createElement('li'), a = docu.createElement('a');
      a.href = `#${h.id}`; a.textContent = h.textContent;
      li.style.marginLeft = `${(Number(h.tagName[1]) - 1) * 14}px`;
      li.append(a); ul.append(li);
    });
    toc.append(ul);
  });
  const folder = n.drug ? n.drugPath : n.folderId ? ctx.folderNames(n.folderId) : '';
  const tags = (n.tags || []).map((t) => store.tags.get(t)?.name).filter(Boolean);
  const refs = (n.refs || []).map((r) => {
    const fp = r.fileId ? ctx.filePath.get(`${n.id}/${r.fileId}`) : null;
    return `<li>${escapeHtml(r.cite || r.fileName || r.url || '')}`
      + (r.url && /^https?:\/\//i.test(r.url) ? ` · <a href="${escapeHtml(r.url)}">${escapeHtml(r.url)}</a>` : '')
      + (fp ? ` · <a href="${escapeHtml(rel(dir, fp))}">📎 ${escapeHtml(r.fileName || 'archivo')}</a>` : '') + '</li>';
  });
  return page(n.title || 'Sin título',
    `<div class="crumbs"><a href="${escapeHtml(rel(dir, 'index.html'))}">🏠 Índice</a>${folder ? ` · ${escapeHtml(folder)}` : ''}${n.trashed ? ' · 🗑 Papelera' : ''}</div>`
    + `<h1 class="title">${escapeHtml(n.title || 'Sin título')}</h1>`
    + `<div class="meta">Creada ${escapeHtml(longDate(n.createdAt))} · Modificada ${escapeHtml(longDate(n.updatedAt))}${n.pinned ? ' · 📌 Fijada' : ''}${n.drug && n.reviewed === false ? ' · ⚠ Pendiente de revisar' : ''}`
    + `${tags.length ? `<br>${tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}` : ''}</div>`
    + body.innerHTML
    + (refs.length ? `<div class="refs"><h2>Bibliografía</h2><ol>${refs.join('')}</ol></div>` : ''));
}

/** HTML de una ficha del Vademécum para el .zip: nombres comerciales, presentaciones, pautas y «Mis notas» */
function drugPageHtml(d) {
  const e = escapeHtml;
  const parts = [];
  if (d.brands?.length) parts.push(`<p><strong>Nombres comerciales:</strong> ${e(d.brands.join(', '))}</p>`);
  if (d.scopes?.length) parts.push(`<p><strong>Ámbito:</strong> ${e(d.scopes.map((k) => ({ ap: 'Atención Primaria', urg: 'Urgencias', mont: 'Rescate de montaña' }[k] || k)).join(', '))}</p>`);
  if (d.fluids?.length) parts.push(`<p><strong>Sueros:</strong> ${e(d.fluids.join(', '))}</p>`);
  if (d.presentations?.length) parts.push(`<h2>Presentaciones</h2><ul>${d.presentations.map((p) => { const b = presBrandsOf(d, p); return `<li>${e(p)}${b.length ? ` <span class="muted">(${e(b.join(', '))})</span>` : ''}</li>`; }).join('')}</ul>`);
  if (d.regimens?.length) {
    parts.push(`<h2>Indicaciones</h2><table><thead><tr><th>Indicación</th><th>Tipo</th><th>Dosis</th><th>Para el informe</th></tr></thead><tbody>${d.regimens.map((r) => `<tr><td>${e(r.indication || '')}</td><td>${e(r.type || '')}</td><td>${e([r.text || '', regSummary(r)].filter(Boolean).join(' · '))}</td><td>${e(lineOf(d.name, r))}</td></tr>`).join('')}</tbody></table>`);
  }
  for (const [k, t] of [['observations', 'Observaciones'], ['contraindications', 'Contraindicaciones'], ['compat', 'Compatibilidad en Y']]) {
    if (d[k]?.length) parts.push(`<h2>${t}</h2><ul>${d[k].map((x) => `<li>${e(x)}</li>`).join('')}</ul>`);
  }
  // v1.27.0: enlaces y bibliografía (de la ficha y de sus carpetas); los PDF van en «Bibliografía», al final, con su archivo
  const res = [...(d.resources || []).map((r) => ({ r })), ...folderResources(d.folderId, store.drugFolders).flatMap((g) => g.items.map((r) => ({ r, from: g.folder.name })))];
  if (res.length) {
    parts.push(`<h2>Enlaces y bibliografía</h2>${byKind(res).map((g) => `<h3>${e(g.label)}</h3><ul>${g.items.map(({ r, from }) => `<li>${
      r.url && /^https?:\/\//i.test(r.url) ? `<a href="${e(r.url)}">${e(r.title || r.url)}</a>` : `📎 ${e(r.title || r.fileName || 'PDF')} <span class="muted">(PDF, en «Bibliografía» abajo)</span>`
    }${r.year ? ` <span class="muted">· ${e(r.year)}</span>` : ''}${r.url ? ` <span class="muted">· ${e(domainOf(r.url))}</span>` : ''}${r.note ? `<br><span class="muted">${e(r.note)}</span>` : ''}${from ? ` <span class="muted">· De la carpeta ${e(from)}</span>` : ''}</li>`).join('')}</ul>`).join('')}`);
  }
  if (d.source?.text || d.source?.url) parts.push(`<p class="muted">Fuente: ${d.source.url && /^https?:\/\//i.test(d.source.url) ? `<a href="${e(d.source.url)}">${e(d.source.text || d.source.url)}</a>` : e(d.source.text)}</p>`);
  if (String(d.html || '').trim()) parts.push(`<h2>Mis notas</h2>${d.html}`);
  return parts.join('');
}

const fileIdsOf = (n) => {
  const ids = new Set((n.refs || []).map((r) => r.fileId).filter(Boolean));
  for (const m of String(n.html || '').matchAll(/data-file="([^"]+)"/g)) ids.add(m[1]);
  return [...ids];
};

async function exportZip() {
  hooks.beforeRun();
  const p = progress('Exportación legible (.zip)');
  try {
    p.set(0, 'Cargando el compresor…');
    const { default: JSZip } = await import('../vendor/jszip.js');
    const zip = new JSZip();
    const ROOT = `Dr.Folio ${stamp().slice(0, 10)}`;
    const root = zip.folder(ROOT);
    const used = new Set();
    // Carpetas de notas → rutas
    const dirCache = new Map();
    const dirOf = (folderId, base, map) => {
      const key = `${base}|${folderId}`;
      if (dirCache.has(key)) return dirCache.get(key);
      const f = map.get(folderId);
      if (!f) return base;
      const seen = new Set();
      const chain = [];
      for (let x = f; x && !seen.has(x.id); x = x.parentId ? map.get(x.parentId) : null) { seen.add(x.id); chain.unshift(x); }
      let d = base;
      for (const x of chain) {
        const k = `${base}|${x.id}`;
        if (!dirCache.has(k)) {
          const name = uniqueIn(used, d, safeName(x.name, 'Carpeta'));
          dirCache.set(k, `${d}/${name}`);
        }
        d = dirCache.get(k);
      }
      return d;
    };
    const folderNames = (id) => {
      const out = []; const seen = new Set();
      for (let x = store.folders.get(id); x && !seen.has(x.id); x = x.parentId ? store.folders.get(x.parentId) : null) { seen.add(x.id); out.unshift(x.name); }
      return out.join(' › ');
    };
    // Rutas de notas y adjuntos
    p.set(0, 'Descargando el contenido de las notas…');
    await ensureAllBodies();
    const notes = [...store.notes.values()].map(fullNote).sort((a, b) => (a.title || '').localeCompare(b.title || '', 'es'));
    const ctx = { noteDir: new Map(), notePath: new Map(), filePath: new Map(), folderNames };
    const wanted = []; // [{noteId, fileId, path}]
    // Los prerredactados se exportan como «notas» de la carpeta Prerredactados (id «s:…»)
    const snips = [...store.snippets.values()].sort((a, b) => (a.title || '').localeCompare(b.title || '', 'es'));
    const snipNotes = new Map(snips.map((s) => [s.id, {
      id: `s:${s.id}`, snippetFolder: s.folderId, title: s.title, html: htmlOf(s), refs: [], tags: [],
      createdAt: s.createdAt, updatedAt: s.updatedAt, snippet: true
    }]));
    // Los fármacos, como «notas» de la carpeta Vademécum (id «d:…»), con sus pautas en una tabla
    await ensureAllDrugBodies();
    const drugs = [...store.drugs.values()].map(fullDrug).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
    const drugNames = (id) => {
      const out = []; const seen = new Set();
      for (let x = store.drugFolders.get(id); x && !seen.has(x.id); x = x.parentId ? store.drugFolders.get(x.parentId) : null) { seen.add(x.id); out.unshift(x.name); }
      return out.join(' › ');
    };
    const drugNotes = new Map(drugs.map((d) => [d.id, {
      id: `d:${d.id}`, drugFolder: d.folderId, title: d.name || 'Sin nombre', html: drugPageHtml(d), tags: [],
      // PDF de «Enlaces y bibliografía» (de la ficha y de sus carpetas) → se exportan como los adjuntos de las notas
      refs: [...(d.resources || []), ...folderResources(d.folderId, store.drugFolders).flatMap((g) => g.items)].filter((r) => r.fileId)
        .map((r) => ({ cite: r.title, url: r.url || null, fileId: r.fileId, fileName: r.fileName })),
      createdAt: d.createdAt, updatedAt: d.updatedAt, drug: true, trashed: !!d.trashed, reviewed: d.reviewed,
      drugPath: `💊 Vademécum${d.folderId && store.drugFolders.has(d.folderId) ? ` › ${drugNames(d.folderId)}` : ''}`
    }]));
    for (const n of [...notes, ...snipNotes.values(), ...drugNotes.values()]) {
      const dir = n.snippet ? (n.snippetFolder && store.snippetFolders.has(n.snippetFolder) ? dirOf(n.snippetFolder, 'Prerredactados', store.snippetFolders) : 'Prerredactados')
        : n.drug ? (n.trashed ? 'Vademécum/Papelera' : n.drugFolder && store.drugFolders.has(n.drugFolder) ? dirOf(n.drugFolder, 'Vademécum', store.drugFolders) : 'Vademécum')
          : n.trashed ? 'Papelera' : n.folderId && store.folders.has(n.folderId) ? dirOf(n.folderId, 'Notas', store.folders) : 'Notas';
      const title = safeName(n.title, 'Sin título');
      const file = uniqueIn(used, dir, `${title}.html`);
      ctx.noteDir.set(n.id, dir);
      ctx.notePath.set(n.id, `${dir}/${file}`);
      const ids = fileIdsOf(n).filter((id) => store.files.has(id));
      if (ids.length) {
        const fdir = `${dir}/${uniqueIn(used, dir, `${file.slice(0, -5)} (archivos)`)}`;
        for (const id of ids) {
          const meta = store.files.get(id);
          const path = `${fdir}/${uniqueIn(used, fdir, safeName(meta.name, meta.kind === 'image' ? 'imagen' : 'archivo') + extFor(meta))}`;
          ctx.filePath.set(`${n.id}/${id}`, path);
          wanted.push({ id, path, size: meta.size || 0 });
        }
      }
    }
    // Chat personal: una página con los mensajes y sus archivos en «Chat/Archivos»
    let chatMsgs = [];
    try { chatMsgs = (await hooks.allChat()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)); } catch { chatMsgs = null; }
    for (const m of chatMsgs || []) {
      for (const id of m.files || []) {
        const meta = store.files.get(id);
        if (!meta || ctx.filePath.has(`chat/${id}`)) continue;
        const path = `Chat/Archivos/${uniqueIn(used, 'Chat/Archivos', safeName(meta.name, meta.kind === 'image' ? 'imagen' : 'archivo') + extFor(meta))}`;
        ctx.filePath.set(`chat/${id}`, path);
        wanted.push({ id, path, size: meta.size || 0 });
      }
    }
    // Descarga de los archivos
    const totalBytes = wanted.reduce((s, w) => s + w.size, 0) || 1;
    let got = 0; const missing = [];
    const blobs = new Map();
    for (let i = 0; i < wanted.length; i++) {
      const w = wanted[i];
      p.set(0.6 * got / totalBytes, `Archivos: ${i + 1} de ${wanted.length}`, w.path.split('/').pop());
      try {
        if (!blobs.has(w.id)) blobs.set(w.id, await fileBlob(w.id));
        root.file(w.path, blobs.get(w.id), { binary: true, compression: 'STORE' });
      } catch { missing.push(w.path.split('/').pop()); }
      got += w.size;
    }
    blobs.clear();
    // Notas
    p.set(0.6, 'Notas…');
    for (const n of notes) root.file(ctx.notePath.get(n.id), noteHtml(n, ctx));
    // Prerredactados: .html (con formato e imágenes) y .txt (texto plano, como se copia)
    const snipPaths = [];
    for (const s of snips) {
      const sn = snipNotes.get(s.id);
      root.file(ctx.notePath.get(sn.id), noteHtml(sn, ctx));
      const dir = ctx.noteDir.get(sn.id);
      const txt = `${dir}/${uniqueIn(used, dir, `${safeName(s.title, 'Sin título')}.txt`)}`;
      root.file(txt, `${s.title || ''}\n\n${s.body || ''}\n`);
      snipPaths.push([s, ctx.notePath.get(sn.id)]);
    }
    const drugPaths = [];
    for (const d of drugs) {
      const dn = drugNotes.get(d.id);
      root.file(ctx.notePath.get(dn.id), noteHtml(dn, ctx));
      if (!d.trashed) drugPaths.push([dn, ctx.notePath.get(dn.id)]);
    }
    if (chatMsgs?.length) root.file('Chat/Chat personal.html', chatPageHtml(chatMsgs, ctx));
    root.file('index.html', indexPage(notes, ctx, snipPaths, drugPaths, chatMsgs?.length || 0));
    root.file('LEEME.txt', `Exportación legible de Dr.Folio (${new Date().toLocaleString('es-ES')}).\n\n`
      + 'Abre «index.html» con cualquier navegador. Cada nota es un .html con sus imágenes y PDF en la carpeta «(archivos)» de al lado.\n'
      + 'Los prerredactados están en «Prerredactados»: .html con su formato e imágenes y .txt con el texto tal como se copia.\n'
      + 'Los fármacos están en «Vademécum» (por carpetas): un .html por ficha con presentaciones, pautas y tus notas.\n'
      + 'El chat personal está en «Chat/Chat personal.html», con sus archivos en «Chat/Archivos».\n\n'
      + 'Para RESTAURAR en la app usa la copia .json (Ajustes → Copia de seguridad), no este .zip.\n');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (m) => p.set(0.6 + 0.4 * (m.percent / 100), 'Comprimiendo…', m.currentFile ? m.currentFile.split('/').pop() : ''));
    const zblob = new Blob([blob], { type: 'application/zip' });
    const name = `drfolio-legible-${stamp()}.zip`;
    p.finish(`Exportación lista · ${formatBytes(zblob.size)}`, [
      el('p', {}, `${plural(notes.length, 'nota', 'notas')}, ${plural(store.snippets.size, 'prerredactado', 'prerredactados')}, ${plural(drugs.length, 'fármaco', 'fármacos')}, ${plural(chatMsgs?.length || 0, 'mensaje del chat', 'mensajes del chat')} y ${plural(wanted.length, 'archivo', 'archivos')}.`),
      chatMsgs === null ? el('p', { class: 'bk-warn' }, '⚠️ Sin conexión: el .zip no incluye el chat.') : null,
      missing.length ? el('p', { class: 'bk-warn' }, `⚠️ ${missing.length} archivo(s) no se pudieron leer (¿sin conexión?).`) : null,
      el('p', { class: 'muted small' }, 'Se abre sin la app (index.html). Para restaurar usa la copia .json.'),
      deliverButtons(zblob, name)
    ]);
  } catch (e) { console.error(e); p.finish(`⚠️ No se pudo exportar: ${e.message || e}`); }
}

function extFor(meta) {
  if (/\.[a-z0-9]{2,5}$/i.test(meta.name || '')) return '';
  const m = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'application/pdf': '.pdf' };
  return m[meta.mime] || '';
}

/** Página del chat para el .zip: mensajes por día, con enlaces a sus archivos */
function chatPageHtml(msgs, ctx) {
  const e = escapeHtml;
  const dev = { phone: 'Móvil', desktop: 'Ordenador', public: 'Ordenador público' };
  let day = '';
  const rows = msgs.map((m) => {
    const d = new Date(m.createdAt || 0);
    const dl = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const head = dl !== day ? `<h2>${e(dl)}</h2>` : '';
    day = dl;
    const files = (m.files || []).map((id) => {
      const p = ctx.filePath.get(`chat/${id}`);
      const meta = store.files.get(id);
      if (!p) return '<li class="muted">[archivo no disponible]</li>';
      return meta?.kind === 'image' ? `<li><a href="${e(rel('Chat', p))}"><img src="${e(rel('Chat', p))}" alt="" style="max-width:320px"></a></li>`
        : `<li><a href="${e(rel('Chat', p))}">📎 ${e(meta?.name || 'archivo')}</a></li>`;
    }).join('');
    return `${head}<div class="msg"><div class="meta">${e(d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))} · ${e(dev[m.device] || 'Ordenador')}${m.pinned ? ' · 📌 Fijado' : ''}${m.editedAt ? ' · editado' : ''}</div>`
      + (m.text ? `<div class="snip">${e(m.text)}</div>` : '') + (files ? `<ul>${files}</ul>` : '') + '</div>';
  });
  return page('Chat personal', `<div class="crumbs"><a href="../index.html">🏠 Índice</a></div><h1 class="title">💬 Chat personal</h1><div class="meta">${msgs.length} mensajes</div>${rows.join('')}`);
}

function indexPage(notes, ctx, snipPaths, drugPaths = [], chatCount = 0) {
  const link = (path, text) => `<a href="${escapeHtml(rel('', path))}">${escapeHtml(text)}</a>`;
  const live = notes.filter((n) => !n.trashed);
  const tree = (parentId) => {
    const kids = [...store.folders.values()].filter((f) => (f.parentId || null) === parentId && (!parentId || store.folders.has(parentId)))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name || '').localeCompare(b.name || '', 'es'));
    const items = live.filter((n) => (n.folderId && store.folders.has(n.folderId) ? n.folderId : null) === parentId);
    if (!kids.length && !items.length) return '';
    return `<ul>${kids.map((f) => `<li>📁 <b>${escapeHtml(f.name || 'Carpeta')}</b>${tree(f.id)}</li>`).join('')}`
      + `${items.map((n) => `<li>📝 ${link(ctx.notePath.get(n.id), n.title || 'Sin título')}</li>`).join('')}</ul>`;
  };
  const trash = notes.filter((n) => n.trashed);
  return page('Dr.Folio — índice',
    `<h1 class="title">Dr.Folio</h1><div class="meta">Exportado el ${escapeHtml(new Date().toLocaleString('es-ES'))} · ${live.length} notas · ${snipPaths.length} prerredactados · ${drugPaths.length} fármacos</div>`
    + `<h2>🗂 Notas</h2><div class="tree">${tree(null) || '<p class="muted">Sin notas</p>'}</div>`
    + (snipPaths.length ? `<h2>📋 Prerredactados</h2><ul>${snipPaths.map(([s, p]) => `<li>${link(p, s.title || 'Sin título')}</li>`).join('')}</ul>` : '')
    + (drugPaths.length ? `<h2>💊 Vademécum</h2><ul>${drugPaths.map(([d, p]) => `<li>${link(p, d.title)}${d.drugPath.includes('›') ? ` <span class="muted">· ${escapeHtml(d.drugPath.replace(/^💊 Vademécum › /, ''))}</span>` : ''}</li>`).join('')}</ul>` : '')
    + (chatCount ? `<h2>💬 Chat personal</h2><ul><li>${link('Chat/Chat personal.html', `Chat personal (${chatCount} mensajes)`)}</li></ul>` : '')
    + (trash.length ? `<h2>🗑 Papelera</h2><ul>${trash.map((n) => `<li>${link(ctx.notePath.get(n.id), n.title || 'Sin título')}</li>`).join('')}</ul>` : ''));
}

// ====================== Restaurar ======================
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);

/** Lee y valida una copia. Devuelve { data, fileData, meta } o lanza un Error con el motivo */
export function parseBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('El archivo no es un JSON válido (¿está incompleto o es otro archivo?).'); }
  if (!isObj(raw)) throw new Error('El archivo no es una copia de Dr.Folio.');
  let src, version;
  if (raw.format === BACKUP_FORMAT) {
    version = Number(raw.formatVersion) || 0;
    if (version > BACKUP_VERSION) throw new Error(`Esta copia es de una versión más nueva de la app (formato ${version}). Actualiza Dr.Folio y vuelve a intentarlo.`);
    if (version < 1 || !isObj(raw.data)) throw new Error('La copia está dañada (faltan los datos).');
    src = raw.data;
  } else if (raw.app === 'Dr.Folio' && Array.isArray(raw.notes)) {
    version = 0; src = raw; // copia antigua (≤ v1.8.0)
  } else throw new Error('El archivo no es una copia de Dr.Folio.');

  const data = {}; let skipped = 0;
  const present = {};
  for (const c of COLS) {
    present[c] = Array.isArray(src[c]);
    const arr = src[c] == null ? [] : src[c];
    if (!Array.isArray(arr)) throw new Error(`La copia está dañada («${c}» no es una lista).`);
    const seen = new Set();
    data[c] = [];
    for (const d of arr) {
      if (!isObj(d) || typeof d.id !== 'string' || !ID_RE.test(d.id) || seen.has(d.id)) { skipped++; continue; }
      seen.add(d.id);
      data[c].push(fixDoc(c, d));
    }
  }
  const fileData = {};
  if (isObj(raw.fileData)) {
    for (const [id, v] of Object.entries(raw.fileData)) {
      if (typeof v !== 'string' || !ID_RE.test(id)) continue;
      const b64 = v.startsWith('data:') ? v.slice(v.indexOf(',') + 1) : v;
      if (/^[A-Za-z0-9+/=\s]*$/.test(b64.slice(0, 2000))) fileData[id] = b64;
    }
  }
  const exportedMs = Number(raw.exportedAtMs) || Date.parse(raw.exportedAt) || 0;
  const counts = Object.fromEntries(COLS.map((c) => [c, data[c].length]));
  const withData = data.files.filter((f) => fileData[f.id]).length;
  return { data, fileData, present, meta: { version, appVersion: raw.appVersion || raw.version || '?', exportedMs, counts, withData, skipped } };
}

const resId = () => `r${Math.random().toString(36).slice(2, 10)}`;
/** Limpia un documento leído del archivo (el HTML de las notas se vuelve a sanear) */
function fixDoc(c, d) {
  const x = { ...d };
  if (c === 'notes') {
    for (const f of DERIVED_FIELDS) delete x[f]; // se recalculan al escribir
    x.html = sanitize(typeof x.html === 'string' ? x.html : '');
    x.title = typeof x.title === 'string' ? x.title : '';
    x.text = typeof x.text === 'string' ? x.text : '';
    x.tags = Array.isArray(x.tags) ? x.tags.filter((t) => typeof t === 'string') : [];
    x.refs = Array.isArray(x.refs) ? x.refs.filter(isObj) : [];
  }
  if (c === 'snippets') {
    x.title = typeof x.title === 'string' ? x.title : '';
    x.body = typeof x.body === 'string' ? x.body : '';
    if ('html' in x) x.html = sanitize(typeof x.html === 'string' ? x.html : ''); // la huella `bh` dice si sigue al día
  }
  if (c === 'drugs') {
    for (const f of DRUG_DERIVED) delete x[f]; // se recalculan al escribir
    x.html = sanitize(typeof x.html === 'string' ? x.html : '');
    x.text = typeof x.text === 'string' ? x.text : '';
    x.name = typeof x.name === 'string' ? x.name : '';
    const strs = (a) => (Array.isArray(a) ? a.filter((t) => typeof t === 'string') : []);
    x.brands = strs(x.brands);
    x.presentations = strs(x.presentations);
    x.regimens = Array.isArray(x.regimens) ? x.regimens.filter(isObj) : [];
    for (const f of ['fluids', 'observations', 'contraindications', 'compat', 'scopes']) if (f in x) x[f] = strs(x[f]); // v1.22.0
    if ('presBrands' in x) x.presBrands = Array.isArray(x.presBrands) ? x.presBrands.filter((v) => isObj(v) && typeof v.p === 'string').map((v) => ({ p: v.p, b: strs(v.b) })) : [];
    if ('mergedInto' in x) x.mergedInto = typeof x.mergedInto === 'string' && ID_RE.test(x.mergedInto) ? x.mergedInto : null; // v1.24.0
    if ('pregnancy' in x) x.pregnancy = isObj(x.pregnancy) ? { cat: String(x.pregnancy.cat || ''), note: String(x.pregnancy.note || '') } : { cat: '', note: '' };
    if ('source' in x) x.source = isObj(x.source) ? { text: String(x.source.text || ''), url: /^https?:\/\//i.test(String(x.source.url || '')) ? String(x.source.url) : '' } : { text: '', url: '' };
    if ('resources' in x) x.resources = normResources(x.resources, resId); // v1.27.0: solo http/https, texto plano
  }
  if (c === 'drugFolders' && 'resources' in x) x.resources = normResources(x.resources, resId, { withReg: false });
  if (c === 'chat') {
    x.text = typeof x.text === 'string' ? x.text : '';
    x.files = Array.isArray(x.files) ? x.files.filter((f) => typeof f === 'string' && ID_RE.test(f)) : [];
    x.pinned = x.pinned === true;
    x.createdAt = Number(x.createdAt) || 0;
  }
  if (c === 'files') {
    x.size = Number(x.size) || 0;
    x.chunks = Number(x.chunks) || 0;
  }
  return x;
}

const sameDoc = (a, b) => JSON.stringify(sortKeys(clean(a))) === JSON.stringify(sortKeys(clean(b)));
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/**
 * Calcula qué hay que escribir y borrar.
 *  merge:   añade lo que falta; si está en los dos sitios gana el updatedAt más reciente. Nunca borra.
 *  replace: deja exactamente lo de la copia (escribe lo distinto y borra lo que no está en ella).
 * Los archivos no cambian nunca: si ya existe, no se reescribe. Sin datos en la copia, no se puede crear.
 */
export function planRestore(parsed, mode) {
  const { data, fileData } = parsed;
  const plan = { mode, add: {}, upd: {}, del: {}, writes: [], deletes: [], noData: 0, writeOps: 0, deleteOps: 0 };
  for (const c of COLS) {
    plan.add[c] = 0; plan.upd[c] = 0; plan.del[c] = 0;
    const local = c === 'notes' ? new Map([...store.notes.values()].map((n) => [n.id, fullNote(n)]))
      : c === 'drugs' ? new Map([...store.drugs.values()].map((d) => [d.id, fullDrug(d)]))
        : c === 'chat' ? chatLocal : store[c];
    const per = BODY_COL[c] ? 2 : 1; // nota = notes/{id} + noteBodies/{id} · fármaco = drugs/{id} + drugBodies/{id}
    const inBackup = new Set();
    for (const d of data[c]) {
      inBackup.add(d.id);
      const l = local.get(d.id);
      if (c === 'files') {
        if (l) continue;
        if (!fileData[d.id]) { plan.noData++; continue; }
        const bytes = Math.floor(fileData[d.id].replace(/\s/g, '').length * 3 / 4);
        const chunks = Math.max(1, Math.ceil(bytes / LIMITS.chunkBytes));
        plan.writes.push({ c, d, chunks }); plan.add[c]++; plan.writeOps += chunks + 1;
        continue;
      }
      if (!l) { plan.writes.push({ c, d }); plan.add[c]++; plan.writeOps += per; continue; }
      const write = mode === 'merge' ? tsOf(d) > tsOf(l) : !sameDoc(d, l);
      if (write) { plan.writes.push({ c, d }); plan.upd[c]++; plan.writeOps += per; }
    }
    if (mode === 'replace' && (!OPTIONAL.includes(c) || parsed.present?.[c] !== false)) {
      for (const l of local.values()) {
        if (inBackup.has(l.id)) continue;
        const ops = c === 'files' ? (l.chunks || 0) + 1 : per;
        plan.deletes.push({ c, id: l.id, chunks: c === 'files' ? l.chunks || 0 : 0 });
        plan.del[c]++; plan.deleteOps += ops;
      }
    }
  }
  return plan;
}

// ---------- Límite diario (plan gratuito) ----------
/** Día de Firestore: las cuotas se reinician a medianoche de California */
const quotaDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
export function quotaToday() {
  const q = ls.get(QUOTA_KEY);
  return q && q.day === quotaDay() ? q : { day: quotaDay(), w: 0, d: 0 };
}
export function addQuota(w, d) { const q = quotaToday(); q.w += w; q.d += d; ls.set(QUOTA_KEY, q); }
export const budget = () => { const q = quotaToday(); return { w: Math.max(0, DAY_WRITES - DAY_RESERVE - q.w), d: Math.max(0, DAY_WRITES - DAY_RESERVE - q.d) }; };

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Ejecuta el plan por lotes (≤ 450 operaciones y ≤ 8 MB por lote). Se detiene al llegar al límite diario. */
async function runPlan(plan, onProgress) {
  // Cada elemento se prepara justo antes de escribirlo (los archivos no se decodifican todos a la vez)
  const ops = []; // { w, d, make: () => [{ op: 'set'|'del', r, data?, bytes }] }
  for (const x of plan.writes) {
    if (x.c === 'files') {
      ops.push({ w: x.chunks + 1, d: 0, make: () => {
        const bytes = base64ToBytes(x.parsed.fileData[x.d.id].replace(/\s/g, ''));
        const n = Math.max(1, Math.ceil(bytes.length / LIMITS.chunkBytes));
        const chunkCol = collection(db, 'users', store.uid, 'files', x.d.id, 'chunks');
        const group = [];
        for (let i = 0; i < n; i++) {
          const d = bytesToBase64(bytes.subarray(i * LIMITS.chunkBytes, (i + 1) * LIMITS.chunkBytes));
          group.push({ op: 'set', r: doc(chunkCol, String(i).padStart(3, '0')), data: { d }, bytes: d.length + 100 });
        }
        // Los metadatos, al final: si existen, el archivo está completo
        group.push({ op: 'set', r: ref('files', x.d.id), data: { ...clean(x.d), chunks: n, size: bytes.length }, bytes: 1000 });
        return group;
      } });
    } else if (x.c === 'notes') {
      // Nota completa de la copia → notes/{id} (ligera) + noteBodies/{id} (contenido), con el mismo updatedAt
      ops.push({ w: 2, d: 0, make: () => {
        const { html, text, refs, ...rest } = clean(x.d);
        const body = { html: html || '', text: text || '', refs: refs || [], updatedAt: Number(rest.updatedAt) || Number(rest.createdAt) || 0 };
        const light = { ...rest, ...deriveLight(body) };
        const size = JSON.stringify(body).length;
        return [
          { op: 'set', r: ref('noteBodies', x.d.id), data: body, bytes: size + 200, after: () => rememberBody(x.d.id, body) },
          { op: 'set', r: ref('notes', x.d.id), data: light, bytes: JSON.stringify(light).length + 200 }
        ];
      } });
    } else if (x.c === 'drugs') {
      // Ficha completa → drugs/{id} (ligera) + drugBodies/{id} («Mis notas»), con bodyAt = updatedAt del cuerpo
      ops.push({ w: 2, d: 0, make: () => {
        const { html, text, ...rest } = clean(x.d);
        const t = Number(rest.updatedAt) || Number(rest.createdAt) || 1;
        const body = { html: html || '', text: text || '', updatedAt: t };
        const light = { ...rest, ...deriveDrugLight(body), bodyAt: body.html ? t : 0 };
        return [
          { op: 'set', r: ref('drugBodies', x.d.id), data: body, bytes: JSON.stringify(body).length + 200, after: () => rememberDrugBody(x.d.id, body) },
          { op: 'set', r: ref('drugs', x.d.id), data: light, bytes: JSON.stringify(light).length + 200 }
        ];
      } });
    } else {
      ops.push({ w: 1, d: 0, make: () => { const data = clean(x.d); return [{ op: 'set', r: ref(x.c, x.d.id), data, bytes: JSON.stringify(data).length + 200 }]; } });
    }
  }
  // Primero se escribe y después se borra: si se corta, nunca queda menos de lo que había
  for (const x of plan.deletes) {
    ops.push({ w: 0, d: x.chunks + (BODY_COL[x.c] ? 2 : 1), make: () => {
      const group = [];
      const chunkCol = collection(db, 'users', store.uid, 'files', x.id, 'chunks');
      for (let i = 0; i < x.chunks; i++) group.push({ op: 'del', r: doc(chunkCol, String(i).padStart(3, '0')), bytes: 100 });
      if (BODY_COL[x.c]) group.push({ op: 'del', r: ref(BODY_COL[x.c], x.id), bytes: 100 });
      group.push({ op: 'del', r: ref(x.c, x.id), bytes: 100 });
      return group;
    } });
  }
  const total = plan.writeOps + plan.deleteOps;
  let done = 0;
  let batch = null, n = 0, bytes = 0, bw = 0, bd = 0, after = [];
  const left = budget();
  const commit = async () => {
    if (!n) return;
    await batch.commit();
    after.forEach((f) => f()); after = [];
    addQuota(bw, bd); left.w -= bw; left.d -= bd;
    done += n; onProgress(done, total);
    batch = null; n = 0; bytes = 0; bw = 0; bd = 0;
  };
  for (const o of ops) {
    if (o.w + bw > left.w || o.d + bd > left.d) { await commit(); if (o.w > left.w || o.d > left.d) return { done, total, stopped: true }; }
    const group = o.make();
    for (const g of group) {
      if (batch && (n >= 450 || bytes + g.bytes > 8 * 1024 * 1024)) await commit();
      if (!batch) batch = writeBatch(db);
      if (g.op === 'set') batch.set(g.r, g.data); else batch.delete(g.r);
      if (g.after) after.push(g.after);
      n++; bytes += g.bytes;
      if (g.op === 'set') bw++; else bd++;
    }
  }
  await commit();
  return { done, total, stopped: false };
}

async function startRestore(file) {
  hooks.beforeRun();
  if (!navigator.onLine) { toast('Necesitas conexión a internet para restaurar', 'error'); return; }
  if (!allLoaded() || Object.values(store.fromCache).some(Boolean)) {
    toast('Espera a que se sincronicen tus datos (indicador verde) y vuelve a intentarlo', 'error', 4500); return;
  }
  try { await ensureAllBodies(); } catch (e) { toast(e.message, 'error', 5000); return; } // para comparar con la copia
  try { chatLocal = new Map((await hooks.allChat()).map((m) => [m.id, m])); } catch (e) { toast(e.message, 'error', 5000); return; }
  let parsed;
  try { parsed = parseBackup(await file.text()); } catch (e) {
    modal({ title: 'No se puede restaurar', body: el('p', {}, e.message), actions: [{ label: 'Cerrar', primary: true }] }); return;
  }
  const { meta } = parsed;
  const merge = planRestore(parsed, 'merge'), replace = planRestore(parsed, 'replace');
  const job = pendingJob();
  const resuming = job && job.exportedMs === meta.exportedMs;
  let mode = resuming ? job.mode : 'merge';
  const q = quotaToday(), b = budget();
  const opsLine = (p) => {
    const add = Object.values(p.add).reduce((a, x) => a + x, 0), upd = Object.values(p.upd).reduce((a, x) => a + x, 0), del = Object.values(p.del).reduce((a, x) => a + x, 0);
    if (!add && !upd && !del) return 'No hay nada que cambiar: ya está todo igual.';
    return `Elementos: se añadirán ${add.toLocaleString('es-ES')}, se actualizarán ${upd.toLocaleString('es-ES')}`
      + (p.mode === 'replace' ? ` y se borrarán ${del.toLocaleString('es-ES')}` : '') + ` · ${(p.writeOps + p.deleteOps).toLocaleString('es-ES')} operaciones`;
  };
  const quotaWarn = (p) => (p.writeOps > b.w || p.deleteOps > b.d)
    ? `⚠️ Supera el límite gratuito de hoy (${DAY_WRITES.toLocaleString('es-ES')} escrituras/día; ya llevas ${q.w.toLocaleString('es-ES')}). Se hará hasta ${b.w.toLocaleString('es-ES')} y se parará: mañana vuelve a elegir este mismo archivo y continuará donde se quedó.`
    : (p.writeOps > (DAY_WRITES - q.w) * 0.6 ? `Aviso: usará buena parte del límite gratuito de hoy (${DAY_WRITES.toLocaleString('es-ES')} escrituras/día).` : '');
  const info = el('div', { class: 'bk-plan' });
  const renderInfo = () => {
    const p = mode === 'merge' ? merge : replace;
    const w = quotaWarn(p);
    info.replaceChildren(...[el('p', {}, opsLine(p)), w ? el('p', { class: 'bk-warn' }, w) : null,
      p.noData ? el('p', { class: 'muted small' }, `${p.noData} archivo(s) no se pueden recuperar: la copia es «sin archivos».`) : null].filter(Boolean));
  };
  const radio = (value, title, desc) => el('label', { class: 'bk-mode' },
    el('input', { type: 'radio', name: 'bkmode', value, checked: mode === value, onchange: () => { mode = value; renderInfo(); } }),
    el('span', {}, el('b', {}, title), el('br'), el('span', { class: 'muted small' }, desc)));
  renderInfo();
  const go = await modal({
    title: 'Restaurar copia',
    body: [
      el('p', {}, `Copia del ${meta.exportedMs ? longDate(meta.exportedMs) : '(fecha desconocida)'} · Dr.Folio v${meta.appVersion}${meta.version ? '' : ' (formato antiguo)'}`),
      summaryTable(meta.counts, { files: meta.counts.files ? `(${meta.withData} con imagen/PDF incluido)` : '' }),
      meta.skipped ? el('p', { class: 'bk-warn' }, `⚠️ ${meta.skipped} elemento(s) dañados se ignorarán.`) : null,
      resuming ? el('p', { class: 'bk-warn' }, `⏸ Continúa la restauración del ${new Date(job.at).toLocaleDateString('es-ES')} (${job.done.toLocaleString('es-ES')} de ${job.total.toLocaleString('es-ES')}).`) : null,
      radio('merge', 'Fusionar (recomendado)', 'Añade lo que falta. Si algo está en los dos sitios, se queda la versión más reciente. Nunca borra.'),
      radio('replace', 'Reemplazar todo', 'Deja la app exactamente como en la copia: borra lo que no esté en ella. Antes se descarga una copia del estado actual.'),
      info
    ],
    actions: [{ label: 'Cancelar' }, { label: 'Restaurar', primary: true, value: 'go' }]
  });
  if (go !== 'go') return;
  const plan = mode === 'merge' ? merge : replace;
  plan.writes.forEach((w) => { w.parsed = parsed; });
  if (!plan.writes.length && !plan.deletes.length) { toast('Ya está todo igual: no hay nada que restaurar', 'ok'); ls.del(JOB_KEY); hooks.onChange(); return; }

  if (mode === 'replace') {
    const word = el('input', { type: 'text', placeholder: 'BORRAR', autocomplete: 'off', autocapitalize: 'characters' });
    const ok = await modal({
      title: '⚠️ Reemplazar todo',
      body: [el('p', {}, `Se borrarán ${Object.values(plan.del).reduce((a, x) => a + x, 0)} elementos que no están en la copia y se sobrescribirá lo demás.`),
        el('p', {}, 'Antes se descargará una copia de seguridad del estado actual.'),
        el('label', {}, 'Escribe BORRAR para confirmar', word)],
      actions: [{ label: 'Cancelar' }, { label: 'Reemplazar', primary: true, danger: true, value: 'ok', onClick: () => {
        if (word.value.trim().toUpperCase() !== 'BORRAR') { word.focus(); toast('Escribe BORRAR para confirmar', 'error'); return false; }
        return true;
      } }]
    });
    if (ok !== 'ok') return;
  }

  const p = progress(mode === 'merge' ? 'Restaurando (fusionar)' : 'Restaurando (reemplazar todo)');
  let safety = null;
  try {
    if (mode === 'replace' && !(resuming && job.mode === 'replace' && job.safetyDone)) {
      p.set(0, 'Copia del estado actual antes de reemplazar…');
      const r = await buildBackup({ withFiles: true, onProgress: (f, t, s) => p.set(f * 0.3, `Copia del estado actual · ${t}`, s) });
      safety = { blob: r.blob, name: `drfolio-antes-de-restaurar-${stamp()}.json` };
      download(safety.name, safety.blob);
      markBackup();
    }
    ls.set(JOB_KEY, { mode, exportedMs: meta.exportedMs, fileName: file.name, at: Date.now(), done: 0, total: plan.writeOps + plan.deleteOps, safetyDone: mode === 'replace' });
    const base = mode === 'replace' && safety ? 0.3 : 0;
    p.set(base, 'Escribiendo…', 'No cierres la app hasta que termine');
    const res = await runPlan(plan, (done, total) => {
      p.set(base + (1 - base) * done / total, `Escribiendo… ${done.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')}`, 'No cierres la app hasta que termine');
      const j = pendingJob(); if (j) { j.done = (resuming ? job.done : 0) + done; ls.set(JOB_KEY, j); }
    });
    const safetyBtn = safety ? [el('p', { class: 'muted small' }, `Copia del estado anterior descargada: ${safety.name}`), deliverButtons(safety.blob, safety.name)] : [];
    if (res.stopped) {
      const j = pendingJob() || {};
      ls.set(JOB_KEY, { ...j, total: (resuming ? job.done : 0) + res.total });
      p.finish(`⏸ Pausado por el límite gratuito de hoy (${res.done.toLocaleString('es-ES')} de ${res.total.toLocaleString('es-ES')}).`, [
        el('p', {}, `Mañana vuelve a Ajustes → Copia de seguridad → Restaurar y elige el mismo archivo («${file.name}»): continuará donde se quedó.`), ...safetyBtn]);
    } else {
      ls.del(JOB_KEY);
      p.finish(`✓ Restauración completada (${res.total.toLocaleString('es-ES')} operaciones)`, safetyBtn);
    }
  } catch (e) {
    console.error(e);
    p.finish(`⚠️ Se interrumpió: ${e.message || e}`, [el('p', {}, 'Lo ya escrito se queda. Vuelve a elegir el mismo archivo para continuar.'),
      ...(safety ? [deliverButtons(safety.blob, safety.name)] : [])]);
  }
  hooks.onChange();
}

// ====================== Ventana principal ======================
export function openBackup() {
  if (hooks.isPublic()) {
    modal({ title: 'Copia de seguridad', body: el('p', {}, `🔒 ${PUBLIC_REASON}`), actions: [{ label: 'Entendido', primary: true }] });
    return;
  }
  const last = lastBackupAt();
  const filesSize = [...store.files.values()].reduce((s, f) => s + (f.size || 0), 0);
  const withFiles = el('input', { type: 'checkbox', checked: true });
  const input = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, onchange: (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (f) { close?.(); startRestore(f); }
  } });
  let close = null;
  const job = pendingJob();
  modal({
    title: 'Copia de seguridad',
    cls: 'backup',
    onOpen: (_, c) => { close = c; },
    body: [
      el('p', { class: 'muted small' }, last ? `Última copia en este dispositivo: ${longDate(last)}` : 'Aún no has hecho ninguna copia en este dispositivo.'),
      job ? el('p', { class: 'bk-warn' }, `⏸ Restauración a medias («${job.fileName}»): elige ese archivo en «Restaurar» para continuar.`) : null,
      el('h4', {}, '💾 Copia completa (.json)'),
      el('p', { class: 'muted small' }, 'Todo: notas, carpetas, etiquetas, prerredactados y sus carpetas. Sirve para restaurar.'),
      el('label', { class: 'bk-check' }, withFiles, ` Incluir imágenes y PDF (${store.files.size} archivos, ${formatBytes(filesSize)})`),
      el('div', { class: 'bk-actions' }, el('button', { type: 'button', class: 'btn primary', onclick: () => { close?.(); exportJson(withFiles.checked); } }, 'Hacer copia')),
      el('h4', {}, '📖 Exportación legible (.zip)'),
      el('p', { class: 'muted small' }, 'Una carpeta por cada carpeta de notas y cada nota en .html con sus imágenes y PDF al lado. Se abre sin la app.'),
      el('div', { class: 'bk-actions' }, el('button', { type: 'button', class: 'btn', onclick: () => { close?.(); exportZip(); } }, 'Exportar .zip')),
      el('h4', {}, '♻️ Restaurar desde una copia (.json)'),
      el('p', { class: 'muted small' }, 'Antes de cambiar nada verás un resumen y podrás elegir Fusionar o Reemplazar.'),
      el('div', { class: 'bk-actions' }, el('button', { type: 'button', class: 'btn', onclick: () => input.click() }, 'Elegir archivo…'), input)
    ],
    actions: [{ label: 'Cerrar' }]
  });
}

export const backupPublicReason = PUBLIC_REASON;
// Para pruebas desde la consola
window.drfolioBackup = { parseBackup, planRestore, quotaToday };
