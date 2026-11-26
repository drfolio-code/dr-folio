// Editor de texto enriquecido (contenteditable) con pegado limpio, imágenes, tablas,
// listas de tareas, enlaces entre notas e índice automático.
import { DOMPurify } from '../vendor/libs.js';
import { $, $$, el, htmlToText, nodesToPlain } from './util.js';
import { modal, colorPicker, prompt, toast, menu } from './ui.js';
import { FIELD_RE } from './snipbody.js';

// ---------------- Limpieza de HTML ----------------
const ALLOWED_TAGS = ['p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'mark', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption'];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'data-file', 'data-note', 'data-checked', 'data-toc', 'data-collapsed', 'class', 'style'];
const ALLOWED_CLASSES = new Set(['checklist', 'note-link', 'note-toc', 'keep-ws']);
let pasteMode = false;

function parseColor(v) {
  const m = v.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const h = v.trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(h)) return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16), a: 1 };
  if (/^[0-9a-f]{6}$/i.test(h)) return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  if (/^(transparent|inherit|initial|unset|currentcolor)$/i.test(v.trim())) return { r: 0, g: 0, b: 0, a: 0 };
  return null;
}
const lum = (c) => (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;

function cleanStyle(style) {
  const keep = [];
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!val || /url\(|expression|javascript/i.test(val)) continue;
    if (prop === 'text-align' && /^(left|right|center|justify)$/i.test(val)) keep.push(`text-align:${val}`);
    else if (prop === 'font-size' && FONT_SIZES.some((f) => f.v === val)) keep.push(`font-size:${val}`);
    else if (prop === 'color') {
      const c = parseColor(val);
      if (!c || c.a === 0) continue;
      // Al pegar, quitamos negros/grises/blancos (rompen el modo oscuro)
      const sat = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
      if (pasteMode && sat < 40) continue;
      keep.push(`color:${val}`);
    } else if (prop === 'background-color' || prop === 'background') {
      const c = parseColor(val);
      if (!c || c.a === 0) continue;
      const sat = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
      if (pasteMode && (sat < 25 || lum(c) < 0.15)) continue; // al pegar: fuera blancos, grises y negros
      keep.push(`background-color:${val}`);
    }
  }
  return keep.join(';');
}

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  const name = data.attrName;
  if (name === 'style') {
    data.attrValue = cleanStyle(data.attrValue || '');
    if (!data.attrValue) data.keepAttr = false;
  } else if (name === 'class') {
    data.attrValue = (data.attrValue || '').split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c)).join(' ');
    if (!data.attrValue) data.keepAttr = false;
  } else if (name === 'href') {
    const v = (data.attrValue || '').trim();
    if (!/^(https?:|mailto:|tel:|#nota\/)/i.test(v)) data.keepAttr = false;
  } else if (name === 'src') {
    const v = (data.attrValue || '').trim();
    const ok = /^https:/i.test(v) || /^blob:/i.test(v) || (pasteMode && /^data:image\//i.test(v));
    if (!ok) data.keepAttr = false;
  }
});

/** Transformaciones previas al pegar (estilos de Evernote/Word/Google Docs → etiquetas limpias) */
function preparePaste(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style,script,meta,link,title,xml,o\\:p').forEach((n) => n.remove());
  // Negritas/cursivas expresadas con estilos
  doc.querySelectorAll('[style]').forEach((n) => {
    const s = n.getAttribute('style').toLowerCase();
    const wrap = (tag) => {
      const w = doc.createElement(tag);
      while (n.firstChild) w.append(n.firstChild);
      n.append(w);
    };
    const fw = s.match(/font-weight\s*:\s*(\w+)/);
    if (fw) {
      const heavy = fw[1] === 'bold' || fw[1] === 'bolder' || parseInt(fw[1], 10) >= 600;
      if (heavy && !/^(B|STRONG|H\d|TH)$/.test(n.tagName)) wrap('strong');
      if (!heavy && /^(B|STRONG)$/.test(n.tagName)) { n.replaceWith(...n.childNodes); return; }
    }
    if (/font-style\s*:\s*italic/.test(s) && !/^(I|EM)$/.test(n.tagName)) wrap('em');
    if (/text-decoration[^;]*underline/.test(s) && n.tagName !== 'U' && n.tagName !== 'A') wrap('u');
    if (/text-decoration[^;]*line-through/.test(s) && n.tagName !== 'S') wrap('s');
  });
  // Casillas de verificación (Evernote) → lista de tareas
  doc.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    const checked = cb.checked || cb.hasAttribute('checked');
    let li = cb.closest('li');
    if (!li) {
      const block = cb.closest('div,p') || cb.parentElement;
      li = doc.createElement('li');
      const ul = doc.createElement('ul');
      ul.className = 'checklist';
      block.replaceWith(ul);
      ul.append(li);
      while (block.firstChild) li.append(block.firstChild);
    }
    li.setAttribute('data-checked', checked ? 'true' : 'false');
    li.parentElement?.classList.add('checklist');
    cb.remove();
  });
  // Unir listas de tareas consecutivas
  doc.querySelectorAll('ul.checklist').forEach((ul) => {
    let next = ul.nextElementSibling;
    while (next && next.matches('ul.checklist')) {
      while (next.firstChild) ul.append(next.firstChild);
      const n2 = next.nextElementSibling; next.remove(); next = n2;
    }
  });
  doc.querySelectorAll('en-media, en-crypt').forEach((n) => n.remove());
  // Desenvolver <div> contenedores de bloques (Evernote/Word), así los títulos quedan a primer nivel
  const BLOCK = 'p,div,h1,h2,h3,h4,ul,ol,table,blockquote,pre,hr';
  [...doc.body.querySelectorAll('div')].reverse().forEach((d) => {
    if ([...d.children].some((c) => c.matches(BLOCK))) d.replaceWith(...d.childNodes);
  });
  return doc.body.innerHTML;
}

