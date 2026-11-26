// Contenido de los prerredactados (v1.12.0): texto enriquecido + texto plano
//
//   snippets/{id}.html  HTML del editor (el mismo de las notas, saneado con sanitize())
//   snippets/{id}.body  Texto plano equivalente (nodesToPlain): buscar, vista previa, contar campos y COPIAR
//   snippets/{id}.bh    Huella de `body` con la que se guardó `html`
//
// Si `bh` no coincide con la huella de `body` (prerredactado sin migrar, o editado desde una versión
// antigua de la app que solo escribe `body`), el HTML no está al día: se usa el texto plano convertido.
// Los prerredactados son pequeños y se necesitan enteros al instante (copiar desde la lista en iOS debe
// hacerse dentro del toque), así que el contenido va en el mismo documento, no aparte como en las notas.
// Las imágenes van en files/ (como en las notas): en el HTML solo queda <img data-file="ID">.

/** Campos rellenables: {edad}  o con opciones  {lado:derecho|izquierdo} */
export const FIELD_RE = /\{([^{}\n:|]{1,40})(?::([^{}\n]{1,300}))?\}/g;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Huella corta y estable de un texto */
export function bodyHash(t) {
  let h = 5381, g = 0;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); h = ((h * 33) ^ c) >>> 0; g = (g * 31 + c) >>> 0; }
  return `${t.length.toString(36)}.${h.toString(36)}.${g.toString(36)}`;
}

/**
 * Texto plano → HTML: una línea = un párrafo, línea vacía = párrafo vacío. Las líneas con tabuladores
 * o varios espacios llevan class="keep-ws" (se ven y se copian tal cual). Los campos {…} quedan como texto.
 */
export function textToHtml(text) {
  const t = String(text || '');
  if (!t.trim()) return '';
  return t.replace(/\r\n?/g, '\n').split('\n').map((l) => {
    if (!l) return '<p><br></p>';
    const ws = /\t| {2}|^ | $/.test(l) ? ' class="keep-ws"' : '';
    return `<p${ws}>${esc(l)}</p>`;
  }).join('');
}

/** true si el HTML guardado corresponde al texto actual */
export const htmlFresh = (s) => typeof s?.html === 'string' && s.bh === bodyHash(s.body || '');

/** HTML para mostrar/editar un prerredactado (el guardado o, si falta o está desfasado, el texto convertido) */
export const htmlOf = (s) => (htmlFresh(s) ? s.html : textToHtml(s?.body || ''));

/** Imágenes que usa un prerredactado (también las de un HTML desfasado, por seguridad) */
export function snippetFileIds(s) {
  const ids = new Set();
  for (const m of String(s?.html || '').matchAll(/data-file="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}
