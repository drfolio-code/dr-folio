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
  // (v1.15.2) Sin teclado NO se mueve la página: el scrollTo de v1.14.1–v1.15.1 desplazaba la ventana en iOS
  // y dejaba una franja bajo la barra inferior. Es el comportamiento de v1.11.9, confirmado en el iPhone de Adrián.
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
/** Margen seguro de arriba real (env(safe-area-inset-top)) */
function safeTop() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)';
    document.documentElement.append(probe);
  }
  return parseFloat(getComputedStyle(probe).paddingTop) || 0;
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
  // Ventana más baja que la pantalla (medido en el iPhone de Adrián: pantalla 844, ventana 797, margen arriba 47):
  //  · margen de arriba > 0 → la ventana empieza bajo el reloj (barra de estado «black-translucent», la de las
  //    instalaciones antiguas) y le faltan esos 47 ABAJO; ahí no se puede dibujar → short-h: la barra queda al
  //    final de la ventana y el fondo de <html> es el de la barra (se ve continua hasta el borde).
  //  · margen de arriba 0 → la ventana empieza DEBAJO del reloj (barra «black», v1.16.0, al volver a instalar)
  //    y llega abajo del todo: no hace falta nada, los márgenes seguros normales ya valen.
  const under = !!gap && safeTop() > 20;
  // Comprobado en el iPhone de Adrián (v1.15.0 y v1.17.0): aunque la app mida 844 (fixed o contenido normal),
  // iOS solo la ENSEÑA hasta 797; lo de debajo es el fondo del propio iPhone. No se puede dibujar ahí: la barra
  // va entera al final de la ventana (short-h). Solo lo arregla iOS (barra de estado «black» al instalar).
  if (under) root.style.setProperty('--h-gap', `${gap}px`); else root.style.removeProperty('--h-gap');
  root.classList.toggle('short-h', under);
  // App instalada en iPhone: el fondo de la página es el de la barra inferior, así nunca se ve una franja suelta
  root.classList.toggle('ios-app', navigator.standalone === true);
}

/** Medidas de la pantalla para Ajustes (diagnóstico; para poder arreglar sin adivinar) */
export function screenInfo() {
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.append(p);
  const cs = getComputedStyle(p);
  const ins = `${Math.round(parseFloat(cs.paddingTop) || 0)}/${Math.round(parseFloat(cs.paddingBottom) || 0)}`;
  p.remove();
  const app = document.querySelector('#app')?.getBoundingClientRect();
  return [
    `ventana ${window.innerWidth}×${window.innerHeight}`, `pantalla ${screen.width}×${screen.height}`,
    vv ? `visible ${Math.round(vv.height)}+${Math.round(vv.offsetTop)}` : null, `desplaz. ${Math.round(window.scrollY)}`,
    `márgenes ${ins}`, app ? `app ${Math.round(app.top)}–${Math.round(app.bottom)}` : null,
    (() => { const t = document.querySelector('#tabbar'); if (!t || !t.offsetParent) return null; const r = t.getBoundingClientRect(); return `barra ${Math.round(r.top)}–${Math.round(r.bottom)} (relleno ${parseFloat(getComputedStyle(t).paddingBottom) || 0})`; })(),
    `${navigator.standalone === true ? 'instalada' : 'navegador'}${root.className ? ` · ${root.className}` : ''}`
  ].filter(Boolean).join(' · ');
}

const schedule = () => { if (!raf) raf = requestAnimationFrame(update); };

// Doble toque sin zoom (v1.26.2). El CSS (touch-action: manipulation) basta en casi todos los
// navegadores; esto es el respaldo para Safari iOS. No toca los campos de texto ni el editor
// (ahí el doble toque selecciona palabra) ni el visor de PDF (tiene su propio zoom).
function noDoubleTapZoom() {
  let last = 0, lx = 0, ly = 0;
  document.addEventListener('touchend', (e) => {
    if (e.touches.length || e.changedTouches.length !== 1) { last = 0; return; }
    const t = e.changedTouches[0], now = Date.now();
    const near = Math.abs(t.clientX - lx) < 40 && Math.abs(t.clientY - ly) < 40;
    const tg = e.target;
    const skip = tg.closest && tg.closest('input, textarea, select, [contenteditable="true"], .pdfv, .pdf-viewer');
    if (!skip && near && now - last < 350) { e.preventDefault(); last = 0; return; }
    last = now; lx = t.clientX; ly = t.clientY;
  }, { passive: false });
}

export function initViewport() {
  // iPhone/iPad: sin «interactive-widget» (es de Chrome Android; en iOS puede acortar la ventana)
  if (typeof navigator.standalone === 'boolean') {
    const m = document.querySelector('meta[name="viewport"]');
    if (m) m.content = m.content.replace(/,\s*interactive-widget=[^,]*/, '');
  }
  noDoubleTapZoom();
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