export function sanitize(html, { paste = false } = {}) {
  pasteMode = paste;
  try {
    const out = DOMPurify.sanitize(paste ? preparePaste(html) : (html || ''), {
      ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false
    });
    if (!paste) return out;
    // Al pegar: quitar imágenes rotas (sin origen válido)
    const doc = new DOMParser().parseFromString(out, 'text/html');
    doc.querySelectorAll('img').forEach((i) => { if (!i.getAttribute('src') && !i.dataset.file) i.remove(); });
    return doc.body.innerHTML;
  } finally {
    pasteMode = false;
  }
}

// ---------------- Barra de formato (la MISMA para notas y prerredactados) ----------------
const FONT_SIZES = [{ v: '0.85em', label: 'Pequeño' }, { v: '', label: 'Normal' }, { v: '1.2em', label: 'Grande' }, { v: '1.45em', label: 'Muy grande' }];
const ico = (n) => `<svg class="i" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const B = (attr, icon, title, extra = '') => `<button type="button" ${attr} title="${title}" aria-label="${title}"${extra}>${icon}</button>`;
const SEP = '<span class="sep"></span>';
/**
 * Barra estilo Evernote. fields = botón «Insertar campo» (solo prerredactados).
 * Orden: deshacer · estilo y tamaño · formato · listas y alineación · insertar · más
 */
export function toolbarHtml({ fields = false } = {}) {
  return [
    B('data-cmd="undo"', ico('undo-2'), 'Deshacer (Ctrl+Z)'), B('data-cmd="redo"', ico('redo-2'), 'Rehacer (Ctrl+Y)'), SEP,
    `<select data-block title="Estilo de párrafo" aria-label="Estilo de párrafo">
      <option value="p">Texto</option><option value="h1">Título 1</option><option value="h2">Título 2</option>
      <option value="h3">Título 3</option><option value="blockquote">Cita</option><option value="pre">Código</option></select>`,
    B('data-act="size"', ico('a-large-small'), 'Tamaño de letra'), SEP,
    B('data-cmd="bold"', ico('bold'), 'Negrita (Ctrl+B)'), B('data-cmd="italic"', ico('italic'), 'Cursiva (Ctrl+I)'),
    B('data-cmd="underline"', ico('underline'), 'Subrayado (Ctrl+U)'), B('data-cmd="strikeThrough"', ico('strikethrough'), 'Tachado'),
    B('data-act="color"', `${ico('baseline')}<span class="color-bar"></span>`, 'Color del texto'),
    B('data-act="highlight"', ico('highlighter'), 'Resaltar'), SEP,
    B('data-cmd="insertUnorderedList"', ico('list'), 'Lista con viñetas'), B('data-cmd="insertOrderedList"', ico('list-ordered'), 'Lista numerada'),
    B('data-act="checklist"', ico('list-checks'), 'Lista de tareas (Ctrl+Mayús+X)'),
    B('data-cmd="outdent"', ico('indent-decrease'), 'Reducir sangría'), B('data-cmd="indent"', ico('indent-increase'), 'Aumentar sangría'),
    B('data-act="align"', ico('align-left'), 'Alinear'), SEP,
    B('data-act="table"', ico('table'), 'Insertar tabla'), B('data-act="image"', ico('image'), 'Insertar imagen'),
    B('data-act="link"', ico('link'), 'Enlace web (Ctrl+K)'), B('data-act="notelink"', ico('notebook-text'), 'Enlazar una nota'),
    B('data-act="tocblock"', ico('table-of-contents'), 'Insertar índice'), B('data-act="snippet"', ico('clipboard-list'), 'Insertar prerredactado'),
    fields ? B('data-act="field"', ico('braces'), 'Insertar campo a rellenar {…}') : '',
    B('data-act="date"', ico('calendar-clock'), 'Insertar fecha'), B('data-cmd="insertHorizontalRule"', ico('minus'), 'Línea separadora'), SEP,
    B('data-act="code"', ico('code'), 'Código en línea'), B('data-cmd="subscript"', ico('subscript'), 'Subíndice'),
    B('data-cmd="superscript"', ico('superscript'), 'Superíndice'), B('data-act="clear"', ico('remove-formatting'), 'Quitar formato')
  ].join('');
}

// ---------------- Editor ----------------
export function createEditor(opts) {
  // opts: { onChange(), onNoteLink(id), onImage(fileId), pickNote() → Promise<{id,title}>,
  //         uploadImages(files) → Promise<[{id,url}]>, resolveImage(id) → Promise<url>,
  //         noteExists(id) → bool, onCopy(text, btn), pickSnippet() → Promise<{html, text}|string>,
  //         els: elementos propios (para tener varios editores: notas y prerredactados),
  //         markFields: resalta {campo} en lectura, tabs: el tabulador escribe una tabulación }
  const E = opts.els || {};
  const content = E.content || $('#content');
  const toolbar = E.toolbar || $('#toolbar');
  const tableTools = E.tableTools || $('#table-tools');
  const bubble = E.bubble || $('#link-bubble');
  const editorBox = E.box || $('#editor');
  const scroller = E.scroll || $('#ed-scroll');
  const fileInput = E.fileInput || $('#file-image');
  const sideToc = E.toc === undefined ? $('#toc') : E.toc;
  if (!toolbar.querySelector('[data-block]')) toolbar.innerHTML = toolbarHtml({ fields: !!opts.fields }); // HTML fijo, sin datos
  // Móvil: la barra se desliza; un difuminado en el borde indica que hay más botones
  const edges = () => {
    toolbar.classList.toggle('more-left', toolbar.scrollLeft > 4);
    toolbar.classList.toggle('more-right', toolbar.scrollLeft + toolbar.clientWidth < toolbar.scrollWidth - 4);
  };
  toolbar.addEventListener('scroll', edges, { passive: true });
  window.addEventListener('resize', edges);
  new ResizeObserver(edges).observe(toolbar);
  const blockSel = toolbar.querySelector('[data-block]');
  let savedRange = null;
  let readOnly = false;
  let lastColor = '#dc2626';

  const exec = (cmd, val = null) => document.execCommand(cmd, false, val);
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* */ }

  // Siempre un párrafo al final, para poder escribir debajo de una tabla o imagen
  function ensureTrailingParagraph() {
    const last = content.lastElementChild;
    if (last && /^(TABLE|HR|PRE|BLOCKQUOTE|IMG|UL|OL)$/.test(last.tagName) && !readOnly) {
      content.append(el('p', {}, el('br')));
    }
  }
  const changed = () => { ensureTrailingParagraph(); opts.onChange(); updateToolbar(); };

  function inContent(node) { return node && (node === content || content.contains(node)); }
  function selNode() {
    const s = window.getSelection();
    if (!s.rangeCount) return null;
    const n = s.getRangeAt(0).startContainer;
    return inContent(n) ? (n.nodeType === 1 ? n : n.parentElement) : null;
  }
  const closestInContent = (sel) => { const n = selNode(); const c = n?.closest(sel); return inContent(c) ? c : null; };

  function saveRange() {
    const s = window.getSelection();
    if (s.rangeCount && inContent(s.getRangeAt(0).commonAncestorContainer)) savedRange = s.getRangeAt(0).cloneRange();
  }
  function restoreRange() {
    content.focus({ preventScroll: true });
    if (savedRange) {
      const s = window.getSelection();
      s.removeAllRanges(); s.addRange(savedRange);
    } else {
      // al final
      const r = document.createRange();
      r.selectNodeContents(content); r.collapse(false);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    }
  }

  // ---------- Barra de herramientas ----------
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault(); // mantener la selección
  });
  toolbar.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b || readOnly) return;
    if (b.dataset.cmd) {
      content.focus({ preventScroll: true });
      exec(b.dataset.cmd);
      changed();
      return;
    }
    const act = b.dataset.act;
    saveRange();
    if (act === 'highlight') {
      const c = await colorPicker('Resaltar', ['#fde68a', '#bbf7d0', '#fecdd3', '#bae6fd', '#e9d5ff', ''], 'highlight');
      if (c === undefined) return;
      restoreRange(); exec('styleWithCSS', true);
      exec('hiliteColor', c || 'transparent');
      exec('styleWithCSS', false); changed();
    } else if (act === 'color') {
      const c = await colorPicker('Color del texto', ['#dc2626', '#ea580c', '#16a34a', '#2563eb', '#7c3aed', '#db2777', ''], 'text');
      if (c === undefined) return;
      restoreRange(); exec('styleWithCSS', true);
      if (c) { exec('foreColor', c); lastColor = c; b.querySelector('.color-bar').style.background = lastColor; } else exec('removeFormat');
      exec('styleWithCSS', false); changed();
    } else if (act === 'checklist') {
      restoreRange(); toggleChecklist(); changed();
    } else if (act === 'table') {
      await insertTable();
    } else if (act === 'image') {
      fileInput.click();
    } else if (act === 'link') {
      await insertLink();
    } else if (act === 'notelink') {
      await insertNoteLink();
    } else if (act === 'snippet') {
      await insertSnippet();
    } else if (act === 'tocblock') {
      restoreRange();
      insertTocBlock();
    } else if (act === 'align') {
      menu(b, [['left', 'Izquierda', 'justifyLeft'], ['center', 'Centrado', 'justifyCenter'], ['right', 'Derecha', 'justifyRight']]
        .map(([k, label, cmd]) => ({ icon: `align-${k}`, label, onClick: () => { restoreRange(); exec(cmd); changed(); } })));
    } else if (act === 'size') {
      menu(b, FONT_SIZES.map((f) => ({ icon: 'a-large-small', label: f.label, onClick: () => { restoreRange(); setFontSize(f.v); changed(); } })));
    } else if (act === 'date') {
      const d = new Date();
      const day = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const time = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      menu(b, [
        { icon: 'calendar-clock', label: `Fecha (${day})`, onClick: () => { restoreRange(); exec('insertText', day); changed(); } },
        { icon: 'calendar-clock', label: `Fecha y hora (${day} ${time})`, onClick: () => { restoreRange(); exec('insertText', `${day} ${time}`); changed(); } }
      ]);
    } else if (act === 'code') {
      restoreRange();
      const sel = window.getSelection();
      const t = sel.rangeCount ? sel.toString() : '';
      const inCode = closestInContent('code');
      if (inCode) unwrap(inCode);
      else exec('insertHTML', `<code>${escapeHtml(t || 'código')}</code>&nbsp;`);
      changed();
    } else if (act === 'clear') {
      restoreRange();
      exec('removeFormat');
      changed();
    } else if (act === 'field') {
      await insertField();
    }
  });
  blockSel.addEventListener('change', () => {
    if (readOnly) return;
    restoreRange();
    exec('formatBlock', `<${blockSel.value}>`);
    changed();
  });
  blockSel.addEventListener('mousedown', saveRange);
  blockSel.addEventListener('touchstart', saveRange, { passive: true });

  fileInput.addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) { restoreRange(); await insertImages(files); }
  });

  function updateToolbar() {
    if (readOnly) return;
    for (const b of $$('[data-cmd]', toolbar)) {
      const c = b.dataset.cmd;
      if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'subscript', 'superscript'].includes(c)) {
        let on = false;
        try { on = document.queryCommandState(c); } catch { /* */ }
        b.classList.toggle('on', on && !!selNode());
      }
    }
    const blk = closestInContent('h1,h2,h3,blockquote,pre');
    blockSel.value = blk ? blk.tagName.toLowerCase() : 'p';
    toolbar.querySelector('[data-act=checklist]').classList.toggle('on', !!closestInContent('ul.checklist'));
    toolbar.querySelector('[data-act=code]')?.classList.toggle('on', !!closestInContent('code'));
    const blkAlign = closestInContent('p,div,h1,h2,h3,h4,li,blockquote,td,th');
    const al = blkAlign ? getComputedStyle(blkAlign).textAlign : 'left';
    const ab = toolbar.querySelector('[data-act=align] use');
    if (ab) ab.setAttribute('href', `#i-align-${al === 'center' ? 'center' : al === 'right' || al === 'end' ? 'right' : 'left'}`);
    updateTableTools();
  }
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === content) { updateToolbar(); saveRange(); }
  });

  // ---------- Listas de tareas ----------
  function toggleChecklist() {
    let ul = closestInContent('li')?.parentElement;
    if (ul?.matches('ul.checklist')) {
      ul.classList.remove('checklist');
      [...ul.children].forEach((li) => li.removeAttribute('data-checked'));
      return;
    }
    if (!ul || ul.tagName !== 'UL') {
      exec('insertUnorderedList');
      ul = closestInContent('li')?.parentElement;
    }
    if (ul && ul.tagName === 'UL') {
      ul.classList.add('checklist');
      [...ul.children].forEach((li) => { if (!li.dataset.checked) li.dataset.checked = 'false'; });
    }
  }

  // ---------- Tablas ----------
  async function insertTable() {
    const rows = el('input', { type: 'number', value: '3', min: '1', max: '50' });
    const cols = el('input', { type: 'number', value: '3', min: '1', max: '12' });
    const head = el('input', { type: 'checkbox', checked: true });
    const ok = await modal({
      title: 'Insertar tabla',
      body: [el('label', {}, 'Filas', rows), el('label', {}, 'Columnas', cols),
        el('label', { style: { flexDirection: 'row', alignItems: 'center', gap: '8px' } }, head, 'Primera fila como encabezado')],
      actions: [{ label: 'Cancelar' }, { label: 'Insertar', primary: true, value: true }]
    });
    if (!ok) return;
    const r = Math.max(1, Math.min(50, +rows.value || 3));
    const c = Math.max(1, Math.min(12, +cols.value || 3));
    let html = '<table><tbody>';
    for (let i = 0; i < r; i++) {
      html += '<tr>';
      for (let j = 0; j < c; j++) html += (i === 0 && head.checked) ? '<th><br></th>' : '<td><br></td>';
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    restoreRange();
    exec('insertHTML', html);
    changed();
  }

  function updateTableTools() {
    const cell = closestInContent('td,th');
    if (!cell || readOnly) { tableTools.classList.add('hidden'); return; }
    const table = cell.closest('table');
    const tr = table.getBoundingClientRect();
    const br = editorBox.getBoundingClientRect();
    tableTools.classList.remove('hidden');
    const top = tr.top - br.top - tableTools.offsetHeight - 6;
    tableTools.style.top = `${Math.max(4, top < 50 ? tr.bottom - br.top + 6 : top)}px`;
    tableTools.style.left = `${Math.max(8, Math.min(tr.left - br.left, br.width - tableTools.offsetWidth - 8))}px`;
  }
  tableTools.addEventListener('mousedown', (e) => e.preventDefault());
  tableTools.addEventListener('click', (e) => {
    const t = e.target.closest('button')?.dataset.t;
    const cell = closestInContent('td,th');
    if (!t || !cell) return;
    const row = cell.parentElement;
    const table = cell.closest('table');
    const idx = [...row.children].indexOf(cell);
    if (t === 'row-add') {
      const nr = document.createElement('tr');
      for (let i = 0; i < row.children.length; i++) nr.append(el('td', {}, el('br')));
      row.after(nr);
    } else if (t === 'col-add') {
      for (const r of table.rows) {
        const ref = r.children[Math.min(idx, r.children.length - 1)];
        const nc = el(ref?.tagName === 'TH' ? 'th' : 'td', {}, el('br'));
        if (ref) ref.after(nc); else r.append(nc);
      }
    } else if (t === 'row-del') {
      row.remove();
      if (!table.rows.length) table.remove();
    } else if (t === 'col-del') {
      for (const r of [...table.rows]) r.children[idx]?.remove();
      if (!table.rows[0]?.children.length) table.remove();
    } else if (t === 'table-del') {
      table.remove();
    }
    tableTools.classList.add('hidden');
    changed();
  });

  // ---------- Tamaño de letra ----------
  // execCommand('fontSize') crea <font size=7> o un span con «xxx-large»: se cambian por el tamaño elegido (o nada)
  function setFontSize(v) {
    exec('styleWithCSS', false);
    exec('fontSize', '7');
    for (const n of $$('font[size="7"], span[style*="xxx-large"], span[style*="-webkit-xxx-large"]', content)) {
      const span = el('span', v ? { style: { fontSize: v } } : {});
      span.append(...n.childNodes);
      if (v) n.replaceWith(span); else n.replaceWith(...span.childNodes);
    }
    if (!v) $$('span[style*="font-size"]', content).forEach((n) => { if (window.getSelection().containsNode(n, true)) { n.style.fontSize = ''; if (!n.getAttribute('style')) unwrap(n); } });
  }

  // ---------- Campos (prerredactados) ----------
  async function insertField() {
    const name = el('input', { type: 'text', placeholder: 'p. ej. edad', maxlength: 40, autocomplete: 'off' });
    const opts2 = el('input', { type: 'text', placeholder: 'Opcional: derecho, izquierdo', maxlength: 300, autocomplete: 'off' });
    const ok = await modal({
      title: 'Insertar campo a rellenar',
      body: [el('label', {}, 'Nombre del campo', name), el('label', {}, 'Opciones para elegir (separadas por comas)', opts2),
        el('p', { class: 'muted small' }, 'Al copiar se te pedirá el valor. Con opciones, se elige de una lista.')],
      actions: [{ label: 'Cancelar' }, { label: 'Insertar', primary: true, value: true }],
      onOpen: () => setTimeout(() => name.focus(), 50)
    });
    const n = name.value.replace(/[{}:|\n]/g, '').trim();
    if (!ok || !n) return;
    const o = opts2.value.split(/[,|]/).map((x) => x.replace(/[{}\n]/g, '').trim()).filter(Boolean);
    restoreRange();
    exec('insertText', o.length ? `{${n}:${o.join('|')}}` : `{${n}}`);
    changed();
  }

  // ---------- Enlaces ----------
  async function insertLink() {
    const sel = window.getSelection();
    const hasText = savedRange && !savedRange.collapsed;
    const url = await prompt('Enlace web', 'https://', { placeholder: 'https://… o DOI (10.xxxx/…)' });
    if (!url) return;
    let href = url.trim();
    if (/^10\.\d{4,}\//.test(href)) href = `https://doi.org/${href}`;
    if (!/^(https?:|mailto:|tel:)/i.test(href)) href = `https://${href}`;
    restoreRange();
    if (hasText) exec('createLink', href);
    else exec('insertHTML', `<a href="${escapeAttr(href)}">${escapeHtml(url)}</a>&nbsp;`);
    void sel;
    changed();
  }
  async function insertNoteLink() {
    const target = await opts.pickNote();
    if (!target) return;
    restoreRange();
    const title = target.title || 'Sin título';
    exec('insertHTML', `<a href="#nota/${escapeAttr(target.id)}" data-note="${escapeAttr(target.id)}" class="note-link">${escapeHtml(title)}</a>&nbsp;`);
    changed();
  }

  async function insertSnippet() {
    if (!opts.pickSnippet) return;
    const res = await opts.pickSnippet();
    if (!res) return;
    restoreRange();
    if (typeof res === 'object' && res.html) {
      // Con su formato: sin índice propio ni secciones plegadas; las imágenes se cargan después
      const doc = new DOMParser().parseFromString(sanitize(res.html), 'text/html');
      doc.querySelectorAll('.note-toc').forEach((n) => n.remove());
      doc.querySelectorAll('[data-collapsed]').forEach((n) => n.removeAttribute('data-collapsed'));
      exec('insertHTML', doc.body.innerHTML);
      api.resolveImages();
      api.markLinks();
    } else {
      const text = typeof res === 'object' ? res.text : res;
      if (!text) return;
      exec('insertHTML', text.split(/\r?\n/).map((l) => escapeHtml(l)).join('<br>'));
    }
    changed();
  }

  // ---------- Burbuja (enlaces e imágenes) ----------
  function showBubble(target, buttons) {
    bubble.replaceChildren(...buttons.map((b) => el('button', {
      type: 'button', class: b.danger ? 'danger' : '',
      onmousedown: (e) => e.preventDefault(),
      onclick: () => { hideBubble(); b.onClick(); }
    }, b.label)));
    bubble.classList.remove('hidden');
    const r = target.getBoundingClientRect();
    const br = editorBox.getBoundingClientRect();
    bubble.style.top = `${r.bottom - br.top + 6}px`;
    bubble.style.left = `${Math.max(8, Math.min(r.left - br.left, br.width - bubble.offsetWidth - 8))}px`;
  }
  function hideBubble() {
    bubble.classList.add('hidden');
    $$('img.selected', content).forEach((i) => i.classList.remove('selected'));
  }
  scroller.addEventListener('scroll', () => { hideBubble(); tableTools.classList.add('hidden'); }, { passive: true });

  content.addEventListener('click', (e) => {
    hideBubble();
    // Modo lectura: «📋 Copiar sección»
    const cp = e.target.closest('.sec-copy');
    if (cp && inContent(cp)) {
      e.preventDefault(); e.stopPropagation();
      const h = cp.closest('h1,h2,h3');
      if (h) opts.onCopy?.(sectionText(h), cp);
      return;
    }
    // Índice insertado en la nota
    const tocLink = e.target.closest('.note-toc a[data-h]');
    if (tocLink && inContent(tocLink)) {
      e.preventDefault();
      lastTocBlock = tocLink.closest('.note-toc');
      scrollToHeading(+tocLink.dataset.h, { fromToc: true });
      return;
    }
    // Plegar / desplegar el índice (solo vista; se recuerda en el dispositivo)
    const tocHead = e.target.closest('.note-toc .toc-head');
    if (tocHead && inContent(tocHead) && !e.target.closest('.toc-del')) {
      e.preventDefault();
      const closed = !tocHead.closest('.note-toc').classList.contains('toc-closed');
      try { localStorage.setItem('drfolio.tocClosed', closed ? '1' : '0'); } catch { /* */ }
      $$('.note-toc', content).forEach((b) => b.classList.toggle('toc-closed', closed));
      return;
    }
    const tocDel = e.target.closest('.note-toc .toc-del');
    if (tocDel && inContent(tocDel)) {
      e.preventDefault();
      if (!readOnly) { tocDel.closest('.note-toc').remove(); changed(); }
      return;
    }
    if (e.target.closest('.note-toc')) { e.preventDefault(); return; }
    // Plegar / desplegar secciones (flecha a la derecha del título)
    const hd = e.target.closest('h1,h2,h3');
    if (hd && hd.parentElement === content && e.clientX > hd.getBoundingClientRect().right - 40) {
      e.preventDefault();
      if (hd.dataset.collapsed === '1') hd.removeAttribute('data-collapsed'); else hd.dataset.collapsed = '1';
      applyFolds();
      if (!readOnly) opts.onChange();
      return;
    }
    // Casillas de las listas de tareas
    const li = e.target.closest('ul.checklist > li');
    if (li && inContent(li)) {
      const x = e.clientX - li.getBoundingClientRect().left;
      if (x < 26) {
        e.preventDefault();
        if (readOnly) return;
        li.dataset.checked = li.dataset.checked === 'true' ? 'false' : 'true';
        changed();
        return;
      }
    }
    const a = e.target.closest('a');
    if (a && inContent(a)) {
      e.preventDefault();
      const noteId = a.dataset.note;
      if (noteId) {
        if (readOnly || e.metaKey || e.ctrlKey) { opts.onNoteLink(noteId); return; }
        showBubble(a, [
          { label: '↪ Abrir nota', onClick: () => opts.onNoteLink(noteId) },
          ...(readOnly ? [] : [{ label: 'Quitar enlace', onClick: () => { unwrap(a); changed(); } }])
        ]);
      } else {
        const href = a.getAttribute('href');
        if (readOnly || e.metaKey || e.ctrlKey) { window.open(href, '_blank', 'noopener'); return; }
        showBubble(a, [
          { label: '↗ Abrir', onClick: () => window.open(href, '_blank', 'noopener') },
          { label: 'Editar', onClick: async () => {
            const v = await prompt('Enlace web', href);
            if (v) { a.setAttribute('href', /^(https?:|mailto:|tel:)/i.test(v) ? v : `https://${v}`); changed(); }
          } },
          { label: 'Quitar enlace', onClick: () => { unwrap(a); changed(); } }
        ]);
      }
      return;
    }
    const img = e.target.closest('img');
    if (img && inContent(img)) {
      if (readOnly) { opts.onImage(img.dataset.file, img.src); return; }
      img.classList.add('selected');
      const fileId = img.dataset.file;
      showBubble(img, [
        { label: '🔍 Ver', onClick: () => opts.onImage(fileId, img.src) },
        ...(readOnly ? [] : [{ label: 'Borrar imagen', danger: true, onClick: () => { img.remove(); changed(); } }])
      ]);
    }
  });

  function unwrap(node) { node.replaceWith(...node.childNodes); }

  // ---------- Teclado ----------
  content.addEventListener('keydown', (e) => {
    if (readOnly) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Tab') {
      if (closestInContent('li')) {
        e.preventDefault();
        exec(e.shiftKey ? 'outdent' : 'indent');
        changed();
      } else if (closestInContent('td,th')) {
        e.preventDefault();
        const cells = $$('td,th', closestInContent('table'));
        const i = cells.indexOf(closestInContent('td,th'));
        const next = cells[i + (e.shiftKey ? -1 : 1)];
        if (next) placeCaret(next);
      } else if (opts.tabs && !e.shiftKey) {
        // Tabulación de verdad (se ve y se copia): el párrafo conserva los espacios (class="keep-ws")
        e.preventDefault();
        if (!closestInContent('p,div,h1,h2,h3,h4,blockquote,pre')) exec('formatBlock', '<p>');
        closestInContent('p,div,h1,h2,h3,h4,blockquote')?.classList.add('keep-ws');
        exec('insertText', '\t');
        changed();
      }
    } else if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault(); e.stopPropagation();
      saveRange(); insertLink();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === 'x') {
      e.preventDefault(); toggleChecklist(); changed();
    }
  });

  function placeCaret(node, atEnd = false) {
    const r = document.createRange();
    r.selectNodeContents(node);
    r.collapse(!atEnd);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  content.addEventListener('input', (e) => {
    if (e.inputType === 'insertParagraph') {
      const li = closestInContent('ul.checklist > li');
      if (li && !li.textContent.trim()) li.dataset.checked = 'false';
    }
    changed();
  });

  // ---------- Pegar y soltar ----------
  content.addEventListener('paste', async (e) => {
    if (readOnly) { e.preventDefault(); return; }
    const cd = e.clipboardData;
    if (!cd) return;
    const imgs = [...cd.files].filter((f) => f.type.startsWith('image/'));
    const html = cd.getData('text/html');
    if (imgs.length && !html) {
      e.preventDefault();
      saveRange();
      await insertImages(imgs);
      return;
    }
    if (html) {
      e.preventDefault();
      const clean = sanitize(html, { paste: true });
      exec('insertHTML', clean);
      await convertDataImages();
      changed();
    }
    // texto plano: lo inserta el navegador
  });

  content.addEventListener('dragover', (e) => { if (!readOnly && e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  content.addEventListener('drop', async (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length || readOnly) return;
    e.preventDefault();
    // Colocar el cursor donde se suelta
    const pos = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (pos) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(pos); saveRange(); }
    const images = files.filter((f) => f.type.startsWith('image/'));
    const others = files.filter((f) => !f.type.startsWith('image/'));
    if (images.length) await insertImages(images);
    if (others.length) opts.onDropFiles(others);
  });

  async function insertImages(files) {
    try {
      const saved = await opts.uploadImages(files);
      restoreRange();
      const html = saved.map((s) => `<img data-file="${escapeAttr(s.id)}" src="${escapeAttr(s.url)}" alt="">`).join(' ');
      exec('insertHTML', `${html}&nbsp;`);
      changed();
    } catch (err) {
      toast(err.message || 'No se pudo insertar la imagen', 'error');
    }
  }

  /** Imágenes pegadas como data: → archivos propios */
  async function convertDataImages() {
    const list = $$('img[src^="data:"]', content).filter((i) => !i.dataset.file);
    for (const img of list) {
      try {
        const blob = dataUrlToBlob(img.src);
        const [s] = await opts.uploadImages([new File([blob], 'pegada', { type: blob.type })]);
        img.dataset.file = s.id;
        img.src = s.url;
      } catch { img.remove(); }
    }
  }

  // ---------- Índice ----------
  /** Texto de un título sin el índice ni el botón de copiar (por si el índice quedó dentro) */
  function hText(h) {
    if (!h.querySelector('.note-toc,.sec-copy')) return h.textContent.replace(/\s+/g, ' ').trim();
    const c = h.cloneNode(true);
    c.querySelectorAll('.note-toc,.sec-copy').forEach((n) => n.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  }
  /**
   * El índice va siempre a primer nivel. Si quedó dentro de un título o párrafo (pasaba en iPhone al insertarlo
   * con el cursor en un título), se saca delante; si había uno dentro de otro, sobra. Repara notas ya afectadas.
   */
  function fixTocPlacement() {
    for (const b of $$('.note-toc', content)) {
      if (!b.isConnected) continue;
      if (b.parentElement.closest('.note-toc')) { b.remove(); continue; }
      if (b.parentElement === content) continue;
      let top = b;
      while (top.parentElement !== content) top = top.parentElement;
      top.before(b);
      if (!top.textContent.trim() && !top.querySelector('img,table,hr')) top.remove();
    }
  }
  function headings() { return $$('h1,h2,h3', content).filter((h) => !h.closest('.note-toc') && hText(h)); }
  const level = (h) => +h.tagName[1];

  function scrollToHeading(i, { fromToc = false } = {}) {
    const h = headings()[i];
    if (!h) return;
    revealHeading(h);
    h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    h.classList.add('flash');
    setTimeout(() => h.classList.remove('flash'), 1500);
    if (fromToc) showTocBack(); else hideTocBack();
  }

  // Índice dentro de la nota (como Evernote): se guarda vacío y se genera al mostrar
  function insertTocBlock() {
    if (readOnly) return;
    // A primer nivel (nunca dentro de un título o párrafo): detrás del bloque donde está el cursor
    restoreRange();
    const toc = el('div', { class: 'note-toc', 'data-toc': '1' });
    let top = selNode();
    while (top && top !== content && top.parentElement !== content) top = top.parentElement;
    if (!top || top === content) content.prepend(toc);
    else if (!top.textContent.trim() && !top.querySelector('img,table,hr')) top.replaceWith(toc);
    else if (/^H[1-4]$/.test(top.tagName)) top.before(toc); // en un título: justo encima
    else top.after(toc);
    if (!toc.nextElementSibling) toc.after(el('p', {}, el('br')));
    refreshTocBlocks();
    changed();
    if (!headings().length) toast('Usa «Título 1/2/3» en la nota y el índice se rellenará solo');
  }

  function refreshTocBlocks() {
    fixTocPlacement();
    const blocks = $$('.note-toc', content);
    if (!blocks.length) return;
    const hs = headings();
    for (const b of blocks) {
      b.contentEditable = 'false';
      let closed = false;
      try { closed = localStorage.getItem('drfolio.tocClosed') === '1'; } catch { /* */ }
      b.classList.toggle('toc-closed', closed);
      const head = el('div', { class: 'toc-head', role: 'button', title: 'Mostrar u ocultar el índice' },
        el('span', { class: 'toc-title' }, el('span', { class: 'toc-chev', 'aria-hidden': 'true' }), `Índice${hs.length ? ` · ${hs.length}` : ''}`),
        readOnly ? null : el('button', { type: 'button', class: 'toc-del', title: 'Quitar índice', 'aria-label': 'Quitar índice' }, '✕'));
      if (!hs.length) {
        b.replaceChildren(head, el('p', { class: 'toc-empty' }, 'Añade títulos (Título 1, 2 o 3) y aparecerán aquí.'));
        continue;
      }
      // Numeración por niveles (1, 1.1, 1.2, 2…). Si el título ya empieza por un número («1. …»), no se repite.
      const min = Math.min(...hs.map(level));
      const root = el('ol', { class: 'toc-num' });
      const stack = [{ lvl: min, list: root, n: 0 }];
      hs.forEach((h, i) => {
        const lv = level(h);
        while (stack.length > 1 && lv < stack[stack.length - 1].lvl) stack.pop();
        let top = stack[stack.length - 1];
        if (lv > top.lvl) {
          const parentLi = top.list.lastElementChild;
          const sub = el('ol');
          (parentLi || top.list).append(sub);
          stack.push({ lvl: lv, list: sub, n: 0 });
          top = stack[stack.length - 1];
        }
        top.n++;
        const num = stack.map((x) => x.n || 1).join('.');
        const text = hText(h).replace(/^\d+(\.\d+)*[.)ºª-]?\s+/, '') || hText(h);
        top.list.append(el('li', {}, el('a', { href: '#', 'data-h': String(i) }, el('span', { class: 'toc-n' }, `${num}.`), ` ${text}`)));
      });
      b.replaceChildren(head, root);
    }
  }

  // Secciones plegables: oculta lo que hay bajo un título plegado hasta el siguiente título de igual o mayor nivel
  function applyFolds() {
    let hideUntil = null;
    for (const node of content.children) {
      const isH = /^H[1-3]$/.test(node.tagName) && node.textContent.trim();
      if (isH) {
        const lv = +node.tagName[1];
        if (hideUntil !== null && lv <= hideUntil) hideUntil = null;
        node.classList.toggle('fold-hidden', hideUntil !== null);
        node.classList.add('foldable');
        if (hideUntil === null && node.dataset.collapsed === '1') hideUntil = lv;
      } else {
        node.classList.remove('foldable');
        node.classList.toggle('fold-hidden', hideUntil !== null);
      }
    }
  }
  function revealHeading(h) {
    if (!h.classList.contains('fold-hidden') && h.parentElement === content) return;
    let n = h.previousElementSibling;
    let lv = level(h);
    while (n) {
      if (/^H[1-3]$/.test(n.tagName) && +n.tagName[1] < lv) {
        if (n.dataset.collapsed === '1') n.removeAttribute('data-collapsed');
        lv = +n.tagName[1];
      }
      n = n.previousElementSibling;
    }
    applyFolds();
  }

  // ---------- Copiar (modo lectura) ----------
  /** Nodos de la sección: lo que hay bajo el título hasta el siguiente de igual o mayor nivel */
  function sectionNodes(h) {
    const nodes = [];
    const lv = level(h);
    for (let n = h.nextElementSibling; n; n = n.nextElementSibling) {
      if (/^H[1-3]$/.test(n.tagName) && n.textContent.trim() && level(n) <= lv) break;
      nodes.push(n);
    }
    return nodes;
  }
  function sectionText(h) { return nodesToPlain(sectionNodes(h)); }
  function updateCopyButtons() {
    $$('.sec-copy', content).forEach((b) => b.remove());
    if (!readOnly) return;
    for (const h of $$(':scope > h1, :scope > h2, :scope > h3', content)) {
      if (!hText(h) || !sectionNodes(h).length) continue;
      // Sin texto dentro (el icono va por CSS) para no ensuciar el índice
      h.append(el('button', { type: 'button', class: 'sec-copy', contenteditable: 'false', title: 'Copiar sección', 'aria-label': 'Copiar sección' }));
    }
  }

  // Campos {…} resaltados en lectura (solo vista: no se guardan)
  function markFields() {
    if (!opts.markFields) return;
    $$('span.fld', content).forEach((sp) => { const p = sp.parentNode; sp.replaceWith(...sp.childNodes); p.normalize(); });
    if (!readOnly) return;
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('.note-toc,.sec-copy') || !n.data.includes('{') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const list = [];
    while (walker.nextNode()) list.push(walker.currentNode);
    for (const t of list) {
      const parts = [];
      let last = 0;
      for (const m of t.data.matchAll(FIELD_RE)) {
        if (m.index > last) parts.push(t.data.slice(last, m.index));
        parts.push(el('span', { class: 'fld', title: 'Campo: se rellena al copiar' }, m[0]));
        last = m.index + m[0].length;
      }
      if (!parts.length) continue;
      if (last < t.data.length) parts.push(t.data.slice(last));
      t.replaceWith(...parts);
    }
  }

  // Botón flotante «↑ Índice» para volver tras saltar a una sección
  let lastTocBlock = null;
  const tocBack = el('button', { type: 'button', class: 'toc-back hidden', onclick: () => {
    hideTocBack();
    const target = lastTocBlock && content.contains(lastTocBlock) ? lastTocBlock : sideToc;
    (target && !target.classList.contains('hidden') ? target : scroller).scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    if (!target) scroller.scrollTo({ top: 0, behavior: 'smooth' });
  } }, '↑ Índice');
  editorBox.append(tocBack);
  function showTocBack() { tocBack.classList.remove('hidden'); }
  function hideTocBack() { tocBack.classList.add('hidden'); }
  const refreshSoon = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { refreshTocBlocks(); applyFolds(); }, 300); }; })();
  content.addEventListener('input', refreshSoon);

  // ---------- API ----------
  const api = {
    setContent(html) {
      hideBubble();
      tableTools.classList.add('hidden');
      content.innerHTML = sanitize(html || '');
      savedRange = null;
      lastTocBlock = null;
      hideTocBack();
      refreshTocBlocks();
      applyFolds();
      updateCopyButtons();
      markFields();
      this.resolveImages();
      this.markLinks();
    },
    resolveImages() {
      for (const img of $$('img[data-file]', content)) {
        if (img.getAttribute('src')) continue;
        img.classList.add('loading');
        opts.resolveImage(img.dataset.file)
          .then((url) => { img.src = url; })
          .catch(() => { img.alt = '⚠ imagen no disponible sin conexión'; })
          .finally(() => img.classList.remove('loading'));
      }
    },
    markLinks() {
      for (const a of $$('a[data-note]', content)) a.classList.toggle('broken', !opts.noteExists(a.dataset.note));
    },
    getContent() {
      const clone = content.cloneNode(true);
      clone.querySelectorAll('.sec-copy').forEach((b) => b.remove());
      clone.querySelectorAll('span.fld').forEach((sp) => sp.replaceWith(...sp.childNodes));
      clone.querySelectorAll('img[data-file]').forEach((i) => i.removeAttribute('src'));
      clone.querySelectorAll('.selected,.loading,.flash,.broken,.fold-hidden,.foldable').forEach((n) => n.classList.remove('selected', 'loading', 'flash', 'broken', 'fold-hidden', 'foldable'));
      clone.querySelectorAll('.note-toc').forEach((n) => { n.replaceChildren(); n.removeAttribute('contenteditable'); n.classList.remove('toc-closed'); });
      const html = sanitize(clone.innerHTML);
      return html === '<br>' || html === '<p><br></p>' ? '' : html;
    },
    getText() {
      const clone = content.cloneNode(true);
      clone.querySelectorAll('.note-toc,.sec-copy').forEach((n) => n.remove());
      return htmlToText(clone.innerHTML);
    },
    /** Texto plano de toda la nota (para «Copiar nota entera») */
    allText() { return nodesToPlain(content.childNodes); },
    hasTocBlock() { return !!content.querySelector('.note-toc'); },
    /** Añade el índice al principio o lo quita (opcional). Funciona también en lectura; quien llama guarda. */
    toggleTocBlock() {
      const had = $$('.note-toc', content);
      if (had.length) had.forEach((b) => b.remove());
      else content.prepend(el('div', { class: 'note-toc', 'data-toc': '1' }));
      refreshTocBlocks();
      applyFolds();
      updateCopyButtons();
      markFields();
      return !had.length;
    },
    fileIds() { return $$('img[data-file]', content).map((i) => i.dataset.file); },
    headings,
    scrollToHeading,
    setReadOnly(v) {
      readOnly = v;
      content.contentEditable = v ? 'false' : 'true';
      if (v) { tableTools.classList.add('hidden'); hideBubble(); }
      refreshTocBlocks();
      updateCopyButtons();
      markFields();
    },
    focus() { content.focus(); },
    isFocused() { return document.activeElement === content || content.contains(document.activeElement); },
    hideFloating() { hideBubble(); tableTools.classList.add('hidden'); hideTocBack(); },
    addFilesFromPicker: insertImages
  };
  return api;
}

function dataUrlToBlob(url) {
  const [head, b64] = url.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escapeAttr = escapeHtml;
