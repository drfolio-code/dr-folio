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
  const was = document.body.classList.contains('kb-open');
  document.body.classList.toggle('kb-open', kb);
  if (was && !kb) kickLayout();
  if (kb) setTimeout(caretIntoView, 60);
  // Sin teclado, la página nunca debe quedar desplazada (iOS a veces la deja movida al cerrar el teclado)
  else if (window.scrollY || (vv && vv.offsetTop > 0)) window.scrollTo(0, 0);
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

/** Alto de la pantalla en la orientación actual */
function screenH() {
  const land = window.innerWidth > window.innerHeight;
  return land ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
}
/**
 * App instalada en iPhone (standalone): iOS da a la página una ventana más baja que la pantalla
 * (innerHeight = pantalla − barra de estado). Lo que falta ya cubre la barra de inicio del iPhone,
 * así que no se suma además ese margen (html.short-h, --h-gap). Probado en el iPhone de Adrián.
 */
let probe = null;
/** Márgenes seguros reales que da iOS (env(safe-area-inset-*)) */
function insets() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
    document.documentElement.append(probe);
  }
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}
function fullHeight() {
  let gap = 0;
  if (navigator.standalone === true && screen?.width && screen?.height) {
    const land = window.innerWidth > window.innerHeight;
    const sw = land ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    const g = screenH() - window.innerHeight;
    // Solo si la ventana es la pantalla entera (no en iPad con varias ventanas) y le falta alto
    if (Math.abs(window.innerWidth - sw) <= 2 && g > 2 && g < 120) gap = g;
  }
  // Dos casos con la ventana más baja que la pantalla:
  //  · empieza DEBAJO de la barra de estado (margen de arriba 0) → llega abajo del todo: short-h (v1.11.9, confirmado)
  //  · empieza ARRIBA (margen de arriba > 0, pasa tras usar el teclado) → falta abajo: la app se alarga hasta
  //    el alto de la pantalla (tall-fix), así no queda franja debajo de la barra inferior
  const tall = !!gap && insets().top > 20;
  if (gap) root.style.setProperty('--h-gap', `${gap}px`); else root.style.removeProperty('--h-gap');
  root.style.setProperty('--screen-h', `${screenH()}px`);
  root.classList.toggle('short-h', !!gap && !tall);
  root.classList.toggle('tall-fix', tall);
  // App instalada en iPhone: el fondo de la página es el de la barra inferior, así nunca se ve una franja suelta
  root.classList.toggle('ios-app', navigator.standalone === true);
}

/** Al cerrar el teclado: iOS a veces deja la ventana mal colocada; se le obliga a recolocarla */
function kickLayout() {
  window.scrollTo(0, 0);
  const m = document.querySelector('meta[name="viewport"]');
  if (m && typeof navigator.standalone === 'boolean') {
    const c = m.content;
    m.content = `${c}, maximum-scale=1`;
    setTimeout(() => { m.content = c; schedule(); }, 60);
  }
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
  // Al cerrar el teclado iOS no siempre avisa con «resize»: se vuelve a medir varias veces
  document.addEventListener('focusout', () => { setTimeout(update, 300); setTimeout(update, 800); setTimeout(update, 1600); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(update, 200); });
  window.addEventListener('pageshow', () => setTimeout(update, 200));
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
