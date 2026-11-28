// Descarga la Guía de dosificación pediátrica de Aragón: texto de cada ficha (con los desplegables abiertos)
// y las imágenes de contenido (tablas por peso). Uso: node scrape.js  → out/<slug>.json + out/img/<slug>-N.<ext>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = 'https://sites.google.com/view/guia-pediatrica-aragon';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
// g.html = la portada descargada: curl -o g.html https://sites.google.com/view/guia-pediatrica-aragon
const html = fs.readFileSync(path.join(__dirname, 'g.html'), 'utf8');
const links = [...new Set([...html.matchAll(/href="\/view\/guia-pediatrica-aragon([^"#]*)"/g)].map((m) => m[1]))]
  .filter((l) => /^\/\d+-/.test(l) && l.split('/').length >= 3);
const slug = (l) => l.split('/').filter(Boolean).slice(-1)[0];

async function one(ctx, l) {
  const file = path.join(OUT, `${slug(l)}.json`);
  if (fs.existsSync(file)) return;
  const p = await ctx.newPage();
  try {
    await p.goto(BASE + encodeURI(l).replace(/%25/g, '%'), { waitUntil: 'networkidle', timeout: 90000 });
    // abrir los desplegables del contenido (Recomendaciones, Presentaciones…)
    const heads = await p.locator('h2 .CjVfdc, h3 .CjVfdc').all();
    for (const h of heads) { try { await h.click({ timeout: 1500 }); } catch { /* nada */ } }
    await p.waitForTimeout(700);
    const data = await p.evaluate(() => {
      const t = document.body.innerText;
      const a = t.indexOf('\n', t.indexOf('More\n')) ;
      const z = t.indexOf('ISBN 978');
      const imgs = [...document.querySelectorAll('img')].filter((i) => i.naturalWidth > 250 && i.naturalHeight > 120 && !i.closest('header'))
        .map((i) => ({ src: i.src, w: i.naturalWidth, h: i.naturalHeight, top: i.getBoundingClientRect().top + scrollY }));
      return { text: t.slice(a > 0 ? a : 0, z > 0 ? z : undefined).trim(), imgs };
    });
    const images = [];
    for (const [k, im] of data.imgs.entries()) {
      const r = await p.evaluate(async (src) => {
        const res = await fetch(src);
        const buf = new Uint8Array(await res.arrayBuffer());
        let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return { ct: res.headers.get('content-type') || 'image/png', b64: btoa(s) };
      }, im.src);
      const ct = r.ct;
      const ext = ct.includes('jpeg') ? 'jpg' : ct.includes('webp') ? 'webp' : 'png';
      const name = `${slug(l)}-${k + 1}.${ext}`;
      fs.writeFileSync(path.join(OUT, 'img', name), Buffer.from(r.b64, 'base64'));
      images.push({ file: name, w: im.w, h: im.h, top: Math.round(im.top) });
    }
    await p.screenshot({ path: path.join(OUT, 'img', `${slug(l)}-page.png`), fullPage: true });
    fs.writeFileSync(file, JSON.stringify({ path: l, url: BASE + l, text: data.text, images }, null, 1));
    console.log('ok', l, images.length);
  } catch (e) { console.log('ERROR', l, e.message.split('\n')[0]); } finally { await p.close(); }
}
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const q = [...links];
  await Promise.all([1, 2, 3].map(async () => { while (q.length) await one(ctx, q.shift()); }));
  await b.close();
  console.log('FIN', links.length);
})();
