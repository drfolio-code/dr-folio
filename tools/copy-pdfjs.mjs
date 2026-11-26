// Copia el visor PDF.js (build "legacy", compatible con Safari iOS) a public/vendor/pdfjs/.
// Regenerar con:  cd tools && npm install && npm run vendor
// Si cambias la versión de pdfjs-dist, cambia también PDFJS_CACHE en public/sw.js.
import { cpSync, rmSync, mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
const src = 'node_modules/pdfjs-dist';
const dst = '../public/vendor/pdfjs';
const skip = (name) => /quickjs/i.test(name); // JavaScript dentro de los PDF: no se usa
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) cpSync(`${src}/legacy/build/${f}`, `${dst}/${f}`);
for (const d of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) {
  cpSync(`${src}/${d}`, `${dst}/${d}`, { recursive: true, filter: (p) => !skip(p) });
}
cpSync(`${src}/LICENSE`, `${dst}/LICENSE`);
// Lista para que el service worker lo guarde y funcione sin conexión (cmaps solo se usan en PDF asiáticos: se guardan al usarlos)
const list = (d) => readdirSync(`${dst}/${d}`).filter((f) => !f.startsWith('LICENSE')).map((f) => `${d}/${f}`);
const { version } = JSON.parse(readFileSync(`${src}/package.json`, 'utf8'));
const files = ['pdf.min.mjs', 'pdf.worker.min.mjs', ...list('standard_fonts'), ...list('wasm'), ...list('iccs')];
writeFileSync(`${dst}/files.json`, JSON.stringify({ version, files }, null, 1) + '\n');
console.log(`PDF.js ${version} copiado en ${dst} (${files.length} archivos para uso sin conexión)`);
