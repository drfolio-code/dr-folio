// Componentes de interfaz propios (sin alert/prompt nativos: fallan en PWA de iOS)
import { el, $, norm } from './util.js';
import { iconOr } from './icons.js';

export function toast(msg, type = '', ms = 2800) {
  const t = el('div', { class: `toast ${type}` }, msg);
  $('#toast-root').append(t);
  setTimeout(() => t.remove(), ms);
}

/** Aviso con botón «Deshacer» (v1.29.0): onUndo se llama una sola vez si se pulsa antes de que desaparezca */
export function undoToast(msg, onUndo, ms = 7000) {
  let used = false;
  const t = el('div', { class: 'toast ok has-undo', role: 'status' }, el('span', {}, msg),
    el('button', { class: 'toast-undo', type: 'button', onclick: () => { if (used) return; used = true; t.remove(); onUndo(); } }, 'Deshacer'));
  $('#toast-root').append(t);
  setTimeout(() => t.remove(), ms);
}

let openCount = 0;
export const modalOpen = () => openCount > 0;

/**
 * Modal genérico. actions: [{label, primary, danger, value, onClick}]
 * onClick puede devolver false para no cerrar. Resuelve con el value de la acción o undefined.
 */
export function modal({ title, body, actions = [{ label: 'Cerrar', value: undefined }], wide = false, cls = '', onOpen, autofocus = true }) {
  return new Promise((resolve) => {
    openCount++;
    const close = (val) => {
      openCount--;
      back.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(val);
    };
    const foot = actions.length ? el('div', { class: 'modal-foot' },
      actions.map((a) => el('button', {
        type: 'button',
        class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`,
        onclick: async () => {
          if (a.onClick) { const r = await a.onClick(); if (r === false) return; }
          close(a.value);
        }
      }, a.label))) : null;
    const box = el('div', { class: `modal ${wide ? 'wide' : ''} ${cls}`, role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'modal-head' },
        el('h3', {}, title || ''),
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => close(undefined) }, iconOr('x'))),
      el('div', { class: 'modal-body' }, body || ''),
      foot);
    const back = el('div', { class: `modal-back ${cls ? `has-${cls}` : ''}`, onmousedown: (e) => { if (e.target === back) close(undefined); } }, box);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON' && !e.target.closest?.('[data-own-enter]')) {
        const primary = actions.find((a) => a.primary);
        if (primary) { e.preventDefault(); e.stopPropagation(); foot.querySelector('.btn.primary').click(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    $('#modal-root').append(back);
    if (onOpen) onOpen(box, close);
    const first = box.querySelector('input, textarea, select');
    if (first && autofocus) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 30);
  });
}

export async function prompt(title, value = '', { placeholder = '', label = '', okLabel = 'Aceptar' } = {}) {
  const input = el('input', { type: 'text', value, placeholder, maxlength: 300 });
  const res = await modal({
    title,
    body: label ? el('label', {}, label, input) : input,
    actions: [{ label: 'Cancelar' }, { label: okLabel, primary: true, value: 'ok' }]
  });
  return res === 'ok' ? input.value.trim() : null;
}

export async function confirm(title, message, { okLabel = 'Aceptar', danger = false } = {}) {
  const res = await modal({
    title,
    body: el('p', {}, message),
    actions: [{ label: 'Cancelar' }, { label: okLabel, primary: true, danger, value: true }]
  });
  return res === true;
}

/** Menú contextual junto a un elemento. items: [{label, icon, danger, onClick} | '-'] */
export function menu(anchor, items) {
  closeMenu();
  const m = el('div', { class: 'menu', role: 'menu' },
    items.filter(Boolean).map((it) => it === '-' ? el('hr') : el('button', {
      type: 'button', class: it.danger ? 'danger' : '',
      onclick: () => { closeMenu(); it.onClick(); }
    }, it.icon ? el('span', {}, iconOr(it.icon)) : null, it.label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  // Alto visible de verdad (en iOS, con el teclado abierto, innerHeight no cambia)
  const vv = window.visualViewport;
  const vTop = vv ? vv.offsetTop : 0;
  const vBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  m.style.maxHeight = `${Math.max(160, Math.max(vBottom - r.bottom, r.top - vTop) - 12)}px`;
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - mw - 8);
  let top = r.bottom + 4;
  if (top + mh > vBottom - 8) top = Math.max(vTop + 8, r.top - mh - 4);
  m.style.left = `${Math.max(8, left)}px`;
  m.style.top = `${top}px`;
  setTimeout(() => {
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', esc, true);
  }, 0);
  function outside(e) { if (!m.contains(e.target)) closeMenu(); }
  function esc(e) { if (e.key === 'Escape') closeMenu(); }
  current = { m, outside, esc };
}
let current = null;
export function closeMenu() {
  if (!current) return;
  current.m.remove();
  document.removeEventListener('pointerdown', current.outside, true);
  document.removeEventListener('keydown', current.esc, true);
  current = null;
}

/** Selector con buscador. items: [{id, label, sub, depth}]. Resuelve con id o undefined. */
export function picker(title, items, { placeholder = 'Buscar…', emptyText = 'Sin resultados' } = {}) {
  const search = el('input', { type: 'search', placeholder, autocomplete: 'off' });
  const list = el('div', { class: 'pick-list' });
  let chosen;
  let shown = [];
  let kb = 0;
  const render = () => {
    const q = norm(search.value.trim());
    shown = items.filter((it) => !q || norm(`${it.label} ${it.sub || ''}`).includes(q)).slice(0, 200);
    kb = 0;
    list.replaceChildren(...(shown.length ? shown.map((it, i) => el('button', {
      type: 'button', class: `pick-item ${i === 0 ? 'kb' : ''}`, style: { '--depth': q ? 0 : (it.depth || 0) },
      onclick: () => { chosen = it.id; closeFn(); }
    }, it.label, it.sub ? el('span', { class: 'sub' }, it.sub) : null)) : [el('div', { class: 'list-empty' }, emptyText)]));
  };
  let closeFn = () => {};
  search.addEventListener('input', render);
  search.addEventListener('keydown', (e) => {
    const btns = [...list.querySelectorAll('.pick-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      btns[kb]?.classList.remove('kb');
      kb = Math.max(0, Math.min(btns.length - 1, kb + (e.key === 'ArrowDown' ? 1 : -1)));
      btns[kb]?.classList.add('kb');
      btns[kb]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      btns[kb]?.click();
    }
  });
  render();
  return modal({
    title, body: [search, list], actions: [],
    onOpen: (_box, close) => { closeFn = () => close(chosen); }
  }).then(() => chosen);
}

/** Paleta de colores. kind: 'text' | 'highlight' | 'label'.
 *  Resuelve con el color, '' para quitar o undefined si se cancela. */
const HUES = {
  rojo: ['#fee2e2', '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b'],
  naranja: ['#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412'],
  ámbar: ['#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e'],
  amarillo: ['#fef9c3', '#fef08a', '#fde047', '#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e'],
  lima: ['#ecfccb', '#d9f99d', '#bef264', '#a3e635', '#84cc16', '#65a30d', '#4d7c0f', '#3f6212'],
  verde: ['#dcfce7', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534'],
  turquesa: ['#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#115e59'],
  cian: ['#cffafe', '#a5f3fc', '#67e8f9', '#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75'],
  celeste: ['#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985'],
  azul: ['#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af'],
  índigo: ['#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3'],
  violeta: ['#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6'],
  fucsia: ['#fae8ff', '#f5d0fe', '#f0abfc', '#e879f9', '#d946ef', '#c026d3', '#a21caf', '#86198f'],
  rosa: ['#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d'],
  carmín: ['#ffe4e6', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239'],
  gris: ['#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b']
};
const SHADES = { text: [4, 5, 6, 7], highlight: [0, 1, 2], label: [3, 4, 5] };

const recentKey = (kind) => `drfolio.recentColors.${kind}`;
function getRecent(kind) { try { return JSON.parse(localStorage.getItem(recentKey(kind)) || '[]'); } catch { return []; } }
function pushRecent(kind, c) {
  if (!c) return;
  const r = [c, ...getRecent(kind).filter((x) => x.toLowerCase() !== c.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(recentKey(kind), JSON.stringify(r)); } catch { /* */ }
}

export function colorPicker(title, colors = [], kind = 'label') {
  let chosen;
  let closeFn = () => {};
  const pick = (c) => { chosen = c; pushRecent(kind, c); closeFn(); };
  const swatch = (c, label) => el('button', {
    type: 'button', class: `swatch ${c ? '' : 'none'}`, title: label || c || 'Quitar color',
    'aria-label': label || c || 'Quitar color', style: c ? { background: c } : {},
    onclick: () => pick(c)
  });
  const section = (name, ...nodes) => el('div', { class: 'color-sec' }, el('div', { class: 'color-sec-t' }, name), ...nodes);
  const recent = getRecent(kind);
  const basics = colors.filter(Boolean);
  const shades = SHADES[kind] || SHADES.label;
  const names = Object.keys(HUES);
  // Dos bloques de 8 tonos para que quepa bien en el móvil
  const block = (hueNames) => el('div', { class: 'color-grid' },
    shades.flatMap((si) => hueNames.map((h) => swatch(HUES[h][si], h))));
  const custom = el('input', { type: 'color', value: basics[0] || '#0e7490', 'aria-label': 'Color personalizado' });
  const body = [
    recent.length ? section('Recientes', el('div', { class: 'swatches' }, recent.map((c) => swatch(c)))) : null,
    basics.length ? section('Básicos', el('div', { class: 'swatches' }, basics.map((c) => swatch(c)))) : null,
    section('Más colores', block(names.slice(0, 8)), block(names.slice(8))),
    section('Personalizado', el('div', { class: 'color-custom' }, custom,
      el('button', { type: 'button', class: 'btn sm', onclick: () => pick(custom.value) }, 'Usar este color'),
      el('button', { type: 'button', class: 'btn sm', onclick: () => pick('') }, 'Quitar color')))
  ].filter(Boolean);
  return modal({ title, body, actions: [], onOpen: (_b, close) => { closeFn = () => close(chosen); } }).then(() => chosen);
}
