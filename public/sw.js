// Service worker de Dr.Folio: guarda la app para usarla sin conexión.
// Los datos (notas) los guarda Firestore por su cuenta, no este archivo.
const VERSION = 'drfolio-v1.11.5';
// Visor de PDF (PDF.js): caché aparte que solo cambia al actualizar PDF.js (pesa ~4 MB; no se descarga en cada versión)
const PDFJS_CACHE = 'drfolio-pdfjs-6.5.438';
const PDFJS_DIR = '/vendor/pdfjs/';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest',
  './js/app.js', './js/config.js', './js/db.js', './js/store.js', './js/files.js',
  './js/editor.js', './js/snippets.js', './js/modules.js', './js/viewport.js', './js/pdfviewer.js', './js/backup.js', './js/bodies.js', './js/migrate.js', './js/icons.js', './js/ui.js', './js/util.js', './vendor/libs.js', './vendor/jszip.js', './vendor/icons.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([caches.open(VERSION).then((c) => c.addAll(SHELL)), cachePdfjs()]).then(() => self.skipWaiting()));
});

// Guarda PDF.js para usarlo sin conexión (si falla, se guardará al abrir el primer PDF)
async function cachePdfjs() {
  try {
    const c = await caches.open(PDFJS_CACHE);
    const { files } = await (await fetch(`.${PDFJS_DIR}files.json`, { cache: 'no-store' })).json();
    for (const f of files) {
      const u = `.${PDFJS_DIR}${f}`;
      if (!await c.match(u)) await c.add(u);
    }
  } catch (err) { /* sin conexión: no bloquear la instalación */ }
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== PDFJS_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero (para recibir siempre la última versión); si no hay conexión, caché.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/__/')) return; // rutas internas de Firebase
  // PDF.js no cambia dentro de una misma versión: primero la caché (más rápido y sin conexión)
  if (url.pathname.startsWith(PDFJS_DIR) && !url.pathname.endsWith('files.json')) {
    e.respondWith(caches.open(PDFJS_CACHE).then((c) => c.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))));
    return;
  }
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});
