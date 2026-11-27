// Genera public/vendor/icons.js con SOLO los iconos de Lucide (licencia ISC) que usa Dr.Folio.
// Regenerar:  cd tools && npm install && npm run vendor:icons
// Para añadir un icono: añade su nombre aquí (ver https://lucide.dev/icons) y vuelve a generar.
import { readFileSync, writeFileSync } from 'node:fs';

const USED = [
  // Módulos y navegación
  'house', 'search', 'plus', 'settings', 'log-out', 'panel-left', 'notebook-text', 'clipboard-list', 'pill', 'message-circle',
  // Vistas, carpetas y etiquetas
  'pin', 'clock', 'trash-2', 'folder', 'folder-open', 'folder-plus', 'folder-input', 'tag', 'star', 'flame', 'book-marked',
  // Vademécum (v1.18.0)
  'arrow-down-a-z', 'triangle-alert', 'file-up', 'list-plus',
  // Chat personal y barra inferior (v1.19.0)
  'paperclip', 'send-horizontal', 'pin-off', 'download', 'external-link', 'smartphone', 'monitor', 'file', 'hourglass',
  'circle-ellipsis', 'sliders-horizontal', 'chevron-up', 'message-square-plus', 'lock',
  // Ficha ampliada del Vademécum (v1.22.0)
  'clipboard-paste', 'droplet',
  // Acciones y menús
  'pencil', 'check', 'copy', 'copy-plus', 'printer', 'book-open', 'undo-2', 'x', 'file-text', 'file-plus', 'palette',
  'arrow-up', 'arrow-down', 'arrow-left', 'square-pen', 'layout-grid', 'list', 'ellipsis', 'save',
  // Barra de formato
  'highlighter', 'image', 'link', 'list-checks', 'bold', 'italic', 'underline', 'strikethrough', 'baseline', 'list-ordered',
  'indent-increase', 'indent-decrease', 'table', 'minus', 'remove-formatting', 'redo-2', 'align-left', 'align-center', 'align-right',
  'subscript', 'superscript', 'calendar-clock', 'braces', 'a-large-small', 'table-of-contents', 'code', 'chevron-down', 'keyboard-off', 'quote', 'heading', 'pilcrow',
  // Vademécum v1.24.0: unir fichas repetidas
  'combine'
];

const dir = new URL('./node_modules/lucide-static/icons/', import.meta.url);
const out = {};
for (const name of USED) {
  const svg = readFileSync(new URL(`${name}.svg`, dir), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    .replace(/\s*\n\s*/g, '').replace(/\s+\/>/g, '/>').trim();
  out[name] = inner;
}
const version = JSON.parse(readFileSync(new URL('./node_modules/lucide-static/package.json', import.meta.url), 'utf8')).version;
const license = readFileSync(new URL('./node_modules/lucide-static/LICENSE', import.meta.url), 'utf8').trim().replace(/^/gm, '// ');
writeFileSync(new URL('../public/vendor/icons.js', import.meta.url),
  `// Iconos de Lucide v${version} (https://lucide.dev) — generado por tools/build-icons.mjs, no editar a mano.\n${license}\n`
  + `export const ICONS = ${JSON.stringify(out, null, 0).replace(/","/g, '",\n  "').replace(/^\{/, '{\n  ').replace(/\}$/, '\n}')};\n`);
console.log(`icons.js: ${USED.length} iconos`);
