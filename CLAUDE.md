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
| `public/js/bodies.js` | Contenido de las notas (v1.10.0): `bodyOf`, `loadBody`, `syncBodies`, `writeNote` (nota ligera + contenido en un lote), `deleteNoteDocs`, `fullNote` (nota completa para copias), copia local en IndexedDB `drfolio-bodies` (solo confianza; se borra al cerrar sesión) |
| `public/js/migrate.js` | Migración de notas antiguas a dos documentos (`migrateNotes`): transacciones por grupos, idempotente, varios dispositivos |
| `public/js/icons.js` | Iconos SVG propios: `icon(nombre)`, `iconOr(x)`; sprite inyectado al arrancar. En HTML: `<svg class="i"><use href="#i-NOMBRE"/></svg>`. Color = currentColor |
| `public/vendor/icons.js` | Dibujos de Lucide (ISC), solo los usados. Generado por `tools/build-icons.mjs` (`npm run vendor:icons`): para añadir un icono, añade su nombre a `USED` |
| `public/js/modules.js` | Módulos (`id, name, short, icon (nombre de icono SVG), desc, route, status: 'active'\|'soon', count, tab`) + accesos fijos `NAV_HOME`/`NAV_SEARCH`. De aquí salen Inicio, la franja (todos) y la barra inferior (`tab: true`). Añadir un módulo = una línea aquí |
| `public/js/viewport.js` | Teclado del móvil: `body.kb-open` (iOS: visualViewport; Android: alto menor que antes de escribir) → oculta la barra inferior y **solo entonces** la app usa `--app-h`/`--app-top` (alto visible real). Títulos de varias líneas: `initTitles`/`fitTitle` (textarea que crece; sin saltos de línea) |
| `public/js/editor.js` | Editor `contenteditable`: barra de formato, pegado limpio (DOMPurify), tablas, listas de tareas, enlaces entre notas, índice, botones «📋 Copiar sección» en lectura (`allText()`). `createEditor({els})` admite varias instancias (notas y prerredactados), `markFields` (resalta `{campo}` en lectura, `span.fld` solo de vista) y `tabs` (Tab = tabulación, párrafo `class="keep-ws"`) |
| `public/js/util.js` | Ayudas: `el`, `$`, `debounce`, `norm`, fechas, `htmlToText` (búsqueda) y `nodesToPlain` (texto para pegar en informes: tablas con tabuladores, listas «- »/«1. ») |
| `public/js/snippets.js` | Prerredactados: tarjetas, favoritos, orden, mover, editor enriquecido con lectura/edición, campos `{campo}` / `{campo:a\|b}`, copiar sin formato / con formato (`copyRich`) / por secciones, selector para insertar en notas (con formato) y migración categoría → carpeta |
| `public/js/snipbody.js` | Contenido de los prerredactados (v1.12.0): `FIELD_RE`, `textToHtml`, `bodyHash`, `htmlFresh`, `htmlOf`, `snippetFileIds` |
| `public/js/store.js` | Datos en memoria sincronizados con Firestore (`onSnapshot`) + ayudas de carpetas (`childFolders`, `folderPath`, `descendantIds`, `flatFolders`: último parámetro = mapa del árbol, por defecto `store.folders`) |
| `public/js/files.js` | Imágenes/PDF guardados **en Firestore en trozos base64** (no hay Storage en Spark). Exporta `blobToBase64`/`base64ToBytes` (las usa backup.js) |
| `public/js/backup.js` | Copia de seguridad: JSON versionado (con/sin archivos), .zip legible, restaurar (Fusionar / Reemplazar), límite diario, recordatorio en Inicio |
| `public/js/db.js` | Inicialización Firebase, login, modo dispositivo, logout |
| `public/js/ui.js` | Modales, menús, selectores, toasts propios (no usar alert/prompt: fallan en PWA iOS). `modal({cls})` añade clase al modal y `has-CLS` al fondo |
| `public/js/pdfviewer.js` | Visor de PDF propio (PDF.js): pantalla completa en móvil, modal grande en tablet/PC, cada página ajustada al ancho, dibujo solo de las páginas visibles (libera las lejanas), zoom (botones, pellizco, Ctrl+rueda), «Pág. X de Y», ir a página, buscar texto (sin tildes/mayúsculas) con resaltado, reajuste al girar |
| `public/vendor/libs.js` | Firebase + DOMPurify empaquetados. Regenerar: `cd tools && npm install && npm run vendor` (regenera libs.js, jszip.js, pdfjs/ e icons.js). Exporta también `connect*Emulator` (solo para pruebas locales) |
| `public/vendor/jszip.js` | JSZip (ESM) para el .zip legible. Se carga con `import()` solo al exportar (no va en libs.js). Sale de `tools/jszip-entry.js` (`npm run vendor:jszip`, incluido en `npm run vendor`) |
| `public/vendor/pdfjs/` | PDF.js (pdfjs-dist, build **legacy** para Safari iOS) + worker, fuentes, wasm, cmaps. Lo copia `tools/copy-pdfjs.mjs` (incluido en `npm run vendor`) y genera `files.json` |
| `public/sw.js` | Service worker (app offline, red primero). PDF.js va en una caché aparte `PDFJS_CACHE` (caché primero): **si se actualiza pdfjs-dist, cambiar `PDFJS_CACHE`** |

