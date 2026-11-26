# Dr.Folio — guía para Claude

App personal de notas médicas (estilo Evernote/OneNote) de Adrián, médico residente de MFyC.
Responde siempre en **español**, de forma breve y con tablas cuando ayuden. El usuario no es
programador: explica los pasos que tenga que hacer él en lenguaje sencillo.

## Despliegue
- Hacer push a `main` publica automáticamente (GitHub Actions → `.github/workflows/deploy.yml`):
  - **Hosting**: `public/` → https://drfolio.web.app (el sitio antiguo drfolio-6af54.web.app redirige aquí desde `redirect/`)
  - **Reglas de Firestore**: `firestore.rules`
- Proyecto Firebase: `drfolio-6af54` (plan **Spark gratuito**: nunca proponer nada que requiera el plan Blaze ni tarjeta).
- Secreto de GitHub: `FIREBASE_SERVICE_ACCOUNT` (no tocar, nunca imprimirlo).
- Tras cada cambio en la app sube `APP_VERSION` en `public/js/config.js` **y** `VERSION` en `public/sw.js`.

## Arquitectura (sin compilación)
| Archivo | Qué hace |
|---|---|
| `public/index.html` | Estructura de la interfaz (login, barra lateral, lista, editor) |
| `public/styles.css` | Estilos (modo claro/oscuro, responsive: ≥1100 px 3 columnas · 640–1099 lista+nota con barra lateral desplegable · <640 una columna · horizontal con poca altura = cabeceras compactas) |
| `public/js/app.js` | Lógica principal: Inicio, vistas, carpetas, etiquetas, notas, bibliografía, ajustes |
| `public/js/modules.js` | Lista de módulos de la pantalla de Inicio (`id, name, icon, desc, route, status: 'active'\|'soon'`). Añadir un módulo = una línea aquí |
| `public/js/viewport.js` | Alto real visible (`--app-h`/`--app-top` con visualViewport) para que el teclado del móvil no tape el editor |
| `public/js/editor.js` | Editor `contenteditable`: barra de formato, pegado limpio (DOMPurify), tablas, listas de tareas, enlaces entre notas, índice |
| `public/js/snippets.js` | Prerredactados: lista, editor de texto plano, campos `{campo}` / `{campo:a\|b}`, copiar e insertar en notas |
| `public/js/store.js` | Datos en memoria sincronizados con Firestore (`onSnapshot`) + ayudas de carpetas |
| `public/js/files.js` | Imágenes/PDF guardados **en Firestore en trozos base64** (no hay Storage en Spark) |
| `public/js/db.js` | Inicialización Firebase, login, modo dispositivo, logout |
| `public/js/ui.js` | Modales, menús, selectores, toasts propios (no usar alert/prompt: fallan en PWA iOS) |
| `public/vendor/libs.js` | Firebase + DOMPurify empaquetados. Regenerar: `cd tools && npm install && npm run vendor` |
| `public/sw.js` | Service worker (app offline, red primero) |

## Rutas y navegación
- `#/inicio` (por defecto tras el login), `#/all|pinned|trash[/n/NOTA]`, `#/folder/ID[/n/NOTA]`, `#/tag/ID[/n/NOTA]`, `#/snippets[/s/ID]`, `#nota/ID`.
- `history.state.d` = nº de entradas por encima de Inicio: «atrás» (Android) va nota → lista → Inicio; el botón 🏠 hace `history.go(-d)`.
- Al arrancar, `initHistory()` deja `#/inicio` debajo de la ruta abierta.

## Modelo de datos (Firestore, todo bajo `users/{uid}/`)
- `folders/{id}`: `name, parentId|null, color, order, createdAt, updatedAt` (anidación ilimitada)
- `tags/{id}`: `name, color, createdAt`
- `notes/{id}`: `title, html, text, folderId|null, tags[], pinned, trashed, trashedAt, refs[], createdAt, updatedAt`
  - `refs[]`: `{id, cite, url, fileId, fileName, fileSize}` → sección Bibliografía
  - Imágenes en el HTML: `<img data-file="ID">` (sin `src`; se resuelve al mostrar)
  - Enlaces entre notas: `<a data-note="ID" class="note-link" href="#nota/ID">`
- `files/{id}`: `noteId, name, mime, size, kind, chunks, createdAt` + subcolección `chunks/{000..}` `{d: base64}` (700 KB por trozo)
- `snippets/{id}`: `title, body (texto plano), category, uses, lastUsedAt, createdAt, updatedAt` (prerredactados)
- Fechas en milisegundos (`Date.now()`), no `serverTimestamp`.

## Seguridad
- Solo el UID `KCrZacB1H1ZdrxeBbiPuzd7Cp0N2` puede leer/escribir (`firestore.rules` y `OWNER_UID` en config.js).
- Modo "Ordenador público": sesión solo en la pestaña, sin caché offline, cierre por inactividad.
- Todo HTML pasa por `sanitize()` de `editor.js`. No usar `innerHTML` con datos sin sanear.
- Datos de pacientes identificables: **no**. La app es para conocimiento clínico personal.

## Hoja de ruta
1. ✅ Notas: carpetas/subcarpetas, etiquetas, editor enriquecido, imágenes, bibliografía con PDF, índice, enlaces entre notas, offline
2. ✅ Prerredactados (plantillas de texto para copiar, con campos rellenables)
3. Vademécum personal
4. Chat conmigo mismo (enviarse textos y documentos)

## Probar
No hay tests automáticos en el repo. Antes de publicar, al menos `node --check` en cada `public/js/*.js`.
Límites del plan gratuito: 1 GB, 50.000 lecturas y 20.000 escrituras al día.
