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
| `public/js/app.js` | Lógica principal: Inicio, explorador de carpetas, vistas, carpetas, etiquetas, notas, bibliografía, ajustes |
| `public/js/modules.js` | Lista de módulos de la pantalla de Inicio (`id, name, icon, desc, route, status: 'active'\|'soon'`). Añadir un módulo = una línea aquí |
| `public/js/viewport.js` | Alto real visible (`--app-h`/`--app-top` con visualViewport) para que el teclado del móvil no tape el editor |
| `public/js/editor.js` | Editor `contenteditable`: barra de formato, pegado limpio (DOMPurify), tablas, listas de tareas, enlaces entre notas, índice |
| `public/js/snippets.js` | Prerredactados: tarjetas, favoritos, orden, mover, editor de texto plano, campos `{campo}` / `{campo:a\|b}`, copiar, selector para insertar en notas (carpetas, favoritos, más usados, buscar) y migración categoría → carpeta |
| `public/js/store.js` | Datos en memoria sincronizados con Firestore (`onSnapshot`) + ayudas de carpetas (`childFolders`, `folderPath`, `descendantIds`, `flatFolders`: último parámetro = mapa del árbol, por defecto `store.folders`) |
| `public/js/files.js` | Imágenes/PDF guardados **en Firestore en trozos base64** (no hay Storage en Spark) |
| `public/js/db.js` | Inicialización Firebase, login, modo dispositivo, logout |
| `public/js/ui.js` | Modales, menús, selectores, toasts propios (no usar alert/prompt: fallan en PWA iOS). `modal({cls})` añade clase al modal y `has-CLS` al fondo |
| `public/js/pdfviewer.js` | Visor de PDF propio (PDF.js): pantalla completa en móvil, modal grande en tablet/PC, cada página ajustada al ancho, dibujo solo de las páginas visibles (libera las lejanas), zoom (botones, pellizco, Ctrl+rueda), «Pág. X de Y», ir a página, buscar texto (sin tildes/mayúsculas) con resaltado, reajuste al girar |
| `public/vendor/libs.js` | Firebase + DOMPurify empaquetados. Regenerar: `cd tools && npm install && npm run vendor` |
| `public/vendor/pdfjs/` | PDF.js (pdfjs-dist, build **legacy** para Safari iOS) + worker, fuentes, wasm, cmaps. Lo copia `tools/copy-pdfjs.mjs` (incluido en `npm run vendor`) y genera `files.json` |
| `public/sw.js` | Service worker (app offline, red primero). PDF.js va en una caché aparte `PDFJS_CACHE` (caché primero): **si se actualiza pdfjs-dist, cambiar `PDFJS_CACHE`** |

## Rutas y navegación
- `#/inicio` (por defecto tras el login), `#/notas[/n/NOTA]` (explorador raíz), `#/all|pinned|recent|trash[/n/NOTA]`, `#/folder/ID[/n/NOTA]`, `#/tag/ID[/n/NOTA]`, `#nota/ID`.
- Prerredactados: `#/snippets[/s/ID]` (raíz), `#/sfolder/ID[/s/ID]`, `#/sall|sfav|sused|srecent[/s/ID]` (Todos, Favoritos, Más usados, Recientes).
- `history.state`: `d` = nº de entradas por encima de Inicio (el botón 🏠 hace `history.go(-d)`); `lv` = nivel en el explorador (0 = Notas, 1 = carpeta principal…); `nt` = 1 si la entrada es una nota/prerredactado abierto.
- Al entrar en una carpeta, `goView()` apila también sus carpetas padre (`chainFor`), así «atrás» (Android) sube un nivel: nota → Cardio → Urgencias → Notas → Inicio. Tocar un tramo de la ruta retrocede con `backTo(nivel)`.
- Al arrancar, `initHistory()` deja `#/inicio` y la cadena de carpetas debajo de la ruta abierta.