## Navegación (v1.7.0)
- **Secciones**: `sectionOf(tipo)` = `home | search | notes | snippets` (= id del módulo/árbol). `#app[data-section]`, `#app[data-side]` (1 si la sección tiene barra lateral).
- **Móvil** (<640 o horizontal ≤520 px alto): `#tabbar` = Inicio · módulos con `tab` · ＋ Crear (en medio) · Buscar. Sin ☰. Notas raíz muestra además Papelera y Etiquetas (`.fx-extra`, solo móvil). Ajustes y Cerrar sesión, en la cabecera de Inicio.
- **Iconos**: SVG de Lucide (`icons.js`), nunca emojis en la navegación, menús (`menu()` acepta nombre de icono en `icon`) ni barras. Notas = `notebook-text`, Prerredactados = `clipboard-list`, Vademécum = `pill`, Chat personal = `message-circle`.
- **Listas largas**: `lazyBlock()` pinta 60 tarjetas y el resto al acercarse al final o con «Mostrar más» (recuerda cuántas por vista); `.note-card` con `content-visibility: auto`.
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
- Las notas se exportan y restauran **completas** (`fullNote`: ligera + html/text/refs, sin campos calculados), así el formato del JSON no cambia con v1.10.0. Antes de exportar o restaurar se descargan los cuerpos que falten (`ensureAllBodies`; si falla, no se hace la copia). Restaurar escribe cada nota como `notes` + `noteBodies` (2 operaciones).
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
- v1.10.0 se probó con el **emulador de Firebase** (`firebase-tools`, firestore + auth, proyecto `drfolio-6af54`, usuario creado con el UID del propietario) y Playwright: se redirige `db.js` a `connectAuthEmulator`/`connectFirestoreEmulator`, se añade `http://127.0.0.1:*` al CSP y se bloquea cualquier petición a Google. Chromium necesita `--disable-features=LocalNetworkAccessChecks`.

