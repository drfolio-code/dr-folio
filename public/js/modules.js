// Módulos de Dr.Folio. De aquí salen la pantalla de Inicio, la franja de iconos (tablet/PC),
// la barra inferior (móvil) y la hoja «Más». Para añadir uno nuevo: una línea más aquí. Cuando esté listo,
// cambia status a 'active' y pon en `route` la ruta que abre su vista (ver parseHash en app.js).
//   id      identificador interno (= sección: 'notes' | 'snippets' | …)
//   name    nombre visible
//   short   (opcional) nombre corto para la barra inferior del móvil
//   icon    nombre del icono SVG (Lucide, ver js/icons.js y tools/build-icons.mjs)
//   desc    una línea de descripción
//   route   ruta (#/...) que abre el módulo
//   status  'active' | 'soon' (Próximamente: visible pero desactivado)
//   count   (opcional) clave para mostrar un recuento: 'notes' | 'snippets' | 'drugs' | 'chat' (mensajes nuevos)
//   tab     (opcional) true = se puede elegir como «sección fija» de la barra inferior del móvil (v1.19.0).
//           La barra es siempre: Inicio · [sección fija] · ＋ Crear · Buscar · Más. El resto, en «Más».
export const MODULES = [
  { id: 'notes', name: 'Notas', icon: 'notebook-text', desc: 'Carpetas, etiquetas, bibliografía y PDFs', route: '#/notas', status: 'active', count: 'notes', tab: true },
  { id: 'snippets', name: 'Prerredactados', short: 'Prerredact.', icon: 'clipboard-list', desc: 'Textos para copiar con campos a rellenar', route: '#/snippets', status: 'active', count: 'snippets', tab: true },
  { id: 'drugs', name: 'Vademécum', icon: 'pill', desc: 'Tus fármacos: pautas para copiar al informe', route: '#/vademecum', status: 'active', count: 'drugs', tab: true },
  { id: 'chat', name: 'Chat personal', short: 'Chat', icon: 'message-circle', desc: 'Envíate textos, fotos y documentos entre dispositivos', route: '#/chat', status: 'active', count: 'chat', tab: true }
];

// Sección fija de la barra inferior por defecto (se cambia en Más → «Personalizar barra» o en Ajustes; drfolio.tabFixed)
export const TAB_DEFAULT = 'notes';

// Accesos fijos de la navegación (no son módulos): siempre al principio y al final.
export const NAV_HOME = { id: 'home', name: 'Inicio', icon: 'house', route: '#/inicio' };
export const NAV_SEARCH = { id: 'search', name: 'Buscar', icon: 'search', route: '#/buscar' };
export const NAV_MORE = { id: 'more', name: 'Más', icon: 'circle-ellipsis' }; // solo en la barra inferior del móvil
