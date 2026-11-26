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
| `public/styles.css` | Estilos (modo claro/oscuro, responsive: ≥1100 px franja + barra lateral plegable + lista + nota · 640–1099 franja + lista + nota, barra lateral encima · móvil (<640, u horizontal ≤520 px de alto) barra inferior, sin franja ni barra lateral: una columna en vertical, lista+nota en horizontal) |
| `public/js/app.js` | Lógica principal: navegación (franja, barra inferior, ＋ Crear), barra lateral por sección, Inicio, Buscar, explorador de carpetas, vistas, etiquetas, notas, bibliografía, ajustes |
| `public/js/modules.js` | Módulos (`id, name, short, icon, desc, route, status: 'active'\|'soon', count, tab`) + accesos fijos `NAV_HOME`/`NAV_SEARCH`. De aquí salen Inicio, la franja (todos) y la barra inferior (`tab: true`). Añadir un módulo = una línea aquí |
| `public/js/viewport.js` | Alto real visible (`--app-h`/`--app-top` con visualViewport) para que el teclado del móvil no tape el editor. `body.kb-open` = teclado abierto (iOS: visualViewport; Android: alto menor que antes de escribir) → oculta la barra inferior |
| `public/js/editor.js` | Editor `contenteditable`: barra de formato, pegado limpio (DOMPurify), tablas, listas de tareas, enlaces entre notas, índice, botones «📋 Copiar sección» en lectura (`allText()`) |
| `public/js/util.js` | Ayudas: `el`, `$`, `debounce`, `norm`, fechas, `htmlToText` (búsqueda) y `nodesToPlain` (texto para pegar en informes: tablas con tabuladores, listas «- »/«1. ») |
| `public/js/snippets.js` | Prerredactados: tarjetas, favoritos, orden, mover, editor de texto plano, campos `{campo}` / `{campo:a\|b}`, copiar, selector para insertar en notas (carpetas, favoritos, más usados, buscar) y migración categoría → carpeta |
| `public/js/store.js` | Datos en memoria sincronizados con Firestore (`onSnapshot`) + ayudas de carpetas (`childFolders`, `folderPath`, `descendantIds`, `flatFolders`: último parámetro = mapa del árbol, por defecto `store.folders`) |
| `public/js/files.js` | Imágenes/PDF guardados **en Firestore en trozos base64** (no hay Storage en Spark). Exporta `blobToBase64`/`base64ToBytes` (las usa backup.js) |
| `public/js/backup.js` | Copia de seguridad: JSON versionado (con/sin archivos), .zip legible, restaurar (Fusionar / Reemplazar), límite diario, recordatorio en Inicio |
| `public/js/db.js` | Inicialización Firebase, login, modo dispositivo, logout |
| `public/js/ui.js` | Modales, menús, selectores, toasts propios (no usar alert/prompt: fallan en PWA iOS). `modal({cls})` añade clase al modal y `has-CLS` al fondo |
| `public/js/pdfviewer.js` | Visor de PDF propio (PDF.js): pantalla completa en móvil, modal grande en tablet/PC, cada página ajustada al ancho, dibujo solo de las páginas visibles (libera las lejanas), zoom (botones, pellizco, Ctrl+rueda), «Pág. X de Y», ir a página, buscar texto (sin tildes/mayúsculas) con resaltado, reajuste al girar |
| `public/vendor/libs.js` | Firebase + DOMPurify empaquetados. Regenerar: `cd tools && npm install && npm run vendor` (regenera libs.js, jszip.js y pdfjs/) |
| `public/vendor/jszip.js` | JSZip (ESM) para el .zip legible. Se carga con `import()` solo al exportar (no va en libs.js). Sale de `tools/jszip-entry.js` (`npm run vendor:jszip`, incluido en `npm run vendor`) |
| `public/vendor/pdfjs/` | PDF.js (pdfjs-dist, build **legacy** para Safari iOS) + worker, fuentes, wasm, cmaps. Lo copia `tools/copy-pdfjs.mjs` (incluido en `npm run vendor`) y genera `files.json` |
| `public/sw.js` | Service worker (app offline, red primero). PDF.js va en una caché aparte `PDFJS_CACHE` (caché primero): **si se actualiza pdfjs-dist, cambiar `PDFJS_CACHE`** |

## Navegación (v1.7.0)
- **Secciones**: `sectionOf(tipo)` = `home | search | notes | snippets` (= id del módulo/árbol). `#app[data-section]`, `#app[data-side]` (1 si la sección tiene barra lateral).
- **Móvil** (<640 o horizontal ≤520 px alto): `#tabbar` = Inicio · módulos con `tab` · ＋ Crear (en medio) · Buscar. Sin ☰. Notas raíz muestra además Papelera y Etiquetas (`.fx-extra`, solo móvil). Ajustes y Cerrar sesión, en la cabecera de Inicio.
- **Tablet/PC**: `#rail` = ＋, Inicio, Buscar, todos los módulos («Próximamente» en gris), Panel, Ajustes, Salir, estado de sincronización.
- **Barra lateral** (`renderSidebar`, según sección): Notas = Todas/Fijadas/Recientes/Papelera + carpetas + etiquetas; Prerredactados = Todos/Favoritos/Más usados/Recientes + carpetas. Inicio y Buscar sin barra. ≥1100 px se pliega con «Panel»/« y se recuerda (`drfolio.side` = `open|closed`); en tablet se abre encima (`#app.drawer`) y se cierra al elegir.
- Tocar la sección activa vuelve a su raíz (`navTo`). **＋ Crear** (`createMenu`): Nota / Prerredactado / Carpeta, en la carpeta abierta.
- **Buscar** `#/buscar` (`openFind`, `renderFind`): sección de primer nivel (atrás → Inicio). Fuentes en `SEARCH_SOURCES` (`id, name, icon, all, loaded, run(words), card`): para el Vademécum, añadir una entrada. Filtros Todo/por tipo (`S.findFilter`). Desde aquí, notas y prerredactados se abren encima y «atrás» vuelve a Buscar (`snippetCard({onOpen})`).
- **Ordenador público**: `#pubbar` arriba siempre, con «Cerrar sesión» (`#app.public`).

