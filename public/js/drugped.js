// Dosis pediátricas por peso (v1.32.0). Sin DOM ni Firebase: se prueba con node.
// Pauta pediátrica: campos opcionales perKg («15»), perKgUnit («mg»), max (dosis máxima absoluta, «1 g»), freq.
// Con el peso: dosis = perKg × kg, limitada a la máxima (capped), y volumen si la presentación dice la concentración
// («100 mg/ml», «250 mg/5 ml», «1 g/10 ml»).
export const PERKG_UNITS = ['mg', 'mcg', 'g', 'UI', 'mEq', 'mmol', 'ml', 'gotas'];
const str = (x) => (x == null ? '' : String(x));
const FACT = { g: 1000, mg: 1, mcg: 0.001, 'µg': 0.001, ug: 0.001, ng: 0.000001 };
const unitKey = (u) => { const k = str(u).trim().toLowerCase().replace('μ', 'µ'); return k === 'µg' || k === 'ug' ? 'mcg' : k; };

/** «1,5» → 1.5 · «1.000» → 1000 (punto de miles si hay 3 cifras detrás) · nada → NaN */
export function parseNum(s) {
  let t = str(s).trim().replace(/\s+/g, '');
  if (!t) return NaN;
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return Number(t.replace(',', '.'));
}
/** Cambia de unidad (solo mg / mcg / g entre sí). null si no se puede. */
export function convert(v, from, to) {
  const a = unitKey(from), b = unitKey(to);
  if (a === b) return v;
  if (FACT[a] != null && FACT[b] != null) return (v * FACT[a]) / FACT[b];
  return null;
}
/** Primera cantidad de un texto: «1 g», «máx 500 mg/dosis», «4000 UI» → {v, unit} */
export function parseAmount(text) {
  const m = str(text).match(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|μg|ug|g|UI|U|mEq|mmol|ml|mL|gotas)\b/i);
  if (!m) return null;
  return { v: parseNum(m[1]), unit: unitKey(m[2]) === 'u' ? 'ui' : unitKey(m[2]) };
}
/** Concentración de una presentación: «100 mg/ml» · «250 mg/5 ml» · «1 g/10 ml» → {perMl, unit} */
export function concOf(pres) {
  const m = str(pres).match(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|μg|ug|g|UI|mEq|mmol)\s*\/\s*(\d+(?:[.,]\d+)?)?\s*m[lL]\b/i);
  if (!m) return null;
  const amount = parseNum(m[1]);
  const ml = m[3] ? parseNum(m[3]) : 1;
  if (!(amount > 0) || !(ml > 0)) return null;
  return { perMl: amount / ml, unit: unitKey(m[2]) };
}
/** Número bonito en español: 300 · 7,5 · 0,25 (sin ceros de más) */
export function fmt(n) {
  if (!Number.isFinite(n)) return '';
  const d = n >= 100 ? 0 : n >= 10 ? 1 : n >= 1 ? 2 : 3;
  return String(Number(n.toFixed(d))).replace('.', ',');
}
export const hasPerKg = (r) => parseNum(r?.perKg) > 0;
/** Peso válido (kg): 0,3–200 */
export const validKg = (kg) => Number.isFinite(kg) && kg >= 0.3 && kg <= 200;

/**
 * Cálculo de una pauta con el peso. Devuelve null si la pauta no es por kg o no hay peso válido.
 * { perKg, unit, raw (sin tope), dose, capped, max {v, unit} | null, vol (ml) | null, conc }
 */
export function pedCalc(r, kg, pres = r?.pres) {
  const perKg = parseNum(r?.perKg);
  if (!(perKg > 0) || !validKg(kg)) return null;
  const unit = str(r.perKgUnit).trim() || 'mg';
  const raw = perKg * kg;
  let dose = raw, capped = false;
  const mx = parseAmount(r.max);
  const maxV = mx ? convert(mx.v, mx.unit, unit) : null;
  if (maxV != null && maxV > 0 && raw > maxV) { dose = maxV; capped = true; }
  const conc = concOf(pres);
  let vol = null;
  if (conc && unitKey(unit) !== 'ml') {
    const per = convert(conc.perMl, conc.unit, unit);
    if (per && per > 0) vol = dose / per;
  }
  return { perKg, unit, raw, dose, capped, max: maxV != null ? { v: maxV, unit } : null, vol, conc };
}

/** Texto de la dosis calculada: «300 mg (3 ml)» */
export const doseText = (c) => (c ? `${fmt(c.dose)} ${c.unit}${c.vol != null ? ` (${fmt(c.vol)} ml)` : ''}` : '');

/** Línea para el informe con la dosis calculada:
 *  «Paracetamol 100 mg/ml sol oral: 300 mg (3 ml) VO cada 6 h — 15 mg/kg, peso 20 kg» (+ «, dosis máxima» si se aplicó el tope) */
export function pedLine(name, r, kg) {
  const c = pedCalc(r, kg);
  if (!c) return textLine(name, r, kg); // v1.34.2: sin «Dosis por kg», con lo que diga el texto
  const head = [str(name).trim(), str(r.pres).trim()].filter(Boolean).join(' ');
  const dur = str(r.duration).trim();
  const parts = [doseText(c), str(r.route).trim(), str(r.freq).trim(), dur ? (/^\d/.test(dur) ? `durante ${dur}` : dur) : ''].filter(Boolean);
  return `${head}${head ? ': ' : ''}${parts.join(' ')} — ${fmt(c.perKg)} ${c.unit}/kg, peso ${fmt(kg)} kg${c.capped ? ' (dosis máxima)' : ''}`;
}

