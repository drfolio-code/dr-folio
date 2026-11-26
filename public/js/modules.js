// Módulos de Dr.Folio que aparecen en la pantalla de Inicio.
// Para añadir uno nuevo: una línea más aquí. Cuando esté listo, cambia status a 'active'
// y pon en `route` la ruta que abre su vista (ver applyHash en app.js).
//   id      identificador interno
//   name    nombre visible
//   icon    emoji del icono
//   desc    una línea de descripción
//   route   ruta (#/...) que abre el módulo
//   status  'active' | 'soon' (Próximamente: visible pero desactivado)
//   count   (opcional) clave para mostrar un recuento: 'notes' | 'snippets'
export const MODULES = [
  { id: 'notes', name: 'Notas', icon: '🗂', desc: 'Carpetas, etiquetas, bibliografía y PDFs', route: '#/all', status: 'active', count: 'notes' },
  { id: 'snippets', name: 'Prerredactados', icon: '📋', desc: 'Textos para copiar con campos a rellenar', route: '#/snippets', status: 'active', count: 'snippets' },
  { id: 'vademecum', name: 'Vademécum', icon: '💊', desc: 'Fármacos, dosis y ajustes de uso habitual', route: '#/vademecum', status: 'soon' },
  { id: 'chat', name: 'Chat conmigo mismo', icon: '💬', desc: 'Envíate textos y documentos entre dispositivos', route: '#/chat', status: 'soon' }
];
