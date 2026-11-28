// Aviso de actualización (v1.35.0).
// La app instalada en iOS/Android puede quedarse días en memoria sin recargarse, así que no ve
// las versiones nuevas. Aquí se mira de vez en cuando la versión publicada (APP_VERSION de
// config.js, pidiéndola sin caché) y, si es distinta, sale un aviso «Actualizar»: guarda lo
// pendiente, actualiza el service worker y recarga. No hace falta reinstalar la app.
import { APP_VERSION } from './config.js';
import { el } from './util.js';

const EVERY = 30 * 60 * 1000;   // cada 30 min con la app abierta
const MIN_GAP = 60 * 1000;      // como mucho 1 comprobación por minuto
let lastCheck = 0, shown = null, beforeReload = () => {};

/** Versión publicada ahora mismo en el servidor (null si no hay conexión) */
async function remoteVersion() {
  try {
    const res = await fetch(`js/config.js?v=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const m = (await res.text()).match(/APP_VERSION\s*=\s*["']([^"']+)["']/);
    return m ? m[1] : null;
  } catch { return null; }
}

/** Comprueba si hay versión nueva. manual = desde Ajustes (dice también si no hay nada) */
export async function checkForUpdate({ manual = false } = {}) {
  const now = Date.now();
  if (!manual && now - lastCheck < MIN_GAP) return null;
  lastCheck = now;
  if (!navigator.onLine) return manual ? 'offline' : null;
  const v = await remoteVersion();
  if (!v) return manual ? 'offline' : null;
  if (v === APP_VERSION) return 'same';
  showBanner(v);
  return v;
}

function showBanner(v) {
  if (shown === v) return;
  document.querySelector('#update-banner')?.remove();
  shown = v;
  const btn = el('button', { class: 'btn sm primary', type: 'button', onclick: () => applyUpdate(btn) }, 'Actualizar');
  const bar = el('div', { id: 'update-banner', role: 'status' },
    el('span', { class: 'ub-txt' }, el('b', {}, 'Nueva versión disponible'), el('span', { class: 'ub-v' }, ` · v${v}`)),
    btn,
    el('button', { class: 'ub-close', type: 'button', 'aria-label': 'Ahora no', title: 'Ahora no', onclick: () => bar.remove() }, '×'));
  document.body.append(bar);
}

/** Guarda, instala la versión nueva y recarga */
export async function applyUpdate(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Actualizando…'; }
  try { beforeReload(); } catch { /* nada */ }
  await new Promise((r) => setTimeout(r, 800)); // que lo guardado llegue a la cola local de Firestore
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update();
      const w = reg.installing || reg.waiting;
      if (w && w.state !== 'activated') {
        await new Promise((r) => {
          const t = setTimeout(r, 8000);
          w.addEventListener('statechange', () => { if (w.state === 'activated' || w.state === 'redundant') { clearTimeout(t); r(); } });
        });
      }
    }
  } catch { /* si falla, la recarga ya pide la red primero */ }
  try { sessionStorage.setItem('drfolio.keepRoute', '1'); } catch { /* nada */ } // v1.38.0: tras actualizar, seguir donde estaba
  location.reload();
}

/** Arranque: comprobar al abrir, al volver a la app y cada 30 min */
export function initUpdates({ onBeforeReload } = {}) {
  if (onBeforeReload) beforeReload = onBeforeReload;
  setTimeout(() => checkForUpdate(), 5000);
  setInterval(() => checkForUpdate(), EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  window.addEventListener('online', () => checkForUpdate());
}