// ====================== Cálculo a partir del texto de la dosis (v1.34.2) ======================
// Para las pautas sin «Dosis por kg» (p. ej. las de la Guía de Aragón: «60 mg/kg/día», «0,2-0,5 mg/kg», «200 μg/kg»):
// se leen las dosis por kg del texto y se multiplican por el peso. Sin tope (la máxima no está en el texto):
// se avisa de comprobarla en la tabla por peso.
/** Resultado con el peso: «= 1200 mg/día» · «= 4–10 mg/dosis» (null si no hay peso o no hay dosis por kg en el texto) */
export function textCalc(text, kg) {
  if (!validKg(kg)) return null;
  const list = perKgInText(text);
  if (!list.length) return null;
  return list.map((x) => {
    const lo = x.lo * kg, hi = x.hi * kg;
    return { ...x, dlo: lo, dhi: hi, out: `${fmt(lo)}${hi !== lo ? `–${fmt(hi)}` : ''} ${x.unit}/${x.per}` };
  });
}
/** Línea para el informe con el cálculo del texto: «Paracetamol: 60 mg/kg/día → 1200 mg/día (peso 20 kg)» */
export function textLine(name, r, kg) {
  const c = textCalc(r?.text || r?.dose, kg);
  if (!c) return '';
  const head = [str(name).trim(), str(r.pres).trim()].filter(Boolean).join(' ');
  return `${head}${head ? ': ' : ''}${c.map((x) => `${x.src} → ${x.out}`).join('; ')} (peso ${fmt(kg)} kg)`;
}

// ====================== Calculadora de dosis (v1.37.0 → asistente v1.39.0) ======================
// Campo opcional `calc` en cada pauta (= una indicación o patología):
//   { amount: {lo, hi, usual?}, unit, per: 'kg/día'|'kg/dosis'|'kg/h'|'kg/min'|'dosis fija'|'tramos',
//     freqs: [h…] (permitidas; [] = no lo dice: se ofrecen todas, ninguna marcada), freq (habitual), once (dosis única),
//     maxDose, maxDay, duration, route, presPref (presentación preferida),
//     brackets: [{fromKg, toKg, dose, unit, freq, gt, lt}] (dosis por tramos de peso: con el peso se elige el tramo) }
// Compatible con perKg/perKgUnit/max (v1.32.0) y con las dosis por kg del texto: calcListOf()/calcOf() dan siempre
// el mismo objeto. Nunca se inventan dosis ni máximas: solo lo que dice el texto, la tabla o el editor.
export const CALC_UNITS = ['mg', 'mcg', 'g', 'ng', 'UI', 'mEq', 'mmol', 'ml', 'gotas'];
export const CALC_PER = ['kg/día', 'kg/dosis', 'kg/h', 'kg/min', 'dosis fija'];
export const CALC_FREQS = [1, 2, 3, 4, 6, 8, 12, 24, 48];
/** Frecuencias que se ofrecen cuando la pauta no dice ninguna */
export const COMMON_FREQS = [4, 6, 8, 12, 24];
const PER_OF = { día: 'kg/día', dosis: 'kg/dosis', h: 'kg/h', min: 'kg/min' };
const cleanUnit = (u) => {
  const k = unitKey(u);
  if (k === 'ui' || k === 'u') return 'UI';
  if (k === 'meq') return 'mEq';
  if (k === 'gota' || k === 'gotas') return 'gotas';
  return CALC_UNITS.includes(k) ? k : '';
};
const deacc = (s) => str(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/μ/g, 'µ');
const NUMW = { una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
const numw = (s) => NUMW[s] ?? parseNum(s);
const W = '(\\d|una|uno|un|dos|tres|cuatro|seis)';

/** Frecuencias en horas: «cada 8 h» → [8] · «cada 6-8 horas» → [6, 8] · «c/12h» · «/8 h» · «3 veces al día» → [8] ·
 *  «en 2-3 dosis» → [8, 12] · «repartido en 3 tomas» → [8] · «1 vez al día» → [24] · «1 ó 2 dosis al día» → [12, 24] */
export function freqHours(text) {
  const t = deacc(text).replace(/\bó\b/g, 'o');
  const out = new Set();
  for (const m of t.matchAll(/(?:cada|c\/|\/)\s*(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|a|o)\s*(\d+(?:[.,]\d+)?))?\s*(?:h\b|hrs?\b|horas?\b)/g)) {
    const a = parseNum(m[1]), b = m[2] ? parseNum(m[2]) : a;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (const h of COMMON_FREQS) if (h >= lo && h <= hi) out.add(h);
    for (const h of [lo, hi]) if (h > 0 && h <= 48) out.add(h);
  }
  const times = (a, b) => { const x = numw(a), y = b ? numw(b) : x; for (let n = Math.min(x, y); n <= Math.max(x, y); n++) if (n >= 1 && n <= 12) out.add(24 / n); };
  for (const m of t.matchAll(new RegExp(`(?<![\\d.,])${W}(?:\\s*(?:-|–|a|o|y)\\s*${W})?\\s*(?:veces|vez|tomas?|dosis)\\s*(?:al|\\/|por|cada|a|en el)\\s*dia`, 'g'))) times(m[1], m[2]);
  for (const m of t.matchAll(new RegExp(`\\b(?:en|repartid[oa]s?\\s+en|dividid[oa]s?\\s+en|administrad[oa]s?\\s+en)\\s+${W}(?:\\s*(?:-|–|a|o|y)\\s*${W})?\\s*(?:veces|tomas?|dosis)\\b`, 'g'))) times(m[1], m[2]);
  if (/\b(una vez al dia|cada dia|al dia en una|diari[oa]s?)\b/.test(t)) out.add(24);
  return [...out].filter((h) => h > 0).sort((a, b) => a - b);
}
const onceIn = (text) => /\b(dosis|toma) unica\b|\bunica (dosis|toma)\b|\bdosis de carga\b/.test(deacc(text));

