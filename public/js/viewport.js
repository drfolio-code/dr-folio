// Ajuste al alto real visible de la pantalla (barras del navegador, teclado del móvil).
// Fija --app-h / --app-top con el "visual viewport": cuando se abre el teclado la app
// se encoge a la zona visible, así el editor y la barra de formato no quedan tapados.

const root = document.documentElement;
const vv = window.visualViewport;
let raf = 0;
// Alto de la pantalla sin teclado (por ancho: al girar se vuelve a medir)
let base = { w: 0, h: 0 };

function update() {
  raf = 0;
  fullHeight();
  const h = vv ? vv.height : window.innerHeight;
  const top = vv ? Math.max(0, vv.offsetTop) : 0;
  root.style.setProperty('--app-h', `${Math.round(h)}px`);
  root.style.setProperty('--app-top', `${Math.round(top)}px`);
  const typing = isTyping();
  const full = Math.max(window.innerHeight, h);
  if (window.innerWidth !== base.w) base = { w: window.innerWidth, h: full };
  else if (!typing || full > base.h) base.h = full;
  // Teclado abierto: la zona visible es bastante más baja que la ventana (iOS) o que antes de escribir
  // (Android encoge la ventana entera). Con él abierto se oculta la barra inferior del móvil.
  const kb = typing && ((!!vv && window.innerHeight - h > 120) || base.h - h > 150);
  document.body.classList.toggle('kb-open', kb);
  if (kb) setTimeout(caretIntoView, 60);
}

function isTyping() {
  const a = document.activeElement;
  return !!a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}

/** Si el cursor queda debajo del borde visible del panel, desplaza el panel. */
function caretIntoView() {
  const sel = window.getSelection();
  const a = document.activeElement;
  if (!a) return;
  const scroller = a.closest('.ed-scroll');
  if (!scroller) return;
  let rect = null;
  if (a.isContentEditable && sel?.rangeCount) {
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(false);
    rect = r.getClientRects()[0] || r.startContainer?.parentElement?.getBoundingClientRect?.();
  }
  if (!rect) rect = a.getBoundingClientRect();
  const box = scroller.getBoundingClientRect();
  if (rect.bottom > box.bottom - 12) scroller.scrollTop += rect.bottom - box.bottom + 40;
  else if (rect.top < box.top) scroller.scrollTop -= box.top - rect.top + 20;
  // iOS a veces desplaza la página entera: la devolvemos a su sitio
  if (window.scrollY) window.scrollTo(0, 0);
}

/**
 * App instalada en iPhone (standalone): iOS a veces da a la página una ventana más baja que la
 * pantalla (le resta la barra de estado) y no deja dibujar debajo. Se detecta ese hueco (--h-gap,
 * html.short-h) para no sumar además el margen de la barra de inicio del iPhone.
 */
let probe = null;
function safeTop() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
  }
  return probe.getBoundingClientRect().height;
}
/** Alto de la pantalla en la orientación actual */
function screenH() {
  const land = window.innerWidth > window.innerHeight;
  return land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
}
// Ajuste del alto en el iPhone instalado (Ajustes): 'auto' | 'vh' (100vh) | 'screen' (alto de la pantalla)
const FIT_KEY = 'drfolio.fit';
export function fitMode() { try { return localStorage.getItem(FIT_KEY) || 'auto'; } catch { return 'auto'; } }
export function setFitMode(m) { try { localStorage.setItem(FIT_KEY, m); } catch {} update(); }
/** Medidas para diagnosticar (se muestran en Ajustes) */
export function screenInfo() {
  const m = (css) => { const d = document.createElement('div'); d.style.cssText = `position:fixed;top:0;left:0;width:0;visibility:hidden;height:${css}`; document.body.appendChild(d); const h = Math.round(d.getBoundingClientRect().height); d.remove(); return h; };
  return `pantalla ${screen.width}×${screen.height} · ventana ${window.innerWidth}×${window.innerHeight} · visible ${Math.round(vv?.height || 0)} · vh ${m('100vh')} · dvh ${m('100dvh')} · lvh ${m('100lvh')} · arriba ${m('env(safe-area-inset-top,0px)')} · abajo ${m('env(safe-area-inset-bottom,0px)')} · ${navigator.standalone ? 'instalada' : 'navegador'}`;
}
const standalone = () => navigator.standalone === true; // solo existe en iOS
function fullHeight() {
  const mode = fitMode();
  root.classList.toggle('fit-vh', mode === 'vh');
  root.classList.toggle('fit-screen', mode === 'screen');
  if (mode === 'screen') root.style.setProperty('--scr-h', `${screenH()}px`);
  if (mode !== 'auto') return setGap(0);
  let gap = 0;
  if (standalone() && screen?.width && screen?.height) {
    const land = window.innerWidth > window.innerHeight;
    const sw = land ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const sh = land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    // Solo si la ventana es la pantalla entera (no en iPad con varias ventanas) y le falta alto
    const g = sh - window.innerHeight;
    // Con la barra de estado sólida (zona segura de arriba = 0) la ventana empieza debajo de ella: no es el fallo
    if (safeTop() < 1) return setGap(0);
    if (Math.abs(window.innerWidth - sw) <= 2 && g > 10 && g < 120 && !isTyping()) gap = g;
  }
  setGap(gap);
}
function setGap(gap) {
  if (gap) root.style.setProperty('--h-gap', `${gap}px`);
  else root.style.removeProperty('--h-gap');
  root.classList.toggle('short-h', !!gap);
}

const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };

export function initViewport() {
  // iPhone/iPad: sin «interactive-widget» (es de Chrome Android; en iOS puede acortar la ventana)
  if (typeof navigator.standalone === 'boolean') {
    const m = document.querySelector('meta[name="viewport"]');
    if (m) m.content = m.content.replace(/,\s*interactive-widget=[^,]*/, '');
  }
  update();
  if (vv) { vv.addEventListener('resize', schedule); vv.addEventListener('scroll', schedule); }
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', () => setTimeout(update, 250));
  document.addEventListener('focusin', () => setTimeout(update, 300));
  document.addEventListener('focusout', () => setTimeout(update, 300));
}

// ---------- Títulos de varias líneas (textarea que crece con el texto) ----------
const autoSize = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');
/** Ajusta el alto del título al texto (si el navegador no lo hace solo con field-sizing). */
export function fitTitle(el) {
  if (!el || autoSize || !el.offsetParent) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
/** Títulos: sin saltos de línea (como un campo de una línea) y con el alto justo. */
export function initTitles(...els) {
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((es) => es.forEach((e) => fitTitle(e.target))) : null;
  for (const el of els) {
    if (!el) continue;
    el.addEventListener('input', () => {
      if (/[\r\n]/.test(el.value)) {
        const p = el.selectionStart;
        el.value = el.value.replace(/[\r\n]+/g, ' ');
        el.setSelectionRange(p, p);
      }
      fitTitle(el);
    }, true);
    ro?.observe(el);
  }
}
