// Auditoría de la calculadora: pasa calcOf() por todas las pautas de la plantilla adulta y de la Guía de Aragón
// (tools/guia_aragon/guia-pediatrica-aragon.json, si está: no se sube al repositorio).
// Uso: node tools/tests/audit-calc.mjs [informe.md] [ruta/a/drugped.js]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [outFile, libArg] = process.argv.slice(2);
const lib = await import(pathToFileURL(path.resolve(libArg || path.join(ROOT, 'public/js/drugped.js'))).href);
const { calcOf } = lib;
const calcListOf = lib.calcListOf || ((r) => { const c = calcOf(r); return c ? [{ c }] : []; });
const noCalc = lib.noCalcReason || (() => '');

const sources = [];
const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/plantillas/vademecum-ap-urgencias-montana.json'), 'utf8'));
sources.push(['Plantilla adulta', tpl.drugs]);
const g = path.join(ROOT, 'tools/guia_aragon/guia-pediatrica-aragon.json');
if (fs.existsSync(g)) sources.push(['Guía de Aragón', JSON.parse(fs.readFileSync(g, 'utf8')).drugs]);

// Mismos nombres de campo que guarda la importación (drugbody.js → parseDrugImport)
const asReg = (r) => ({ indication: r.indication || '', text: r.text || '', pres: r.presentation || r.pres || '', route: r.route || '',
  dose: r.dose || '', freq: r.frequency || r.freq || '', duration: r.duration || '', max: r.max || '', type: r.type || '', calc: r.calc, perKg: r.perKg });
const perKg = /\/\s*kg|por\s+kg|\/\s*m\s*[2²]/i;
const md = [];
const esc = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').slice(0, 120);
let totAll = 0, totKg = 0, okKg = 0;
const summary = [];
for (const [label, drugs] of sources) {
  let all = 0, kg = 0, ok = 0, nCalcs = 0, full = 0;
  const causes = {};
  const rows = [];
  for (const d of drugs) for (const r0 of d.regimens || []) {
    const r = asReg(r0);
    all++;
    const txt = [r.text, r.dose, r.freq, r.max].filter(Boolean).join(' | ');
    const byKg = perKg.test(txt) || /tramo|kg\)|kg:/.test(txt);
    const list = calcListOf(r);
    if (!byKg && !list.length) continue; // dosis fija: no necesita la calculadora
    kg++;
    let why = '';
    // «calcula» = con el peso da la dosis por toma (directamente o eligiendo la frecuencia que la pauta no dice)
    const res = list.map((x) => {
      const y = lib.doseCalc(x.c, { kg: 20 });
      if (y && (y.perDose != null || y.noBracket)) return 'sí';
      if (y && y.needFreq) return 'eligiendo frecuencia';
      return lib.COMMON_FREQS && !x.c.freqs.length ? 'eligiendo frecuencia' : 'no';
    });
    const good = res.filter((v) => v !== 'no').length;
    if (good) { ok++; nCalcs += good; if (res.includes('sí')) full++; why = list.map((x) => (x.label ? `${x.label}: ` : '') + (lib.calcDesc ? lib.calcDesc(x.c) : '')).join(' · '); }
    else { why = list.length ? 'por día sin frecuencia (no se reparte)' : (noCalc(r) || 'no se entiende'); causes[why] = (causes[why] || 0) + 1; }
    rows.push(`| ${esc(d.name)} | ${esc(r.indication)} | ${esc(txt)} | ${good ? `${res.includes('sí') ? 'sí' : 'eligiendo frecuencia'}${list.length > 1 ? ` (${list.length})` : ''}` : 'no'} | ${esc(why)} |`);
  }
  totAll += all; totKg += kg; okKg += ok;
  summary.push(`| ${label} | ${all} | ${kg} | ${ok} | ${kg ? Math.round((ok / kg) * 100) : 0} % | ${full} | ${nCalcs} |`);
  md.push(`## ${label}`, '', '| Fármaco | Pauta | Texto | ¿Calcula? | Cálculo / motivo |', '|---|---|---|---|---|', ...rows, '',
    '**Sin calcular, por causa**', '', '| Causa | Pautas |', '|---|---|', ...Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`), '');
}
const head = ['# Auditoría de la calculadora', '', '| Fuente | Pautas | Por peso | Calculan | % | Sin elegir nada | Cálculos |', '|---|---|---|---|---|---|---|', ...summary,
  `| **Total** | ${totAll} | ${totKg} | ${okKg} | ${totKg ? Math.round((okKg / totKg) * 100) : 0} % | | |`, ''];
const text = [...head, ...md].join('\n');
if (outFile) fs.writeFileSync(outFile, text);
console.log(head.join('\n'));
