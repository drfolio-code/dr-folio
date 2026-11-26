// Visor de PDF propio con PDF.js (build "legacy", compatible con Safari iOS).
// - Páginas ajustadas al ancho, desplazamiento vertical continuo
// - Solo se dibujan las páginas visibles (y se liberan las lejanas: los PDF largos no cuelgan el móvil)
// - Zoom con botones, pellizco (móvil) y Ctrl+rueda (PC). Se reajusta solo al girar o cambiar el tamaño
// - "Página X de Y", ir a una página y buscar texto
// PDF.js se carga solo la primera vez que se abre un PDF.
import { el } from './util.js';
import { modal } from './ui.js';

const BASE = new URL('../vendor/pdfjs/', import.meta.url).href;
const GAP = 10;                 // separación entre páginas (px)
const MIN_ZOOM = 0.5, MAX_ZOOM = 6, STEP = 1.25;
const MAX_PIXELS = 5_000_000;   // píxeles máx. por página dibujada (límite de memoria de iOS)
const KEEP = 3;                 // páginas dibujadas por encima/debajo de las visibles

let libPromise = null;
function loadLib() {
  if (!libPromise) {
    libPromise = import(`${BASE}pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${BASE}pdf.worker.min.mjs`;
      return lib;
    }).catch((e) => { libPromise = null; throw e; });
  }
  return libPromise;
}

/** Normaliza para buscar (minúsculas, sin tildes) guardando a qué carácter original corresponde cada uno */
function fold(str) {
  let s = ''; const map = [];
  for (let i = 0; i < str.length; i++) {
    const n = str[i].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (let k = 0; k < n.length; k++) { s += n[k]; map.push(i); }
  }
  map.push(str.length);
  return { s, map };
}
function findAll(str, q) {
  const { s, map } = fold(str);
  const out = [];
  if (!q) return out;
  for (let i = s.indexOf(q); i >= 0; i = s.indexOf(q, i + q.length)) out.push([map[i], map[i + q.length]]);
  return out;
}

/**
 * Abre el visor. url: blob: del PDF. onOpenTab / onDownload: acciones de la cabecera.
 */