## Ajuste a la pantalla del móvil (v1.11.0)
- `#app`, `.screen` y los modales a pantalla completa usan `position: fixed; inset: 0` (no el alto de JS): en iOS instalada (standalone) `visualViewport.height` puede venir sin la barra de estado y dejaba un hueco abajo. Con `body.kb-open` pasan a `top: var(--app-top); height: var(--app-h)`.
- **iPhone instalado (v1.11.9, confirmado en el iPhone de Adrián)**: iOS da a la app instalada una ventana más baja que la pantalla (`innerHeight` = pantalla − barra de estado). Arreglo: (1) `initViewport()` quita en iOS `interactive-widget=resizes-content` de la meta viewport (es de Chrome Android); (2) `fullHeight()` (viewport.js): si `navigator.standalone`, la ventana ocupa todo el ancho de la pantalla y le falta alto (2–120 px) → `html.short-h` + `--h-gap`: `--safe-bottom` se reduce en ese hueco, barra inferior con 16 px abajo y fondo de `html` del color de la barra. Descartado: alargar html/body/app al alto de `screen` o 100vh (la barra se salía por abajo) y barra de estado `black` (iOS no la aplicó).
- **v1.14.1**: con la barra de formato abajo, al cerrar el teclado iOS a veces no avisaba y se perdía el ajuste (franja suelta bajo la barra inferior). Ahora: se vuelve a medir a los 0,3/0,8/1,6 s de `focusout`, al volver a la app (`visibilitychange`, `pageshow`), sin teclado se devuelve la página a `scrollTo(0,0)`, y en la app instalada (`html.ios-app`) el fondo de `html` es siempre el de la barra inferior.
- **v1.15.1, alto de la pantalla (corrige v1.15.0)**: tras usar el teclado, iOS puede encoger la **ventana** de la app por abajo; lo de debajo queda fuera de la web y iOS lo pinta con el fondo de `html`/`body`. Alargar la app (`tall-fix` de v1.15.0) la **recortaba** (barra inferior cortada, captura de Adrián): **descartado**. Ahora la barra va siempre entera al final de la ventana (`short-h`) y en la app instalada `html` y `body` tienen el color de la barra (`html.ios-app`), así la franja de debajo se ve como parte de la barra. `kickLayout()` al cerrar el teclado solo hace `scrollTo(0,0)` y vuelve a medir.
- `html { -webkit-text-size-adjust: 100% }`: iOS ya no agranda el texto al girar a horizontal (era lo que cortaba letras).
- Zonas seguras: variables `--safe-*` (env()). Modales con `padding: max(16px, --safe-*)`. En horizontal, `#app` deja el notch a izquierda/derecha con padding.
- Textos: sin alturas fijas; tarjetas crecen o recortan con «…» (`line-clamp`); `.mod-name` con guiones (`hyphens: auto`). Títulos de nota/prerredactado (`#ed-title`, `#snip-title`) son `<textarea rows=1>` que crecen (`field-sizing: content` o `fitTitle`).
- Horizontal móvil (≤520 px alto): lista `--list-w: clamp(290px, 42vw, 400px)`, accesos del explorador icono arriba + nombre en 2 líneas, «Últimas notas» y resultados de Buscar (`.home-notes`) en rejilla de 2 columnas si caben.
- Probado con Playwright (Firebase simulado en memoria que sustituye `vendor/libs.js`, zonas seguras simuladas sobrescribiendo `--safe-*`) en 375×667, 390×844, 430×932, 667×375, 844×390 y 932×430, y con la letra al 130 %.

