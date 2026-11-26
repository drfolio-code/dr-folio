// Componentes de interfaz propios (sin alert/prompt nativos: fallan en PWA de iOS)
import { el, $, norm } from './util.js';

export function toast(msg, type = '', ms = 2800) {
  const t = el('div', { class: `toast ${type}` }, msg);
  $('#toast-root').append(t);
  setTimeout(() => t.remove(), ms);
}

let openCount = 0;
export const modalOpen = () => openCount > 0;

/**
 * Modal genérico. actions: [{label, primary, danger, value, onClick}]
 * onClick puede devolver false para no cerrar. Resuelve con el value de la acción o undefined.
 */
export function modal({ title, body, actions = [{ label: 'Cerrar', value: undefined }], wide = false, cls = '', onOpen }) {
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
        el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => close(undefined) }, '✕')),
      el('div', { class: 'modal-body' }, body || ''),
      foot);
    const back = el('div', { class: `modal-back ${cls ? `has-${cls}` : ''}`, onmousedown: (e) => { if (e.target === back) close(undefined); } }, box);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
        const primary = actions.find((a) => a.primary);
        if (primary) { e.preventDefault(); e.stopPropagation(); foot.querySelector('.btn.primary').click(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    $('#modal-root').append(back);
    if (onOpen) onOpen(box, close);
    const first = box.querySelector('input, textarea, select');
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 30);
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
    items.map((it) => it === '-' ? el('hr') : el('button', {
      type: 'button', class: it.danger ? 'danger' : '',
      onclick: () => { closeMenu(); it.onClick(); }
    }, it.icon ? el('span', {}, it.icon) : null, it.label)));
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - mw - 8);
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
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

/** Paleta de colores. Resuelve con el color, '' para quitar o undefined si cancela. */
export function colorPicker(title, colors) {
  let chosen;
  let closeFn = () => {};
  const sw = el('div', { class: 'swatches' },
    colors.map((c) => el('button', {
      type: 'button', class: `swatch ${c ? '' : 'none'}`, title: c || 'Quitar',
      style: c ? { background: c } : {},
      onclick: () => { chosen = c; closeFn(); }
    })));
  return modal({ title, body: sw, actions: [], onOpen: (_b, close) => { closeFn = () => close(chosen); } }).then(() => chosen);
}
