// Iconos SVG propios (Lucide, ISC), iguales en todos los dispositivos: no dependen de las fuentes de emoji del sistema.
// Toman el color del texto (currentColor), así se ven bien en modo claro y oscuro.
//   icon('notebook-text')           → <svg class="i"><use href="#i-notebook-text"/></svg>
//   En HTML:  <svg class="i" aria-hidden="true"><use href="#i-settings"/></svg>
// Los dibujos están en vendor/icons.js (solo los que se usan; para añadir uno: tools/build-icons.mjs).
import { ICONS } from '../vendor/icons.js';

const NS = 'http://www.w3.org/2000/svg';

/** Mete una sola vez en la página un <svg> oculto con todos los iconos (cada uno es un <symbol>) */
function injectSprite() {
  if (document.getElementById('icon-sprite')) return;
  const markup = `<svg xmlns="${NS}" id="icon-sprite" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">`
    + Object.entries(ICONS).map(([name, inner]) => `<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`).join('')
    + '</svg>';
  // Contenido fijo del propio código (no son datos del usuario)
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
  document.body.prepend(document.importNode(svg, true));
}
injectSprite();

export const hasIcon = (name) => typeof name === 'string' && Object.prototype.hasOwnProperty.call(ICONS, name);

/** Nodo <svg> con el icono `name` (clase extra opcional) */
export function icon(name, cls = '') {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('class', `i i-${name}${cls ? ` ${cls}` : ''}`);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  const u = document.createElementNS(NS, 'use');
  u.setAttribute('href', `#i-${name}`);
  s.append(u);
  return s;
}

/** Icono si `x` es el nombre de un icono; si no, el texto tal cual (para menús que aún usan un carácter) */
export const iconOr = (x) => (hasIcon(x) ? icon(x) : x);