## Prerredactados con formato (v1.12.0)
- **Mismo editor que las notas**: `app.js` crea `snipEditor = createEditor({els: …})` con `#snip-content`, una copia de `#toolbar` (`#snip-toolbar`), `#snip-table-tools`, `#snip-bubble`, `#snip-file-image`. Nada de código duplicado.
- **Lectura / edición** como las notas: se abren según `drfolio.noteMode`, los nuevos en edición; `#snip-edit` ✏️ Editar ↔ ✓ Listo, A−/A+ (`--read-size` en `#editor`, compartido), Wake Lock. Campos `{…}` resaltados en lectura.
- **Datos** (en el mismo documento `snippets/{id}`, sin documento aparte: son pequeños y copiar desde la lista en iOS tiene que ser instantáneo, dentro del toque): `html` (formato), `body` (texto plano = `nodesToPlain`, para buscar, vista previa, contar campos y copiar), `bh` = `bodyHash(body)`. Si `bh` no coincide (sin migrar o editado con una versión antigua que solo escribe `body`), `htmlOf()` usa `textToHtml(body)`.
- **Copiar**: «Copiar» (cabecera y tarjeta) = `body` con los campos rellenos (tablas con tabuladores, listas «- »). «📋» en cada título en lectura = esa sección. ⋯ → «Copiar con formato (Word, correo)»: `ClipboardItem` text/html + text/plain (imágenes incrustadas como data:, bordes en tablas; sin índice). Insertar en una nota: con su formato (`pickSnippetText` → `{html, text}`; sin índice ni plegado).
- **Imágenes**: `files/` con `snippetId`. `allReferencedFiles` cuenta notas y prerredactados; `filesKnown` exige `store.loaded.snippets`. Eliminar un prerredactado borra sus imágenes si nadie más las usa (`purgeSnippetFiles`); «Limpiar» y vaciar papelera respetan las de los prerredactados.
- **Migración** (`migrateSnippets` en migrate.js, en silencio): con datos del servidor, grupos ≤ 100 en transacciones; escribe solo `html` + `bh` (no toca `body`, así copiar da lo mismo que antes). Idempotente, varios dispositivos, respeta el límite diario.
- **Índice opcional (v1.12.1)**, en notas y prerredactados: ⋯ → «Añadir índice / Quitar índice» (`editor.toggleTocBlock()`, también en lectura; guarda al momento) o botón ☰ de la barra. Compacto (14 px fijos, no crece con A+), plegable tocando «Índice · N» (`.toc-closed`, solo vista, `drfolio.tocClosed`). El índice automático de arriba en notas (`#toc`) es opcional: Ajustes → «Índice automático» (`drfolio.autoToc` = `on|off`, por defecto no). En lectura los títulos son más contenidos (h1 1.3em, h2 1.15em, h3 1.04em). `menu()` ignora elementos `null`. **v1.12.2**: el índice va siempre a primer nivel (`fixTocPlacement` en `refreshTocBlocks`: si quedó dentro de un título —pasaba en iPhone con ☰ y el cursor en un título— se saca delante; repara lo ya guardado). Texto de los títulos con `hText()` (sin índice ni botones; antes el índice se copiaba a sí mismo y crecía). ☰ con el cursor en un título inserta el índice encima. Numeración del índice: ver «Barra de formato única».
- **Copia de seguridad**: el JSON lleva `html`/`bh` (se sanea al restaurar); el .zip exporta cada prerredactado como `.html` (con imágenes) y `.txt`.
- Probado con Firebase simulado + Playwright en 390×844 y 1366×860: migración, lectura, edición, índice, copiar (pegado en textarea y en editor con formato), copiar sección, insertar en nota, buscador, borrado de imágenes, compatibilidad con versión antigua, .zip.