## Explorador de carpetas (`renderExplorer(box, T)` en app.js)
- Un solo explorador para los dos árboles: `TREES.notes` y `TREES.snippets` describen colección de carpetas, elementos, tarjeta, búsqueda, orden, accesos y textos. `treeOf(tipoDeVista)` da el árbol; `isSnipView()`. Todas las funciones de carpeta (`folderMenu`, `newFolder`, `moveFolder`, `deleteFolder`, `shiftFolder`, `dropTarget`, `makeDraggable`, `folderItem`, `renderCrumbs`) reciben el árbol `T` (por defecto Notas). Al arrastrar no se mezclan los árboles.
- Prerredactados: orden único `drfolio.snipSort` = `manual|name|uses|recent` (selector «Ordenar»; las carpetas usan `order` en manual y nombre en el resto). Manual de prerredactados = campo `order` (Subir/Bajar en su menú).
- Inicio → «Notas» abre `#/notas`: accesos Todas/Fijadas/Recientes, botones ＋ Nota / ＋ Carpeta, carpetas principales (color, nº de notas con subcarpetas, nº de subcarpetas) y notas sin carpeta.
- En una carpeta: ruta `#crumbs` (Notas › A › B, tramos pulsables y zona donde soltar), subcarpetas y debajo sus notas directas.
- Menú de carpeta (`folderMenu`): ⋯, clic derecho o mantener pulsado (`bindContext`, 500 ms) → abrir, subcarpeta, nota, renombrar, color, mover, subir/bajar, eliminar.
- Arrastrar (solo `pointer: fine` o ≥640 px, `makeDraggable`/`dropTarget`): notas y carpetas a carpetas del explorador, de la barra lateral o de la ruta.
- Preferencias en `localStorage`: `drfolio.layout` (`list|grid`), `drfolio.folderSort` (`manual|name`; manual usa el campo `order`, subir/bajar lo renumera de 1000 en 1000).
- Buscador: en una carpeta busca en ella y sus subcarpetas; botón «Buscar en todas» (`S.searchAll`).

## Modelo de datos (Firestore, todo bajo `users/{uid}/`)
- `folders/{id}`: `name, parentId|null, color, order, createdAt, updatedAt` (anidación ilimitada)
- `tags/{id}`: `name, color, createdAt`
- `notes/{id}`: `title, html, text, folderId|null, tags[], pinned, trashed, trashedAt, refs[], createdAt, updatedAt`
  - `refs[]`: `{id, cite, url, fileId, fileName, fileSize}` → sección Bibliografía
  - Imágenes en el HTML: `<img data-file="ID">` (sin `src`; se resuelve al mostrar)
  - Enlaces entre notas: `<a data-note="ID" class="note-link" href="#nota/ID">`
  - Índice insertado: `<div class="note-toc" data-toc="1"></div>` (se guarda vacío; `refreshTocBlocks()` lo rellena con los H1–H3 al mostrar)
  - Secciones plegadas: `data-collapsed="1"` en el título (solo títulos de primer nivel del contenido); `.fold-hidden`/`.foldable` son clases de vista, no se guardan
- `files/{id}`: `noteId, name, mime, size, kind, chunks, createdAt` + subcolección `chunks/{000..}` `{d: base64}` (700 KB por trozo)
- `snippets/{id}`: `title, body (texto plano), folderId|null, favorite, order, category (antiguo, no se borra), uses, lastUsedAt, createdAt, updatedAt` (prerredactados)
- `snippetFolders/{id}`: misma forma que `folders` (`name, parentId|null, color, order, createdAt, updatedAt`), árbol propio de los prerredactados, separado del de notas
- **Migración categoría → carpeta** (`migrateCategories` en snippets.js, v1.6.0): cuando llegan `snippets` y `snippetFolders` **del servidor** (no de caché), cada prerredactado **sin el campo `folderId`** pasa a la carpeta de su `category` (raíz; `null` si no tenía). El ID de carpeta es fijo según el nombre (`catFolderId`: `cat-<slug>-<hash>`, sin tildes/mayúsculas), así varios dispositivos escriben la misma carpeta y no se duplica; al tener ya `folderId`, no se repite. `category` se conserva para poder volver atrás.
- Fechas en milisegundos (`Date.now()`), no `serverTimestamp`.

## Seguridad
- Solo el UID `KCrZacB1H1ZdrxeBbiPuzd7Cp0N2` puede leer/escribir (`firestore.rules` y `OWNER_UID` en config.js).
- Modo "Ordenador público": sesión solo en la pestaña, sin caché offline, cierre por inactividad.
- CSP en `index.html`: incluye `worker-src 'self' blob:` y `font-src 'self' data:` para PDF.js (se carga con `isEvalSupported: false`).
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