/** Saneado de `calc` (datos guardados o importados). null si no sirve para calcular. */
export function normCalc(c) {
  if (!c || typeof c !== 'object') return null;
  const brackets = normBrackets(c.brackets);
  const lo = parseNum(c.amount?.lo ?? c.lo ?? (typeof c.amount === 'object' ? '' : c.amount)), hiRaw = parseNum(c.amount?.hi ?? c.hi);
  const hi = hiRaw > 0 ? hiRaw : lo;
  let per = CALC_PER.includes(c.per) ? c.per : null;
  if (!(lo > 0) || !per) { if (!brackets.length) return null; per = 'tramos'; }
  const unit = cleanUnit(c.unit) || (brackets[0]?.unit && cleanUnit(brackets[0].unit)) || 'mg';
  const freqs = [...new Set((Array.isArray(c.freqs) ? c.freqs : []).map(Number).filter((h) => h > 0 && h <= 48))].sort((a, b) => a - b);
  const f = Number(c.freq);
  const out = { amount: per === 'tramos' ? { lo: 0, hi: 0 } : { lo: Math.min(lo, hi), hi: Math.max(lo, hi) }, unit, per, freqs, freq: freqs.includes(f) ? f : (freqs.length === 1 ? freqs[0] : null) };
  if (!out.freq && f > 0 && f <= 48) { out.freqs = [...new Set([...freqs, f])].sort((a, b) => a - b); out.freq = f; }
  const us = parseNum(c.amount?.usual ?? c.usual);
  if (us > 0 && per !== 'tramos' && us >= out.amount.lo && us <= out.amount.hi) out.amount.usual = us;
  if (c.once) { out.once = true; out.freqs = []; out.freq = null; }
  for (const k of ['maxDose', 'maxDay', 'duration']) { const v = str(c[k]).replace(/\s+/g, ' ').trim().slice(0, 60); if (v) out[k] = v; }
  const route = str(c.route).replace(/\s+/g, ' ').trim().slice(0, 30); if (route) out.route = route;
  const pp = str(c.presPref).replace(/\s+/g, ' ').trim().slice(0, 160); if (pp) out.presPref = pp;
  if (brackets.length) out.brackets = brackets;
  return out;
}
function normBrackets(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const b of list) {
    if (!b || typeof b !== 'object') continue;
    const from = parseNum(b.fromKg), to = parseNum(b.toKg), dose = parseNum(b.dose);
    if (!(dose > 0) || (!(from >= 0) && !(to > 0))) continue;
    const x = { fromKg: from >= 0 ? from : 0, toKg: to > 0 ? to : null, dose, unit: str(b.unit).trim().slice(0, 12) || 'mg' };
    const fq = Number(b.freq); if (fq > 0 && fq <= 48) x.freq = fq;
    if (b.gt) x.gt = true;
    if (b.lt) x.lt = true;
    if (x.toKg != null && x.toKg < x.fromKg) continue;
    out.push(x);
  }
  return out.sort((a, b) => a.fromKg - b.fromKg).slice(0, 12);
}
/** Tramo de peso que corresponde a un peso (null si ninguno) */
export function bracketFor(c, kg) {
  if (!c?.brackets?.length || !validKg(kg)) return null;
  return c.brackets.find((b) => (b.gt ? kg > b.fromKg : kg >= b.fromKg) && (b.toKg == null || (b.lt ? kg < b.toKg : kg <= b.toKg))) || null;
}
export const bracketTxt = (b) => `${b.toKg == null ? `${b.gt ? '>' : '≥'} ${fmt(b.fromKg)}` : b.fromKg > 0 ? `${fmt(b.fromKg)}–${fmt(b.toKg)}` : `${b.lt ? '<' : '≤'} ${fmt(b.toKg)}`} kg`;

// ---------- Lector del texto de la dosis ----------
const UNIT = '(mg|mcg|µg|ug|ng|g|UI|U|mEq|mmol|ml|gotas?)';
// «40-90 mg/kg/día» · «40 a 50 mg por kg y día» · «10 mg/kg/8 h» · «0,1 UI/kg/h» · «5-20 µg/kg/min» · «1,5 mg/kg/toma» · «200 μg/kg»
const KG_RE = new RegExp(`(\\d+(?:[.,]\\d+)?)((?:\\s*(?:-|–|a)\\s*\\d+(?:[.,]\\d+)?)*)\\s*${UNIT}\\s*(?:\\/|por|x)\\s*kg\\b` +
  `(?:\\s*(?:\\/|al|y|por|cada|de|a la)?\\s*(d[ií]as?\\b|d\\b|24\\s*h(?:oras)?\\b|dosis\\b|toma\\b|(\\d+(?:[.,]\\d+)?)\\s*h(?:oras)?\\b|h(?:ora)?\\b|min(?:uto)?\\b|%))?`, 'gi');
/** Dosis por kg del texto, con su posición: [{lo, hi, unit, per, freq, index, end, src}] (sin las que son máximas) */
function kgMatches(text) {
  const t = str(text).replace(/μ/g, 'µ');
  const out = [];
  for (const m of t.matchAll(KG_RE)) {
    const nums = [m[1], ...(m[2].match(/\d+(?:[.,]\d+)?/g) || [])].map(parseNum).filter((n) => n > 0);
    if (!nums.length) continue;
    const before = deacc(t.slice(Math.max(0, m.index - 22), m.index));
    if (/(m[aá]x\w*\.?|superar|sobrepasar|≤|hasta un)\s*:?\s*(de\s*)?(los\s*)?$/.test(before)) continue; // es una máxima
    const sfx = deacc(m[4] || '');
    let per = 'dosis', freq = null;
    if (sfx === '%') per = '%';
    else if (/^(dias?|d|24\s*h)/.test(sfx)) per = 'día';
    else if (m[5]) { freq = parseNum(m[5]); if (freq === 24) { per = 'día'; freq = null; } }
    else if (/^h/.test(sfx)) per = 'h';
    else if (/^min/.test(sfx)) per = 'min';
    out.push({ lo: Math.min(...nums), hi: Math.max(...nums), unit: cleanUnit(m[3]), per, freq, index: m.index, end: m.index + m[0].length, src: m[0].trim() });
  }
  return out;
}
/** Dosis por kg que aparecen en un texto (v1.34.2): [{lo, hi, unit, per: 'día'|'dosis'|'h'|'min', src}] */
export function perKgInText(text) {
  return kgMatches(text).filter((x) => x.per !== '%' && x.unit).map(({ lo, hi, unit, per, src }) => ({ lo, hi, unit, per, src }));
}
/** Máximas que dice el texto. Solo las que dicen si son por toma o por día; «máx 12 mg» sin más solo cuenta como
 *  máxima por toma si la dosis es por toma (kg/dosis o fija). Nunca se suponen. */