## Barra de formato única, estilo Evernote (v1.13.0 → v1.14.0)
- `toolbarHtml({fields})` en editor.js genera la barra; `createEditor` la pinta si el contenedor está vacío (`#toolbar` y `#snip-toolbar` vacíos en el HTML). **La misma para notas y prerredactados**; los prerredactados añaden «Campo a rellenar» dentro de ＋ (`fields: true`).
- Orden (como Evernote): **＋ Insertar** (menú: imagen, tabla, enlace web, enlace a nota, índice, prerredactado, [campo], fecha, fecha y hora, separador) · tareas | viñetas, numerada, sangría −/+, **estilo** (menú: Texto, Título 1-3, Cita, Bloque de código) , alinear (menú) | B I U S, código en línea, cita | color, resaltar, tamaño (menú: 0.85/1/1.2/1.45em, `setFontSize`; `cleanStyle` solo admite esos `font-size`) | ⋯ (subíndice, superíndice, quitar formato, deshacer, rehacer) · ocultar teclado (solo móvil con teclado, `.tb-hidekb`).
- **v1.15.0, organización**: fila principal = ＋ · Estilo | B I U Resaltar | Viñetas Tareas | **Más** (`.tb-more`). Lo demás lleva `.tb-x` y va en grupos separados por `.tb-br`: Texto (tachado, código, color, tamaño) · Párrafo (numerada, sangría −/+, alinear, cita) · Otros (subíndice, superíndice, quitar formato). Ordenador: todo a la vista y sin «Más». Móvil: rejilla de 9 columnas (10 con el teclado y «ocultar teclado»), sin deslizar; «Más» despliega las filas (`.toolbar.expanded`, se recuerda en `drfolio.tbMore`). Editando en el móvil, los avisos salen arriba.
- Las acciones están en `runAct(act, b)` (sirven desde la barra y desde los menús, `barMenu`). Para añadir algo: una entrada en `toolbarHtml` o en el menú ＋ y su `act` en `runAct`.
- **Deshacer / rehacer en la cabecera** al editar (`#btn-undo`/`#btn-redo`, `#snip-undo`/`#snip-redo`, `.only-editing`; `editor.undo()/redo()`).
- **Móvil**: la barra va abajo, en una píldora encima del teclado (`order: 10`); al editar se oculta la barra inferior de la app (`#app.editing`, lo pone `updateWakeLock`) y el texto «Guardado»; en prerredactados en edición «Copiar» queda solo con el icono. `menu()` usa `visualViewport` para no abrirse debajo del teclado en iOS.
- Ordenador (≥900 px y ratón): la barra arriba, entera. Móvil: se desliza, con difuminado en los bordes (`.more-left`/`.more-right`).
- Tab escribe tabulación también en las notas (`tabs: true` en los dos editores).
- **Índice** (v1.14.0): numerado como Evernote: 1., 2. y subniveles a., b. (i., ii.), enlaces subrayados; si el título ya empieza por número o letra, no se repite.

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
- **Notas en dos documentos (v1.10.0, `bodies.js`)**:
  - `notes/{id}` (ligera, se sincroniza siempre): `title, folderId|null, tags[], pinned, trashed, trashedAt, createdAt, updatedAt, preview (≈200 car.), words, refsCount, links[] (notas enlazadas → «Enlazada desde»), files[] (imágenes y adjuntos → borrar/limpiar archivos), size`
  - `noteBodies/{id}`: `html, text, refs[], updatedAt`. Se descarga al abrir la nota (1 lectura). En confianza, además en segundo plano solo lo que falte o haya cambiado (queda en IndexedDB → búsqueda en todo sin conexión, 0 lecturas en los siguientes arranques). En «Ordenador público», botón «Buscar también en el contenido».
  - Regla: al cambiar el contenido, `notes.updatedAt` = `noteBodies.updatedAt` en el **mismo lote** (`writeNote`). El cuerpo en memoria lleva `v` = updatedAt de la nota con el que se comprobó: si la nota ligera trae uno mayor, el cuerpo está desactualizado y se vuelve a descargar.
  - Mientras el contenido no ha cargado (`S.bodyReady = false`) la nota no se edita ni se guarda (nunca se sobrescribe con un contenido vacío).
  - Notas antiguas (html/text/refs aún dentro de `notes/{id}`): `isLegacy()`; todo el código las lee igual con `bodyOf()`. Al guardarlas se migran solas.
  - **Migración** (`migrate.js`): solo en confianza, con conexión y datos del servidor. Si hay > 10 notas antiguas y nunca se migró en ese dispositivo, pregunta (recomienda hacer copia antes: «Hacer copia primero»); si no, en silencio. Grupos ≤ 40 notas / 2,5 MB en transacciones (relee nota y cuerpo; otro dispositivo a la vez → reintento). Si el cuerpo ya existía y es distinto: se queda el más reciente y el otro pasa a una nota «… (otra versión)». Respeta el límite diario (`budget`/`addQuota` de backup.js). `drfolio.migrated` = ya migrado en este dispositivo.
  - `refs[]`: `{id, cite, url, fileId, fileName, fileSize}` → sección Bibliografía
  - Imágenes en el HTML: `<img data-file="ID">` (sin `src`; se resuelve al mostrar)
  - Enlaces entre notas: `<a data-note="ID" class="note-link" href="#nota/ID">`
  - Índice insertado: `<div class="note-toc" data-toc="1"></div>` (se guarda vacío; `refreshTocBlocks()` lo rellena con los H1–H3 al mostrar)
  - Secciones plegadas: `data-collapsed="1"` en el título (solo títulos de primer nivel del contenido); `.fold-hidden`/`.foldable` son clases de vista, no se guardan
- `files/{id}`: `noteId, snippetId?, name, mime, size, kind, chunks, createdAt` + subcolección `chunks/{000..}` `{d: base64}` (700 KB por trozo)
- `snippets/{id}`: `title, html (formato, v1.12.0), body (texto plano), bh (huella de body), folderId|null, favorite, order, category (antiguo, no se borra), uses, lastUsedAt, createdAt, updatedAt` (prerredactados)
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
2. ✅ Prerredactados (plantillas para copiar, con campos rellenables y texto enriquecido)
3. Vademécum personal
4. Chat personal (enviarse textos y documentos)

## Probar
No hay tests automáticos en el repo. Antes de publicar, al menos `node --check` en cada `public/js/*.js`.
Límites del plan gratuito: 1 GB, 50.000 lecturas y 20.000 escrituras al día.