## Modo lectura (v1.8.0)
- Las notas se abren en **lectura** (`S.reading`): sin barra de formato ni cursor, letra `--read-size` (A−/A+). Botón `#btn-edit` «✏️ Editar» ↔ «✓ Listo» (al volver a lectura guarda con `saveSoon.flush()`). Las notas nuevas (`focusTitle`) se abren en edición.
- Reutiliza el solo-lectura de la papelera: `#editor-wrap.readonly` (+ `.reading` si no está en la papelera) y `editor.setReadOnly()`. En lectura funcionan índice, plegar (no se guarda), enlaces, imágenes (se abren directamente), PDF y bibliografía.
- `.sec-copy`: botón sin texto (icono por CSS, para no ensuciar el índice) que se añade a cada H1–H3 de primer nivel al pasar a lectura y se quita en edición; `getContent()`/`getText()` también lo eliminan. Copia la sección **sin el título** (hasta el siguiente título de igual o mayor nivel), incluido lo plegado. ⋯ → «Copiar nota entera». Aviso «Copiado ✓» (`copyOut`, usa `copyText` de snippets.js).
- Pantalla encendida (Wake Lock, `updateWakeLock`): solo en lectura con la nota visible; se vuelve a pedir al volver a la pestaña.
- Preferencias por dispositivo (`localStorage`): `drfolio.noteMode` = `read|edit`, `drfolio.readSize` = px (15–30, por defecto 18), `drfolio.wakeLock` = `on|off` (Ajustes).

## Copia de seguridad (v1.9.0, `backup.js`)
- Ajustes → «Exportar / Restaurar…» (`openBackup`). En «Ordenador público» no está disponible y se explica el motivo (`backupPublicReason`).
- **JSON** (`buildBackup`): `{ format: 'drfolio-backup', formatVersion: 1, appVersion, exportedAt, exportedAtMs, withFiles, counts, data: {folders, tags, files, notes, snippetFolders, snippets}, fileData: {fileId: base64} }`. Se construye por partes (Blob) para no crear una cadena gigante. Si cambia el formato: subir `BACKUP_VERSION` y seguir leyendo los anteriores en `parseBackup` (ya lee las copias antiguas ≤ v1.8.0: colecciones en la raíz, `fileData` como dataURL).
- Guardar (`deliverButtons`): «📤 Guardar en Archivos / Drive…» (`navigator.share` con archivo, si `canShare`) o «⬇ Descargar». Android Chrome no comparte .json/.zip → solo descarga.
- **.zip legible** (`exportZip`): `Dr.Folio AAAA-MM-DD/index.html`, `Notas/<carpeta>/<sub>/<nota>.html` + `<nota> (archivos)/` con sus imágenes y PDF, `Papelera/`, `Prerredactados/<carpeta>/<título>.txt`, `LEEME.txt`. Enlaces entre notas, índice e imágenes con rutas relativas. Imágenes/PDF sin comprimir (STORE).
- **Restaurar** (`startRestore` → `parseBackup` valida y sanea el HTML con `sanitize()` → resumen → `planRestore(parsed, 'merge'|'replace')` → `runPlan`):
  - Fusionar: añade lo que falta; si existe en los dos, gana el `updatedAt` (o `createdAt`) mayor. Nunca borra.
  - Reemplazar: escribe lo distinto y borra lo que no está en la copia. Pide escribir BORRAR y antes descarga automáticamente una copia completa del estado actual. Primero escribe y después borra.
  - Los archivos no se reescriben si ya existen; en la copia «sin archivos» no se pueden recrear (se avisa). Trozos primero, metadatos al final.
  - Lotes ≤ 450 operaciones y ≤ 8 MB. Requiere conexión y datos sincronizados (no de caché).
  - Límite diario: cuenta en `drfolio.quota` (`{day, w, d}`, día de California = reinicio de Firestore) las escrituras/borrados de las restauraciones; para a 20.000 − 1.500 de margen. Lo pendiente se guarda en `drfolio.restoreJob` y se continúa eligiendo el mismo archivo (el plan se recalcula y salta lo ya escrito).
- Recordatorio (`backupReminder`, en `#home-backup`): si no hay copia o han pasado > 7 días desde `drfolio.lastBackup` (ms, por dispositivo), o si hay una restauración a medias.
- Probado con Firebase simulado (sustituye `vendor/libs.js` por un Firestore en memoria) con Playwright: no hay tests en el repo.

## Rutas y navegación
- `#/inicio` (por defecto tras el login), `#/buscar`, `#/notas[/n/NOTA]` (explorador raíz), `#/all|pinned|recent|trash[/n/NOTA]`, `#/folder/ID[/n/NOTA]`, `#/tag/ID[/n/NOTA]`, `#nota/ID`.
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
1. ✅ Notas: carpetas/subcarpetas, etiquetas, editor enriquecido, imágenes, bibliografía con PDF, índice, enlaces entre notas, offline, modo lectura con copiar sección, copia de seguridad y restauración
2. ✅ Prerredactados (plantillas de texto para copiar, con campos rellenables)
3. Vademécum personal
4. Chat conmigo mismo (enviarse textos y documentos)

## Probar
No hay tests automáticos en el repo. Antes de publicar, al menos `node --check` en cada `public/js/*.js`.
Límites del plan gratuito: 1 GB, 50.000 lecturas y 20.000 escrituras al día.
