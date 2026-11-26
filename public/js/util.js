// Utilidades generales

/** Crea un elemento: el('div', {class:'x', onclick:fn}, 'texto', otroNodo) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) node.style.setProperty(sk, String(sv)); else node.style[sk] = sv;
      }
    }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function debounce(fn, ms) {
  let t = null;
  const d = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  d.flush = (...args) => { if (t) { clearTimeout(t); t = null; fn(...args); } };
  d.cancel = () => { clearTimeout(t); t = null; };
  d.pending = () => t !== null;
  return d;
}

/** Texto sin acentos y en minúsculas, para buscar */
export function norm(s) {
  return (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Extrae el texto plano de un HTML (para búsqueda y vista previa) */
export function htmlToText(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  doc.querySelectorAll('p,div,h1,h2,h3,h4,li,tr,blockquote,pre').forEach((b) => b.append('\n'));
  doc.querySelectorAll('td,th').forEach((b) => b.append(' '));
  return (doc.body.textContent || '').replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const yearFmt = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fullFmt = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' });

export function shortDate(ms) {
  if (!ms) return '';
  const d = new Date(ms), now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startToday) return timeFmt.format(d);
  if (ms >= startToday - 86400000) return 'ayer';
  if (d.getFullYear() === now.getFullYear()) return dayFmt.format(d);
  return yearFmt.format(d);
}
export const longDate = (ms) => (ms ? fullFmt.format(new Date(ms)) : '');

export function formatBytes(b) {
  if (!b) return '0 KB';
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function slug(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'seccion';
}

export function download(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Texto plano «para pegar en un informe» a partir de nodos del DOM (no usa innerText,
 * así incluye lo plegado). Tablas: columnas separadas por tabuladores. Listas: «- » o «1. ».
 */
export function nodesToPlain(nodes) {
  let out = '';
  let prefix = null; // viñeta pendiente de escribir
  const atStart = () => !out || out.endsWith('\n');
  const nl = () => { if (prefix === null && !atStart()) out += '\n'; };
  const write = (s) => {
    if (prefix !== null) { s = s.replace(/^\s+/, ''); if (!s) return; out += prefix; prefix = null; }
    else if (atStart() || out.endsWith(' ')) s = s.replace(/^ +/, '');
    out += s;
  };
  const cellText = (c) => {
    const parts = [];
    const rec = (n) => {
      if (n.nodeType === 3) parts.push(n.data);
      else if (n.nodeType === 1 && !n.matches('img,button,.sec-copy')) {
        if (n.tagName === 'BR') parts.push(' ');
        else { n.childNodes.forEach(rec); if (/^(P|DIV|LI|H[1-6])$/.test(n.tagName)) parts.push(' '); }
      }
    };
    rec(c);
    return parts.join('').replace(/\s+/g, ' ').trim();
  };
  const walk = (n, depth, pre) => {
    if (n.nodeType === 3) { write(pre ? n.data : n.data.replace(/[\s ]+/g, ' ')); return; }
    if (n.nodeType !== 1 || n.matches('.note-toc,.sec-copy,img,button,script,style')) return;
    const tag = n.tagName;
    if (tag === 'BR') { if (prefix === null) out += '\n'; return; }
    if (tag === 'HR') { nl(); return; }
    if (tag === 'TABLE') {
      nl();
      for (const tr of n.rows) out += `${[...tr.cells].map(cellText).join('\t')}\n`;
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      nl();
      let i = 0;
      const check = n.classList.contains('checklist');
      for (const li of n.children) {
        if (li.tagName !== 'LI') { walk(li, depth, pre); continue; }
        i++;
        nl();
        const mark = tag === 'OL' ? `${i}. ` : check ? (li.dataset.checked === 'true' ? '☑ ' : '☐ ') : '- ';
        prefix = '  '.repeat(depth) + mark;
        li.childNodes.forEach((c) => walk(c, depth + 1, pre));
        prefix = null;
        nl();
      }
      return;
    }
    const heading = /^H[1-6]$/.test(tag);
    const block = heading || /^(P|DIV|BLOCKQUOTE|PRE|SECTION|DETAILS|SUMMARY|FIGURE|LI)$/.test(tag);
    if (heading && out) { nl(); out += '\n'; }
    else if (block) nl();
    n.childNodes.forEach((c) => walk(c, depth, pre || tag === 'PRE'));
    if (block) nl();
  };
  for (const n of nodes) walk(n, 0, false);
  return out.split('\n').map((l) => l.replace(/[  ]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