const MAX_RE = /(?:dosis\s+m[aá]xima(?:\s+de)?|m[aá]x(?:\.|imo|ima)?(?:\s+de)?|sin\s+(?:superar|sobrepasar)(?:\s+(?:los|las))?|no\s+(?:superar|sobrepasar)(?:\s+(?:los|las))?|≤)\s*:?\s*(\d+(?:[.,]\d+)*)\s*(mg|mcg|µg|μg|ng|g|UI|mEq|mmol|ml)\b(?!\s*\/\s*kg)\s*(?:\/\s*|al\s+|por\s+|cada\s+|en\s+|a\s+la\s+)?(d[ií]a|24\s*h|dosis|toma)?/gi;
function maxesInText(text, per = '') {
  const out = {};
  for (const m of str(text).matchAll(MAX_RE)) {
    const v = `${m[1]} ${cleanUnit(m[2]) || m[2]}`;
    let k = m[3] ? (/^(d[ií]a|24)/i.test(m[3]) ? 'maxDay' : 'maxDose') : (per === 'kg/dosis' || per === 'dosis fija' ? 'maxDose' : '');
    if (!k) continue;
    if (out[k] && out[k] !== v) return { ambiguous: true };
    out[k] = v;
  }
  return out;
}
/** Campo «máx» de la pauta (plantilla): «4 g/día · < 50 kg…» → maxDay · «4.500 mg» → maxDose si la dosis es por toma */
function maxField(s, per) {
  const first = str(s).split(/[·;(]/)[0].trim();
  if (!first || /\/\s*kg/i.test(first)) return {};
  const a = first.match(/^(?:m[aá]x\w*\.?\s*:?\s*)?(\d+(?:[.,]\d+)*)\s*(mg|mcg|µg|μg|ng|g|UI|mEq|mmol|ml)\b\s*(.*)$/i);
  if (!a) return {};
  const v = `${a[1]} ${cleanUnit(a[2]) || a[2]}`, rest = deacc(a[3]);
  if (/^(\/\s*|al |en |por )?(dia|24\s*h)/.test(rest)) return { maxDay: v };
  if (/^(\/\s*|por )?(dosis|toma)/.test(rest)) return { maxDose: v };
  return per === 'kg/dosis' || per === 'dosis fija' ? (rest ? {} : { maxDose: v }) : {};
}
const durationIn = (text) => { const m = str(text).match(/(?:durante|x)\s+(\d+(?:\s*(?:[-–]|a)\s*\d+)?\s*(?:d[ií]as?|semanas?|meses?))/i); return m ? m[1].replace(/\s+a\s+/, '-') : ''; };

// Tramos de peso: «< 10 kg: 2,5 ml; 10-20 kg: 5 ml; > 20 kg: 10 ml» · «10 mg (> 40 kg); 5 mg (13-40 kg)»
const DUNIT = '(mg|mcg|µg|g|UI|ml|gotas|comp\\w*|sobres?|sup\\w*|puls\\w*|inh\\w*|amp\\w*)';
const KGB = '(?:(<|≤|menos de|hasta)\\s*(\\d+(?:[.,]\\d+)?)|(>|≥|mas de|más de|mayores? de|a partir de)\\s*(\\d+(?:[.,]\\d+)?)|(?:de\\s+)?(\\d+(?:[.,]\\d+)?)\\s*(?:-|–|a)\\s*(\\d+(?:[.,]\\d+)?))\\s*kg';
const BR1 = new RegExp(`${KGB}\\s*\\)?\\s*[:=→,]?\\s*(\\d+(?:[.,]\\d+)?)\\s*${DUNIT}(?!\\s*\\/\\s*kg)`, 'gi');
const BR2 = new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${DUNIT}(?!\\s*\\/\\s*kg)\\s*\\(\\s*(?:si\\s+)?${KGB}\\s*\\)`, 'gi');
function bracketsIn(text) {
  const t = str(text).replace(/μ/g, 'µ');
  const mk = (lt, ltv, gt, gtv, a, b, dose, unit, idx) => {
    const x = lt ? { fromKg: 0, toKg: parseNum(ltv), lt: /^<|menos/.test(lt) } : gt ? { fromKg: parseNum(gtv), toKg: null, gt: /^>|mas|más|mayor/.test(gt) } : { fromKg: parseNum(a), toKg: parseNum(b) };
    const u = deacc(unit);
    x.dose = parseNum(dose);
    x.unit = /^comp/.test(u) ? 'comp' : /^sob/.test(u) ? 'sobre' : /^sup/.test(u) ? 'sup' : /^puls/.test(u) ? 'puls' : /^inh/.test(u) ? 'inh' : /^amp/.test(u) ? 'amp' : cleanUnit(unit) || unit;
    const tail = t.slice(idx, idx + 60).split(/[;\n]/)[0];
    const fr = freqHours(tail);
    if (fr.length === 1) x.freq = fr[0];
    return x;
  };
  const list = [];
  for (const m of t.matchAll(BR1)) list.push(mk(m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m.index));
  if (list.length < 2) { list.length = 0; for (const m of t.matchAll(BR2)) list.push(mk(m[3], m[4], m[5], m[6], m[7], m[8], m[1], m[2], m.index)); }
  return list.length >= 2 ? normBrackets(list) : [];
}

/** Etiqueta de un trozo de texto: «Neumonía: 90 mg/kg/día…» → «Neumonía» · «Menores de 6 meses a 10 mg/kg» → «Menores de 6 meses» */
function labelOf(prefix, scope) {
  const strip = (x) => str(x).replace(/\([^)]*\)?/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;:.+·\-–]+|[\s,;:.+·\-–(]+$/g, '')
    .replace(/\b(a|en)?\s*(dosis|dosificad[oa])\s*(de|:)?\s*$/i, '').replace(/\b(a|con|de)\s*$/i, '')
    .replace(/^(y|o|e|después|despues|y después|luego)\s+/i, '').replace(/^(en|para)\s+(el|la|los|las)?\s*/i, '').trim();
  let l = strip(prefix);
  if (l.length > 48) l = strip(l.split(/[,:]/).filter((x) => x.trim().length >= 3).pop() || l);
  if (l.length > 48) l = `${l.slice(0, 46).replace(/\s+\S*$/, '')}…`;
  if (l.length >= 3) return l[0].toUpperCase() + l.slice(1);
  return str(scope).split(/[,;.(]/)[0].trim().slice(0, 48);
}

/**
 * Cálculos de un texto. Varias dosis por kg en un mismo texto → varios cálculos (con su etiqueta).
 * opts = { freqText (campo frecuencia), max (campo máx), duration }.
 * Devuelve [{ label, calc, sure }]; sure = se entiende sin duda (para la migración silenciosa).
 */
export function calcsFromText(text, { freqText = '', max = '', duration = '' } = {}) {
  const t = str(text).replace(/μ/g, 'µ');
  const all = kgMatches(t);
  const list = all.filter((x) => x.per !== '%' && x.unit);
  const extraF = freqHours(freqText);
  if (!list.length) {
    const br = bracketsIn(`${t} ${str(freqText)}`);
    if (!br.length) return [];
    const freqs = [...new Set([...br.map((b) => b.freq).filter(Boolean), ...extraF])].sort((a, b) => a - b);
    const calc = normCalc({ per: 'tramos', brackets: br, unit: br[0].unit, freqs, freq: freqs.length === 1 ? freqs[0] : null, duration: duration || durationIn(t), once: onceIn(t) });
    return calc ? [{ label: '', calc, sure: false }] : [];
  }
  const one = list.length === 1;
  // límites de cada trozo: frases, «;», «+», saltos de línea
  const seps = [...t.matchAll(/[;\n+]|\.(?=\s+[A-ZÁÉÍÓÚÑ¿¡<>])|,\s+(?=\d)/g)].map((m) => m.index);
  const out = [];
  list.forEach((x, i) => {
    const sepBefore = Math.max(-1, ...seps.filter((s) => s < x.index));
    const prevEnd = i ? list[i - 1].end : 0;
    const start = Math.max(prevEnd, sepBefore + 1);
    const nextStart = i < list.length - 1 ? list[i + 1].index : t.length;
    const sepAfter = seps.find((s) => s >= x.end && s < nextStart);
    const scope = one ? t : t.slice(x.index, sepAfter ?? nextStart);
    const label = one ? '' : labelOf(t.slice(start, x.index), t.slice(x.index, sepAfter ?? nextStart));
    const per = PER_OF[x.per];
    let freqs = x.freq ? [x.freq] : freqHours(scope);
    if (!freqs.length && one) freqs = extraF;
    const once = !freqs.length && (onceIn(scope) || (one && onceIn(freqText)));
    // «máx 12 mg» sin «por toma/día» solo es por toma si la dosis es por toma y sin frecuencia (dosis única o «repetir»)
    const mper = per === 'kg/dosis' && !freqs.length ? per : '';
    const mx = { ...maxField(max, mper), ...maxesInText(scope, mper) };
    const calc = normCalc({ amount: { lo: x.lo, hi: x.hi }, unit: x.unit, per, freqs, freq: freqs.length === 1 ? freqs[0] : null,
      maxDose: mx.maxDose, maxDay: mx.maxDay, duration: duration || durationIn(scope), once });
    if (!calc) return;
    const sure = one && all.length === 1 && !mx.ambiguous && (per !== 'kg/día' || freqs.length > 0);
    out.push({ label, calc, sure });
  });
  // sin repetir (misma dosis, unidad, por y frecuencias)
  const seen = new Set();
  return out.filter((o) => { const k = JSON.stringify([o.calc.amount, o.calc.unit, o.calc.per, o.calc.freqs]); if (seen.has(k)) return false; seen.add(k); return true; });
}
/** `calc` a partir del texto (migración y «Rellenar desde el texto»): el primero. { calc, sure } | null */
export function calcFromText(text, opts = {}) {
  const l = calcsFromText(text, opts);
  if (!l.length) return null;
  return { calc: l[0].calc, sure: l.length === 1 && l[0].sure };
}
const regText = (r) => str(r?.text).trim() || str(r?.dose).trim();
const regOpts = (r) => ({ freqText: str(r?.text).trim() ? '' : str(r?.freq), max: r?.max, duration: str(r?.duration) });
/** `calc` leído de los campos de una pauta (texto de la dosis, o dosis + frecuencia + máx de la plantilla) */
export const calcFromReg = (r) => calcFromText(regText(r), regOpts(r));
/** Vía de una pauta para el resultado (VO, IV, IM…) */
export function routeOf(r, c) {
  const v = str(c?.route).trim() || str(r?.route).trim();
  if (v && v.length <= 14) return v;
  const t = str(r?.type).trim();
  if (/^(VO|IV|IM|SC|SL|VR|IO|Intranasal|Nebulizado|Inhalada|Rectal|Bolo|Perfusión)$/i.test(t)) return t === 'Bolo' ? 'IV' : t === 'Perfusión' ? 'IV' : t;
  return v ? v.split(/[\s(,;]+/)[0] : '';
}

/** Descripción corta de un cálculo: «80–90 mg/kg/día cada 8 h, máx 1 g/toma» */
export function calcDesc(c) {
  if (!c) return '';
  if (c.per === 'tramos') return `Por tramos de peso: ${c.brackets.map((b) => `${bracketTxt(b)} → ${fmt(b.dose)} ${b.unit}${b.freq ? ` c/${fmt(b.freq)} h` : ''}`).join('; ')}`;
  const a = `${fmt(c.amount.lo)}${c.amount.hi > c.amount.lo ? `–${fmt(c.amount.hi)}` : ''} ${c.unit}${c.per === 'dosis fija' ? '' : `/${c.per}`}`;
  const f = c.per === 'kg/h' || c.per === 'kg/min' ? '' : c.once ? 'dosis única' : c.freqs.length ? `cada ${c.freqs.map(fmt).join('-')} h` : '';
  const mx = [c.maxDose ? `máx ${c.maxDose}/toma` : '', c.maxDay ? `máx ${c.maxDay}/día` : ''].filter(Boolean).join(', ');
  return [[a, f].filter(Boolean).join(' '), mx].filter(Boolean).join(', ') + (c.duration ? ` durante ${c.duration}` : '');
}
/**
 * Cálculos de una pauta: [{ key, label, c }]. El campo calc (revisado o automático), o perKg (v1.32.0), o el texto
 * (varias dosis por kg en el texto → varios, con su etiqueta). [] si no es por peso.
 */
export function calcListOf(r) {
  if (!r) return [];
  const id = r.id || 'r';
  const c = normCalc(r.calc);
  if (c) return [{ key: id, label: '', c: { ...c, src: 'calc', auto: !!r.calcAuto } }];
  const pk = parseNum(r.perKg);
  if (pk > 0) {
    const freqs = freqHours(`${str(r.freq)} ${str(r.text)}`);
    const mx = parseAmount(r.max);
    const x = normCalc({ amount: { lo: pk, hi: pk }, unit: r.perKgUnit || 'mg', per: 'kg/dosis', freqs, freq: freqs.length === 1 ? freqs[0] : null,
      maxDose: mx ? `${mx.v} ${mx.unit}` : '', duration: r.duration });
    return x ? [{ key: id, label: '', c: { ...x, src: 'perKg', auto: false } }] : [];
  }
  if (r.calcAuto === false) return []; // quitado a mano en el editor
  return calcsFromText(regText(r), regOpts(r)).map((x, i) => ({ key: i ? `${id}~${i}` : id, label: x.label, c: { ...x.calc, src: 'text', auto: true } }));
}
/** Cálculo efectivo de una pauta (el primero). null si no es por peso. */
export function calcOf(r) { return calcListOf(r)[0]?.c || null; }
export const needsKg = (c) => !!c && c.per !== 'dosis fija';
/** Por qué una pauta no se puede calcular (para el informe y la ficha). '' si se calcula o no es por peso. */
export function noCalcReason(r) {
  if (!r || calcListOf(r).length) return '';
  const t = deacc([regText(r), r.freq].join(' '));
  const m = deacc(r.max);
  if (/\/\s*m\s*[2²]\b|\bm2\b|superficie corporal/.test(t)) return 'Dosis por superficie corporal (mg/m²)';
  if (/tablas? por peso/.test(t)) return 'Solo en la tabla por peso (imagen)';
  if (/(anos|meses|lactantes)\b/.test(t) && /\d\s*(mg|ml|comp|gotas|puls|sobres?|mcg|µg|inh)\b/.test(t) && !/\/\s*kg/.test(t)) return 'Dosis fija por edad (sin peso)';
  if (r.calcAuto === false) return 'Cálculo quitado a mano';
  if (/kg\s*\/\s*%|%\s*(de\s*)?s\.?c\.?q/.test(`${t} ${m}`)) return 'Necesita otro dato (% de superficie quemada)';
  if (/(m[aá]x\w*|≤|superar)[^/]{0,20}\/\s*kg/.test(t)) return 'La dosis por kg es la máxima, no la pauta';
  if (!/\/\s*kg|por kg/.test(t) && /\/\s*kg/.test(m)) return 'La dosis por kg está en «máx», no en la pauta';
  if (/\/\s*kg|por kg/.test(t)) return 'Dosis por kg que no se entiende';
  if (/\bkg\b/.test(`${t} ${m}`)) return 'Dosis fija según el peso (un solo tramo)';
  return '';
}
/** ¿La pauta se resuelve con una tabla (mg/m², por edad, solo tabla)? → «Dosis por tramos: ver tabla por peso» */
export const tableOnly = (r) => /superficie|edad|tabla/.test(noCalcReason(r));

/** Presentaciones útiles para la calculadora: líquidos con concentración y formas sólidas con dosis por unidad */
export function presOptions(list) {
  const out = [];
  for (const p of (Array.isArray(list) ? list : [])) {
    const conc = concOf(p);
    if (conc) { out.push({ p, kind: 'liq', perMl: conc.perMl, unit: conc.unit === 'ui' ? 'UI' : conc.unit }); continue; }
    const m = str(p).match(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|μg|g|UI)\b(?!\s*\/)/i);
    const form = str(p).toLowerCase();
    const solid = form.match(/\b(comp|comprimidos?|cáps|caps|cápsulas?|capsulas?|sobres?|sup|supositorios?|grageas?|tabletas?)\b/);
    if (m && solid) {
      const w = solid[1];
      const name = /^comp|^tab|^grag/.test(w) ? 'comp' : /^c[aá]ps/.test(w) ? 'cáps' : /^sob/.test(w) ? 'sobre' : 'sup';
      out.push({ p, kind: 'unit', amount: parseNum(m[1]), unit: unitKey(m[2]) === 'ui' ? 'UI' : unitKey(m[2]), form: name, half: name === 'comp' && !/(recubierto|liberaci|retard|gastrorresist|bucodispers)/.test(form) });
    }
  }
  return out;
}
/** Cantidad por kg elegida: 'min' | 'usual' | 'mid' | 'max' o un número */
export function pickAmount(c, level = 'usual') {
  const { lo, hi, usual } = c.amount;
  if (typeof level === 'number' && level >= lo && level <= hi) return level;
  if (level === 'min') return lo;
  if (level === 'max') return hi;
  if (level === 'usual' && usual) return usual;
  return (lo + hi) / 2;
}
/** Nivel por defecto: la habitual si la hay; si no, la media del rango */
export const defaultLevel = (c) => (c?.amount?.usual ? 'usual' : 'mid');
const toUnit = (txt, unit) => { const a = parseAmount(txt); if (!a) { const n = parseNum(txt); return n > 0 ? n : null; } return convert(a.v, a.unit === 'ui' ? 'UI' : a.unit, unit) ?? (unitKey(a.unit) === unitKey(unit) ? a.v : null); };
const r1 = (n) => Math.round(n * 10) / 10;
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : 0);

/**
 * Dosis por toma. opts = { kg, level, freq (h), pres (texto o opción de presOptions) }.
 * Devuelve null si falta el peso (cuando hace falta) o el cálculo no es válido:
 * { per, unit, amt, nDoses, perDoseRaw, perDose, perDayRaw, perDay, needFreq, cappedDose, cappedDay, noMax, maxDose, maxDay,
 *   perHour, vol, volR, volHalf, volDiff, units {n, exact, form, ok, diff}, given, steps, freq, bracket, noBracket }
 */
export function doseCalc(c, { kg = 0, level = null, freq = null, pres = null } = {}) {
  c = c && c.amount ? c : normCalc(c);
  if (!c) return null;
  if (needsKg(c) && !validKg(kg)) return null;
  let unit = c.unit;
  const f0 = Number(freq) > 0 ? Number(freq) : c.freq || (c.freqs.length === 1 ? c.freqs[0] : null);
  const out = { per: c.per, unit, amt: 0, freq: c.once ? null : f0, nDoses: null, cappedDose: false, cappedDay: false, steps: [] };
  // Tramos de peso: con el peso se elige el tramo y se calcula como una dosis fija
  const br = bracketFor(c, kg);
  if (c.per === 'tramos' && !br) {
    return { ...out, noBracket: true, perDose: null, noMax: true, steps: [`${fmt(kg)} kg no está en ningún tramo (${c.brackets.map(bracketTxt).join(' · ')})`] };
  }
  let per = c.per, amt;
  if (br) {
    per = 'dosis fija'; amt = br.dose; unit = br.unit || unit; out.unit = unit; out.bracket = br;
    if (br.freq && !(Number(freq) > 0)) out.freq = br.freq;
    out.steps.push(`Tramo ${bracketTxt(br)}: ${fmt(br.dose)} ${unit}`);
  } else amt = pickAmount(c, level || defaultLevel(c));
  out.amt = amt; out.per = per;
  const f = out.freq;
  const nDoses = f ? 24 / f : null;
  out.nDoses = nDoses;
  const U = (n) => `${fmt(n)} ${unit}`;
  if (per === 'kg/h' || per === 'kg/min') {
    const pu = per === 'kg/h' ? 'h' : 'min';
    out.perDoseRaw = amt * kg;
    out.steps.push(`${fmt(amt)} ${unit}/kg/${pu} × ${fmt(kg)} kg = ${U(out.perDoseRaw)}/${pu}`);
  } else if (per === 'kg/día') {
    out.perDayRaw = amt * kg;
    out.steps.push(`${fmt(amt)} ${unit}/kg/día × ${fmt(kg)} kg = ${U(out.perDayRaw)}/día`);
    if (nDoses) { out.perDoseRaw = out.perDayRaw / nDoses; out.steps.push(`÷ ${fmt(nDoses)} ${nDoses === 1 ? 'toma' : 'tomas'} = ${U(out.perDoseRaw)} cada ${fmt(f)} h`); }
    else { out.needFreq = true; out.perDoseRaw = null; }
  } else if (per === 'kg/dosis') {
    out.perDoseRaw = amt * kg; out.perDayRaw = nDoses ? out.perDoseRaw * nDoses : null;
    out.steps.push(`${fmt(amt)} ${unit}/kg × ${fmt(kg)} kg = ${U(out.perDoseRaw)}${f ? ` cada ${fmt(f)} h` : ' por dosis'}`);
  } else {
    out.perDoseRaw = amt; out.perDayRaw = nDoses ? amt * nDoses : null;
    if (!br) out.steps.push(`Dosis fija: ${U(amt)}${f ? ` cada ${fmt(f)} h` : ''}`);
  }
  const maxDose = c.maxDose && !br ? toUnit(c.maxDose, unit) : null;
  const maxDay = c.maxDay && !br ? toUnit(c.maxDay, unit) : null;
  out.maxDose = maxDose; out.maxDay = maxDay;
  out.noMax = !br && maxDose == null && maxDay == null;
  if (out.needFreq) {
    // por día sin frecuencia elegida: total del día (con su tope) y se pide la frecuencia
    out.perDay = maxDay != null && out.perDayRaw > maxDay + 1e-9 ? maxDay : out.perDayRaw;
    if (out.perDay !== out.perDayRaw) { out.cappedDay = true; out.steps.push(`→ tope al día: ${U(maxDay)}`); }
    out.perDose = null; out.given = null;
    return out;
  }
  let perDose = out.perDoseRaw;
  const isRate = per === 'kg/h' || per === 'kg/min';
  if (maxDose != null && perDose > maxDose + 1e-9) { perDose = maxDose; out.cappedDose = true; out.steps.push(`→ tope por ${isRate ? (per === 'kg/h' ? 'hora' : 'minuto') : 'toma'}: ${U(maxDose)}`); }
  if (maxDay != null && nDoses && !isRate && perDose * nDoses > maxDay + 1e-9) { perDose = maxDay / nDoses; out.cappedDay = true; out.steps.push(`→ tope al día: ${U(maxDay)} ÷ ${fmt(nDoses)} = ${U(perDose)}`); }
  out.perDose = perDose;
  out.perDay = nDoses && !isRate ? perDose * nDoses : null;
  if (per === 'kg/min') out.perHour = perDose * 60;
  if (per === 'kg/h') out.perHour = perDose;
  out.given = perDose;
  // Presentación: volumen (ml; en perfusión, ml/h) o unidades (comprimidos…)
  const opt = typeof pres === 'string' ? presOptions([pres])[0] : pres;
  if (opt && opt.kind === 'liq' && unitKey(unit) !== 'ml') {
    const pml = convert(opt.perMl, opt.unit, unit) ?? (unitKey(opt.unit) === unitKey(unit) ? opt.perMl : null);
    if (pml > 0) {
      out.vol = (isRate ? out.perHour : perDose) / pml; out.volR = r1(out.vol);
      if (!(out.volR > 0)) out.volR = Math.round(out.vol * 100) / 100;
      const h = Math.round(out.vol * 2) / 2;
      if (!isRate && h > 0 && h !== out.volR && Math.abs(h - out.vol) / out.vol <= 0.05) { out.volHalf = h; out.volDiff = pct(h, out.vol); }
      out.conc = opt.p;
      out.steps.push(`→ ${fmt(out.volR)} ml${isRate ? '/h' : ''} de ${opt.p}${isRate ? ` (${fmt(out.perHour)} ${unit}/h)` : ''}`);
    }
  } else if (opt && opt.kind === 'unit' && !isRate) {
    const each = convert(opt.amount, opt.unit, unit) ?? (unitKey(opt.unit) === unitKey(unit) ? opt.amount : null);
    if (each > 0) {
      const exact = perDose / each;
      const step = opt.half ? 0.5 : 1;
      let n = Math.round(exact / step) * step;
      if (maxDose != null && n * each > maxDose + 1e-9) n = Math.floor(maxDose / each / step) * step; // nunca por encima del tope
      if (maxDay != null && nDoses && n * each * nDoses > maxDay + 1e-9) n = Math.floor(maxDay / nDoses / each / step) * step;
      const ok = n > 0 && Math.abs(n * each - perDose) / perDose <= 0.1;
      out.units = { n, exact, form: opt.form, half: opt.half, ok, each, diff: pct(n * each, perDose) };
      if (ok) out.given = n * each; // si no cuadra (±10 %), se da la dosis en mg y se avisa: nunca se redondea a una dosis muy distinta
      out.conc = opt.p;
      out.steps.push(ok ? `→ ${unitsText(out.units)} de ${opt.p}${Math.abs(out.units.diff) >= 0.5 ? ` (${out.units.diff > 0 ? '+' : ''}${fmt(out.units.diff)} %)` : ''}` : `→ con ${opt.p} serían ${fmt(exact)} ${opt.form} (no cuadra)`);
    }
  }
  return out;
}
/**
 * Presentaciones ordenadas para un cálculo: la preferida (presPref) primero; luego la que da un volumen
 * o un nº de comprimidos más fácil de medir (1–10 ml; ½–2 comprimidos que cuadran).
 */
export function rankPres(c, opts, args = {}) {
  const list = [...(opts || [])];
  const pref = norm2(c?.presPref);
  const score = (o) => {
    if (pref && norm2(o.p) === pref) return -100;
    if (!c || (needsKg(c) && !validKg(args.kg))) return 0;
    const x = doseCalc(c, { ...args, pres: o });
    if (!x || x.perDose == null) return 0;
    if (x.vol != null) { const v = x.vol; return v >= 1 && v <= 10 ? Math.abs(Math.log(v / 4)) : 3 + Math.abs(Math.log(v / 4)); }
    if (x.units) return x.units.ok ? (x.units.n >= 0.5 && x.units.n <= 2 ? Math.abs(x.units.diff) / 100 : 2 + x.units.n / 10) : 8;
    return 9;
  };
  return list.map((o, i) => ({ o, s: score(o), i })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.o);
}
const norm2 = (s) => deacc(s).replace(/\s+/g, ' ').trim();
/** «1½ comp», «2 cáps», «½ comp» */
export function unitsText(u) {
  if (!u) return '';
  const whole = Math.floor(u.n), half = u.n - whole >= 0.5;
  const num = `${whole || ''}${half ? '½' : ''}` || '0';
  return `${num} ${u.form}`;
}
const freqTxt = (h) => (h ? `cada ${fmt(h)} h` : '');
const rate = (x) => (x.per === 'kg/h' ? '/h' : x.per === 'kg/min' ? '/min' : '');
/** Resultado principal: «5,3 ml (533 mg)» · «1½ comp (750 mg)» · «533 mg» · perfusión: «1,2 ml/h (12 mg/h)» · por día sin frecuencia: «1200 mg/día» */
export function doseMain(x) {
  if (!x) return '';
  const u = x.unit, h = rate(x);
  if (x.noBracket) return 'fuera de los tramos';
  if (x.needFreq) return `${fmt(x.perDay)} ${u}/día`;
  if (x.vol != null) return h ? `${fmt(x.volR)} ml/h (${fmt(x.perDose)} ${u}${h})` : `${fmt(x.volR)} ml (${fmt(x.perDose)} ${u})`;
  if (x.units && x.units.ok) return `${unitsText(x.units)} (${fmt(x.given)} ${u})`;
  return `${fmt(x.perDose)} ${u}${h}`;
}
/** Resultado corto para la pauta: «5,3 ml c/8 h» · «1½ comp c/12 h» · «1200 mg/día» */
export function doseShort(x) {
  if (!x) return '';
  if (x.noBracket || x.needFreq) return doseMain(x);
  const h = rate(x);
  const main = x.vol != null ? `${fmt(x.volR)} ml${h}` : x.units?.ok ? unitsText(x.units) : `${fmt(x.perDose)} ${x.unit}${h}`;
  return `${main}${!h && x.freq ? ` c/${fmt(x.freq)} h` : ''}`;
}
/** Línea para el informe: «Amoxicilina 250 mg/5 ml susp.: 5,3 ml (533 mg) VO cada 8 h durante 10 días — 80 mg/kg/día, 20 kg» */
export function calcLine(name, r, c, x, kg) {
  if (!x || x.noBracket) return '';
  const head = [str(name).trim(), str(x.conc || '').trim()].filter(Boolean).join(' ');
  const route = routeOf(r, c);
  const dur = str(c.duration || r?.duration).trim();
  const when = x.needFreq ? '' : rate(x) ? 'en perfusión' : x.freq ? freqTxt(x.freq) : c.once ? 'dosis única' : '';
  const parts = [doseMain(x), route, when, dur ? (/^\d/.test(dur) ? `durante ${dur}` : dur) : ''].filter(Boolean);
  const perTxt = x.bracket ? `tramo ${bracketTxt(x.bracket)}` : x.per === 'dosis fija' ? '' : `${fmt(x.amt)} ${c.unit}/${x.per}`;
  const tail = [perTxt, needsKg(c) ? `${fmt(kg)} kg` : ''].filter(Boolean).join(', ');
  const cap = x.cappedDose || x.cappedDay ? ' (limitado a la dosis máxima)' : '';
  return `${head}${head ? ': ' : ''}${parts.join(' ')}${tail ? ` — ${tail}` : ''}${cap}`;
}
/** Línea de una pauta con el peso y las opciones habituales (botón Copiar de la pauta, lineOf con kg) */
export function regCalcLine(name, r, kg, presentations = []) {
  const c = calcOf(r);
  if (!c || (needsKg(c) && !validKg(kg))) return '';
  const opts = presOptions(r?.pres ? [r.pres] : presentations);
  const x = doseCalc(c, { kg, freq: c.freq, pres: rankPres(c, opts, { kg })[0] || null });
  return x && !x.needFreq ? calcLine(name, r, c, x, kg) : '';
}