export async function openPdfViewer({ url, name, onOpenTab, onDownload }) {
  // ---------- Interfaz ----------
  const zoomLabel = el('span', { class: 'pdfv-zoom' }, '100%');
  const pageInput = el('input', { class: 'pdfv-page-in', type: 'text', inputmode: 'numeric', value: '1', 'aria-label': 'Ir a la página' });
  const pageTotal = el('span', { class: 'pdfv-total' }, 'de …');
  const btn = (label, title, onclick, cls = '') => el('button', { class: `icon-btn ${cls}`, type: 'button', title, 'aria-label': title, onclick }, label);
  const findInput = el('input', { type: 'search', placeholder: 'Buscar en el PDF…', enterkeyhint: 'search', 'aria-label': 'Buscar en el PDF' });
  const findCount = el('span', { class: 'pdfv-count' });
  const findBar = el('div', { class: 'pdfv-find', hidden: true },
    findInput, findCount,
    btn('▲', 'Anterior', () => step(-1)), btn('▼', 'Siguiente', () => step(1)),
    btn('✕', 'Cerrar búsqueda', () => toggleFind(false)));
  const bar = el('div', { class: 'pdfv-bar' },
    btn('−', 'Alejar', () => setZoom(zoom / STEP)),
    zoomLabel,
    btn('+', 'Acercar', () => setZoom(zoom * STEP)),
    btn('↔', 'Ajustar al ancho', () => setZoom(1), 'pdfv-fit'),
    el('span', { class: 'pdfv-sep' }),
    el('span', { class: 'pdfv-pages-ctl' }, 'Pág.', pageInput, pageTotal),
    el('span', { class: 'pdfv-sep' }),
    btn('🔍', 'Buscar texto', () => toggleFind()));
  const pagesEl = el('div', { class: 'pdfv-pages' });
  const msg = el('div', { class: 'pdfv-msg' }, 'Cargando PDF…');
  const scroller = el('div', { class: 'pdfv-scroll', tabindex: '0' }, pagesEl, msg);
  const body = el('div', { class: 'pdfv' }, bar, findBar, scroller);

  let closed = false;
  const done = modal({
    title: name || 'PDF', wide: true, cls: 'pdf', body, actions: [],
    onOpen: (box) => {
      const head = box.querySelector('.modal-head');
      const x = head.lastElementChild;
      head.insertBefore(el('button', { class: 'btn sm pdfv-act', type: 'button', title: 'Abrir en pestaña', onclick: onOpenTab },
        '↗', el('span', {}, ' Abrir en pestaña')), x);
      head.insertBefore(el('button', { class: 'btn sm pdfv-act', type: 'button', title: 'Descargar', onclick: onDownload },
        '⬇', el('span', {}, ' Descargar')), x);
      setTimeout(() => scroller.focus({ preventScroll: true }), 50);
    }
  });

  // ---------- Estado ----------
  let doc = null, lib = null;
  let sizes = [];               // tamaño de cada página a escala 1 {w, h}
  let pages = [];               // {div, canvas, text, scale, task, busy}
  let zoom = 1, avail = 300;     // avail: ancho útil de la pantalla
  // Cada página se ajusta al ancho por separado (las apaisadas no se salen de la pantalla)
  const scaleOf = (i) => Math.max(0.05, avail / sizes[i].w) * zoom;
  let lastWidth = 0;
  let current = 0;
  const textCache = [];         // textos de cada página (para buscar)

  done.then(() => {
    closed = true;
    ro?.disconnect();
    for (const p of pages) p.task?.cancel();
    doc?.destroy();
  });

  try {
    lib = await loadLib();
    const data = new Uint8Array(await (await fetch(url)).arrayBuffer());
    if (closed) return;
    doc = await lib.getDocument({
      data,
      isEvalSupported: false,
      enableXfa: false,
      cMapUrl: `${BASE}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${BASE}standard_fonts/`,
      wasmUrl: `${BASE}wasm/`,
      iccUrl: `${BASE}iccs/`
    }).promise;
  } catch (e) {
    console.error(e);
    if (closed) return;
    msg.textContent = e?.name === 'PasswordException'
      ? 'Este PDF tiene contraseña. Ábrelo en pestaña o descárgalo.'
      : 'No se ha podido mostrar el PDF. Prueba «Abrir en pestaña» o «Descargar».';
    return;
  }
  if (closed) { doc.destroy(); return; }
  msg.remove();

  const n = doc.numPages;
  pageTotal.textContent = `de ${n}`;
  const p1 = await doc.getPage(1);
  const v1 = p1.getViewport({ scale: 1 });
  sizes = Array.from({ length: n }, () => ({ w: v1.width, h: v1.height }));
  sizes[0].known = true;
  pages = sizes.map((_, i) => {
    const div = el('div', { class: 'pdfv-page', dataset: { n: i + 1 } });
    pagesEl.append(div);
    return { div, canvas: null, text: null, scale: 0, task: null, busy: false };
  });

  // ---------- Disposición ----------
  function computeFit() {
    const pad = parseFloat(getComputedStyle(pagesEl).paddingLeft) || GAP;
    const w = scroller.clientWidth - pad * 2;
    avail = Math.max(50, w);
  }
  function layout() {
    for (let i = 0; i < n; i++) {
      const scale = scaleOf(i);
      const s = pages[i].div.style;
      s.width = `${Math.floor(sizes[i].w * scale)}px`;
      s.height = `${Math.floor(sizes[i].h * scale)}px`;
      s.setProperty('--total-scale-factor', scale);
    }
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }
  // Punto del documento bajo una posición de la pantalla (para no perder el sitio al hacer zoom)
  function anchorAt(x, y) {
    const i = pageAt(scroller.scrollTop + y);
    const d = pages[i].div;
    return { i, fx: (scroller.scrollLeft + x - d.offsetLeft) / d.offsetWidth, fy: (scroller.scrollTop + y - d.offsetTop) / d.offsetHeight, x, y };
  }
  function restore(a) {
    const d = pages[a.i].div;
    scroller.scrollLeft = d.offsetLeft + a.fx * d.offsetWidth - a.x;
    scroller.scrollTop = d.offsetTop + a.fy * d.offsetHeight - a.y;
  }
  function pageAt(y) {
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pages[mid].div.offsetTop - GAP / 2 <= y) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function setZoom(z, ax = scroller.clientWidth / 2, ay = scroller.clientHeight / 2) {
    z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    if (Math.abs(z - 1) < 0.03) z = 1;
    const a = anchorAt(ax, ay);
    zoom = z;
    layout();
    restore(a);
    update();
  }

  // ---------- Dibujo bajo demanda ----------
  let pumping = false;
  function update() {
    if (closed) return;
    const top = scroller.scrollTop, bottom = top + scroller.clientHeight;
    const first = pageAt(top), last = pageAt(bottom);
    // Página actual: la que ocupa el centro de la pantalla
    current = pageAt(top + scroller.clientHeight / 2);
    if (document.activeElement !== pageInput) pageInput.value = String(current + 1);
    // Liberar las lejanas
    for (let i = 0; i < n; i++) {
      if ((i < first - KEEP || i > last + KEEP) && (pages[i].canvas || pages[i].task)) release(i);
    }
    want = [];
    for (let i = first; i <= last; i++) want.push(i);
    if (last + 1 < n) want.push(last + 1);
    if (first - 1 >= 0) want.push(first - 1);
    pump();
  }
  let want = [];
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (!closed) {
        const i = want.find((k) => pages[k].scale !== scaleOf(k));
        if (i == null) break;
        await render(i);
      }
    } finally { pumping = false; }
  }
  function release(i) {
    const p = pages[i];
    p.task?.cancel(); p.task = null;
    if (p.canvas) { p.canvas.width = p.canvas.height = 0; p.canvas.remove(); p.canvas = null; }
    p.text?.remove(); p.text = null;
    p.scale = 0;
  }
  async function render(i) {
    const p = pages[i];
    let s = scaleOf(i);
    p.scale = s;
    try {
      const page = await doc.getPage(i + 1);
      if (!sizes[i].known) {
        const v = page.getViewport({ scale: 1 });
        const old = sizes[i];
        sizes[i] = { w: v.width, h: v.height, known: true };
        if (Math.abs(v.width - old.w) > 0.5 || Math.abs(v.height - old.h) > 0.5) {
          const a = anchorAt(0, 0); layout(); restore(a);
          s = scaleOf(i); p.scale = s;
        }
      }
      const vp = page.getViewport({ scale: s });
      const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_PIXELS / (vp.width * vp.height)));
      const canvas = el('canvas', { class: 'pdfv-canvas' });
      canvas.width = Math.floor(vp.width * ratio);
      canvas.height = Math.floor(vp.height * ratio);
      p.task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
      await p.task.promise;
      p.task = null;
      if (closed || p.scale !== s) { canvas.width = canvas.height = 0; return; }
      if (p.canvas) { p.canvas.width = p.canvas.height = 0; p.canvas.replaceWith(canvas); } else p.div.prepend(canvas);
      p.canvas = canvas;
      // Capa de texto (seleccionar y resaltar búsquedas)
      const content = await page.getTextContent();
      if (closed || p.scale !== s) return;
      textCache[i] = content.items.map((it) => it.str || '');
      const text = el('div', { class: 'textLayer' });
      const tl = new lib.TextLayer({ textContentSource: content, container: text, viewport: vp });
      await tl.render();
      if (closed || p.scale !== s) return;
      p.text?.remove();
      p.div.append(text);
      p.text = text;
      p.spans = tl.textDivs;
      highlight(i);
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') console.error(e);
      if (p.scale === s) p.scale = 0;
    }
  }

  // ---------- Eventos ----------
  let raf = 0;
  scroller.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); }, { passive: true });

  // Girar el móvil / cambiar el tamaño de la ventana: volver a ajustar
  const ro = new ResizeObserver(() => {
    const w = scroller.clientWidth;
    if (!w || Math.abs(w - lastWidth) < 2) return;
    const a = lastWidth ? anchorAt(0, 0) : null;
    lastWidth = w;
    computeFit(); layout();
    if (a) { a.fx = 0; a.x = 0; restore(a); }
    update();
  });
  ro.observe(scroller);

  // Tamaño real de cada página en segundo plano (por si hay páginas apaisadas o de otro tamaño)
  (async () => {
    let changed = false;
    for (let i = 1; i < n && !closed; i++) {
      if (sizes[i].known) continue;
      try {
        const v = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
        if (closed) return;
        if (sizes[i].known) continue;
        if (Math.abs(v.width - sizes[i].w) > 0.5 || Math.abs(v.height - sizes[i].h) > 0.5) changed = true;
        sizes[i] = { w: v.width, h: v.height, known: true };
      } catch { /* página dañada: se queda con el tamaño de la primera */ }
      if (changed && (i % 25 === 0 || i === n - 1)) {
        changed = false;
        const a = anchorAt(0, 0); a.fx = 0; a.x = 0; layout(); restore(a); update();
      }
    }
  })();

  // Ir a una página
  function goTo(num) {
    const i = Math.min(n, Math.max(1, num | 0)) - 1;
    scroller.scrollTop = pages[i].div.offsetTop - GAP;
    pageInput.value = String(i + 1);
    update();
  }
  pageInput.addEventListener('focus', () => pageInput.select());
  pageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); goTo(parseInt(pageInput.value, 10) || 1); pageInput.blur(); }
  });
  pageInput.addEventListener('change', () => goTo(parseInt(pageInput.value, 10) || current + 1));

  // Pellizco (móvil)
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  scroller.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    const r = scroller.getBoundingClientRect(), pr = pagesEl.getBoundingClientRect();
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2, cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    pinch = { d0: dist(e.touches), f: 1, x: cx - r.left, y: cy - r.top };
    pagesEl.style.transformOrigin = `${cx - pr.left}px ${cy - pr.top}px`;
  }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const f = Math.min(MAX_ZOOM / zoom, Math.max(MIN_ZOOM / zoom, dist(e.touches) / pinch.d0));
    pinch.f = f;
    pagesEl.style.transform = `scale(${f})`;
  }, { passive: false });
  const endPinch = () => {
    if (!pinch) return;
    const { f, x, y } = pinch;
    pinch = null;
    pagesEl.style.transform = '';
    if (Math.abs(f - 1) > 0.02) setZoom(zoom * f, x, y);
  };
  scroller.addEventListener('touchend', (e) => { if (e.touches.length < 2) endPinch(); });
  scroller.addEventListener('touchcancel', endPinch);
  // Safari: que el pellizco no amplíe la página entera
  for (const ev of ['gesturestart', 'gesturechange']) scroller.addEventListener(ev, (e) => e.preventDefault());

  // Ctrl + rueda / pellizco en el panel táctil del portátil
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = scroller.getBoundingClientRect();
    setZoom(zoom * Math.exp(-e.deltaY / 300), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  body.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFind(true); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { e.preventDefault(); setZoom(zoom * STEP); }
    else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); setZoom(zoom / STEP); }
    else if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); setZoom(1); }
  });

  // ---------- Buscar ----------
  let query = '', matches = [], sel = -1, searchId = 0, pendingFocus = false;
  function toggleFind(show = findBar.hidden) {
    findBar.hidden = !show;
    if (show) { findInput.focus(); findInput.select(); } else { setQuery(''); findInput.value = ''; scroller.focus({ preventScroll: true }); }
  }
  let t = 0;
  findInput.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => setQuery(findInput.value), 300); });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (fold(findInput.value.trim()).s !== query) { clearTimeout(t); setQuery(findInput.value); } else step(e.shiftKey ? -1 : 1);
    }
  });

  async function setQuery(v) {
    const q = fold(v.trim()).s;
    if (q === query) return;
    query = q; matches = []; sel = -1;
    const id = ++searchId;
    for (let i = 0; i < n; i++) highlight(i);
    if (!q) { findCount.textContent = ''; return; }
    findCount.textContent = 'Buscando…';
    // Empieza por la página actual para que el primer resultado salga cerca
    for (let k = 0; k < n; k++) {
      const i = (current + k) % n;
      if (!textCache[i]) {
        try {
          const page = await doc.getPage(i + 1);
          const c = await page.getTextContent();
          textCache[i] = c.items.map((it) => it.str || '');
        } catch { textCache[i] = []; }
      }
      if (id !== searchId || closed) return;
      let count = 0;
      for (const s of textCache[i]) count += findAll(s, q).length;
      for (let m = 0; m < count; m++) matches.push({ page: i, m });
      if (count && sel < 0) { sortMatches(); sel = matches.findIndex((x) => x.page === i); focusMatch(); }
      findCount.textContent = matches.length ? `${sel + 1} de ${matches.length}${k < n - 1 ? '…' : ''}` : (k < n - 1 ? `Buscando… ${k + 1}/${n}` : '');
    }
    sortMatches();
    findCount.textContent = matches.length ? `${sel + 1} de ${matches.length}` : 'Sin resultados';
  }
  function sortMatches() {
    const cur = matches[sel];
    matches.sort((a, b) => a.page - b.page || a.m - b.m);
    if (cur) sel = matches.indexOf(cur);
  }
  function step(d) {
    if (!matches.length) { if (findInput.value.trim()) setQuery(findInput.value); return; }
    sel = (sel + d + matches.length) % matches.length;
    findCount.textContent = `${sel + 1} de ${matches.length}${findCount.textContent.endsWith('…') ? '…' : ''}`;
    focusMatch();
  }
  function focusMatch() {
    const m = matches[sel];
    if (!m) return;
    for (let i = 0; i < n; i++) if (pages[i].text) highlight(i);
    pendingFocus = true;
    if (!scrollToMark(m.page)) {
      scroller.scrollTop = pages[m.page].div.offsetTop - GAP;
      update();
    }
  }
  function scrollToMark(i) {
    const mark = pages[i].text?.querySelector('mark.selected');
    if (!mark || !pendingFocus) return false;
    pendingFocus = false;
    const r = mark.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
    scroller.scrollTop += r.top - sr.top - scroller.clientHeight / 3;
    scroller.scrollLeft += r.left - sr.left - scroller.clientWidth / 2 + r.width / 2;
    return true;
  }
  // Resalta los resultados en la capa de texto de una página
  function highlight(i) {
    const p = pages[i];
    if (!p.text || !p.spans) return;
    let m = 0;
    const cur = matches[sel];
    p.spans.forEach((span) => {
      const str = span.textContent;
      const hits = query ? findAll(str, query) : [];
      if (!hits.length) { if (span.firstElementChild) span.textContent = str; return; }
      span.textContent = '';
      let pos = 0;
      for (const [a, b] of hits) {
        span.append(str.slice(pos, a), el('mark', { class: cur && cur.page === i && cur.m === m ? 'selected' : '' }, str.slice(a, b)));
        pos = b; m++;
      }
      span.append(str.slice(pos));
    });
    if (cur && cur.page === i) scrollToMark(i);
  }
}
