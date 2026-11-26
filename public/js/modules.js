// Módulos de Dr.Folio. De aquí salen la pantalla de Inicio, la franja de iconos (tablet/PC)
// y la barra inferior (móvil). Para añadir uno nuevo: una línea más aquí. Cuando esté listo,
// cambia status a 'active' y pon en `route` la ruta que abre su vista (ver parseHash en app.js).
//   id      identificador interno (= sección: 'notes' | 'snippets' | …)
//   name    nombre visible
//   short   (opcional) nombre corto para la barra inferior del móvil
//   icon    emoji del icono
//   desc    una línea de descripción
//   route   ruta (#/...) que abre el módulo
//   status  'active' | 'soon' (Próximamente: visible pero desactivado)
//   count   (opcional) clave para mostrar un recuento: 'notes' | 'snippets'
//   tab     (opcional) true = aparece en la barra inferior del móvil (caben 2–3 junto a Inicio, ＋ y Buscar)
export const MODULES = [
  { id: 'notes', name: 'Notas', icon: '🗂', desc: 'Carpetas, etiquetas, bibliografía y PDFs', route: '#/notas', status: 'active', count: 'notes', tab: true },
  { id: 'snippets', name: 'Prerredactados', short: 'Prerredact.', icon: '📋', desc: 'Textos para copiar con campos a rellenar', route: '#/snippets', status: 'active', count: 'snippets', tab: true },
  { id: 'vademecum', name: 'Vademécum', icon: '💊', desc: 'Fármacos, dosis y ajustes de uso habitual', route: '#/vademecum', status: 'soon' },
  { id: 'chat', name: 'Chat conmigo mismo', short: 'Chat', icon: '💬', desc: 'Envíate textos y documentos entre dispositivos', route: '#/chat', status: 'soon' }
];

// Accesos fijos de la navegación (no son módulos): siempre al principio y al final.
export const NAV_HOME = { id: 'home', name: 'Inicio', icon: '🏠', route: '#/inicio' };
export const NAV_SEARCH = { id: 'search', name: 'Buscar', icon: '🔎', route: '#/buscar' };
