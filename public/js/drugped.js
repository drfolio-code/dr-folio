// Dosis pediátricas por peso (v1.32.0). Sin DOM ni Firebase: se prueba con node.
// Pauta pediátrica: campos opcionales perKg («15»), perKgUnit («mg»), max (dosis máxima absoluta, «1 g»), freq.
// Con el peso: dosis = perKg × kg, limitada a la máxima (capped), y volumen si la presentación dice la concentración
// («100 mg/ml», «250 mg/5 ml», «1 g/10 ml»).
export const PERKG_UNITS = ['mg', 'mcg', 'g', 'UI', 'mEq', 'mmol', 'ml', 'gotas'];
const str = (x) => (x == null ? '' : String(x));
const FACT = { g: 1000, mg: 1, mcg: 0.001, 'µg': 0.001, ug: 0.001 };
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
const PERKG_RE = /(\d+(?:[.,]\d+)?)(?:\s*[-–]\s*(\d+(?:[.,]\d+)?))?\s*(mg|mcg|µg|μg|ug|g|UI|mEq|mmol|ml|gotas)\s*\/\s*kg(?:\s*\/\s*(d[ií]a|dosis|toma|h(?:ora)?|min(?:uto)?)\b)?/gi;
const PER = { dia: 'día', día: 'día', dosis: 'dosis', toma: 'dosis', h: 'h', hora: 'h', min: 'min', minuto: 'min' };
/** Dosis por kg que aparecen en un texto: [{lo, hi, unit, per: 'día'|'dosis'|'h'|'min', src}] */
export function perKgInText(text) {
  const out = [];
  for (const m of str(text).matchAll(PERKG_RE)) {
    const lo = parseNum(m[1]), hi = m[2] ? parseNum(m[2]) : lo;
    if (!(lo > 0) || !(hi > 0)) continue;
    out.push({ lo, hi, unit: unitKey(m[3]) === 'ui' ? 'UI' : unitKey(m[3]), per: PER[(m[4] || 'dosis').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^d.a$/, 'dia')] || 'dosis', src: m[0] });
  }
  return out;
}
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

// ====================== Calculadora de dosis por toma (v1.36.0) ======================
// Campo opcional `calc` en cada pauta (= una indicación):
//   { amount: {lo, hi}, unit: mg|mcg|g|UI|mEq|ml, per: 'kg/día'|'kg/dosis'|'kg/h'|'dosis fija',
//     freqs: [6, 8, 12, 24] (horas permitidas), freq (habitual), maxDose ('1 g'), maxDay ('4 g'), duration ('10 días') }
// Compatible con perKg/perKgUnit/max (v1.32.0) y con las dosis por kg del texto (perKgInText, v1.34.2): calcOf() da
// siempre el mismo objeto. Nunca se inventan dosis máximas: si no hay, se avisa.
export const CALC_UNITS = ['mg', 'mcg', 'g', 'UI', 'mEq', 'ml'];
export const CALC_PER = ['kg/día', 'kg/dosis', 'kg/h', 'dosis fija'];
export const CALC_FREQS = [4, 6, 8, 12, 24];
const PER_OF = { día: 'kg/día', dosis: 'kg/dosis', h: 'kg/h' };
const cleanUnit = (u) => { const k = unitKey(u); return k === 'ui' || k === 'u' ? 'UI' : k === 'meq' ? 'mEq' : CALC_UNITS.includes(k) ? k : ''; };

/** Frecuencias en horas que dice un texto: «cada 8 h» → [8] · «cada 6-8 h» → [6, 8] · «c/12h» · «3 veces al día» → [8] · «1 vez al día» → [24] */
export function freqHours(text) {
  const t = str(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const out = new Set();
  for (const m of t.matchAll(/(?:cada|c\/)\s*(\d+(?:[.,]\d+)?)(?:\s*(?:-|–|a|o)\s*(\d+(?:[.,]\d+)?))?\s*(?:h\b|horas?\b)/g)) {
    const a = parseNum(m[1]), b = m[2] ? parseNum(m[2]) : a;
    for (const h of CALC_FREQS) if (h >= Math.min(a, b) && h <= Math.max(a, b)) out.add(h);
    if (!m[2] && a > 0 && a <= 48) out.add(a);
  }
  const veces = t.match(/(\d)\s*(?:veces|vez|tomas?|dosis)\s*(?:al|\/|por|cada)\s*dia/);
  if (veces) { const n = Number(veces[1]); if (n >= 1 && n <= 6) out.add(24 / n); }
  if (/\b(una vez al dia|cada dia|c\/24)\b/.test(t)) out.add(24);
  return [...out].filter((h) => h > 0).sort((a, b) => a - b);
}

/** Saneado de `calc` (datos guardados o importados). null si no sirve para calcular. */
export function normCalc(c) {
  if (!c || typeof c !== 'object') return null;
  const lo = parseNum(c.amount?.lo ?? c.lo ?? c.amount), hiRaw = parseNum(c.amount?.hi ?? c.hi);
  const hi = hiRaw > 0 ? hiRaw : lo;
  const per = CALC_PER.includes(c.per) ? c.per : null;
  const unit = cleanUnit(c.unit) || 'mg';
  if (!(lo > 0) || !per) return null;
  const freqs = [...new Set((Array.isArray(c.freqs) ? c.freqs : []).map(Number).filter((h) => h > 0 && h <= 48))].sort((a, b) => a - b);
  const f = Number(c.freq);
  const out = { amount: { lo: Math.min(lo, hi), hi: Math.max(lo, hi) }, unit, per, freqs, freq: freqs.includes(f) ? f : (freqs.length === 1 ? freqs[0] : (freqs.includes(f) ? f : null)) };
  if (!out.freq && f > 0 && f <= 48) { out.freqs = [...new Set([...freqs, f])].sort((a, b) => a - b); out.freq = f; }
  for (const k of ['maxDose', 'maxDay', 'duration']) { const v = str(c[k]).replace(/\s+/g, ' ').trim().slice(0, 60); if (v) out[k] = v; }
  return out;
}

/** «máx 1 g/dosis», «máximo 4 g al día»: solo las que dicen claramente si es por toma o por día (nunca se suponen) */
function maxesInText(text) {
  const t = str(text);
  const out = {};
  for (const m of t.matchAll(/m[aá]x(?:\.|imo|ima)?\s*:?\s*(\d+(?:[.,]\d+)?)\s*(mg|mcg|µg|μg|g|UI|mEq|ml)\s*(?:\/\s*|al\s+|por\s+|cada\s+)?(d[ií]a|dosis|toma)?/gi)) {
    if (!m[3]) continue;
    const per = /^d[ií]a$/i.test(m[3]) ? 'maxDay' : 'maxDose';
    if (out[per]) return { ambiguous: true };
    out[per] = `${m[1]} ${cleanUnit(m[2]) || m[2]}`;
  }
  return out;
}

/**
 * `calc` a partir del texto de la dosis (para la migración y el botón «Rellenar desde el texto»).
 * { calc, sure } · sure = se entiende sin duda: una sola dosis por kg, frecuencia clara (si es por día) y unidad conocida.
 */
export function calcFromText(text, { duration = '' } = {}) {
  const list = perKgInText(text);
  if (!list.length) return null;
  const x = list[0];
  const unit = cleanUnit(x.unit);
  const per = PER_OF[x.per];
  if (!unit || !per) return null;
  const freqs = freqHours(text);
  const mx = maxesInText(text);
  const calc = normCalc({ amount: { lo: x.lo, hi: x.hi }, unit, per, freqs, freq: freqs.length === 1 ? freqs[0] : freqs[freqs.length - 1] ?? null,
    maxDose: mx.maxDose, maxDay: mx.maxDay, duration: duration || durationIn(text) });
  if (!calc) return null;
  // sin duda: una sola dosis por kg en el texto, máximas claras y, si es por día, con frecuencia (para repartir en tomas)
  const sure = list.length === 1 && !mx.ambiguous && (per !== 'kg/día' || freqs.length > 0);
  return { calc, sure };
}
const durationIn = (text) => { const m = str(text).match(/durante\s+(\d+(?:\s*[-–]\s*\d+)?\s*(?:d[ií]as?|semanas?|meses?))/i); return m ? m[1] : ''; };

/** Descripción corta de un cálculo: «80–90 mg/kg/día cada 8 h, máx 1 g/toma» */
export function calcDesc(c) {
  if (!c) return '';
  const a = `${fmt(c.amount.lo)}${c.amount.hi > c.amount.lo ? `–${fmt(c.amount.hi)}` : ''} ${c.unit}${c.per === 'dosis fija' ? '' : `/${c.per}`}`;
  const f = c.per === 'kg/h' ? '' : c.freqs.length ? `cada ${c.freqs.map(fmt).join('-')} h` : '';
  const mx = [c.maxDose ? `máx ${c.maxDose}/toma` : '', c.maxDay ? `máx ${c.maxDay}/día` : ''].filter(Boolean).join(', ');
  return [[a, f].filter(Boolean).join(' '), mx].filter(Boolean).join(', ') + (c.duration ? ` durante ${c.duration}` : '');
}
/** Cálculo efectivo de una pauta: el campo calc, o perKg (v1.32.0), o el texto. null si no es por peso ni dosis fija con calc. */
export function calcOf(r) {
  if (!r) return null;
  const c = normCalc(r.calc);
  if (c) return { ...c, src: 'calc', auto: !!r.calcAuto };
  const pk = parseNum(r.perKg);
  if (pk > 0) {
    const freqs = freqHours(`${str(r.freq)} ${str(r.text)}`);
    const mx = parseAmount(r.max);
    return { ...normCalc({ amount: { lo: pk, hi: pk }, unit: r.perKgUnit || 'mg', per: 'kg/dosis', freqs, freq: freqs[freqs.length - 1],
      maxDose: mx ? `${mx.v} ${mx.unit}` : '', duration: r.duration }), src: 'perKg', auto: false };
  }
  if (r.calcAuto === false) return null; // quitado a mano en el editor
  const t = calcFromText(str(r.text) || str(r.dose), { duration: str(r.duration) });
  return t ? { ...t.calc, src: 'text', auto: true } : null;
}
export const needsKg = (c) => !!c && c.per !== 'dosis fija';

/** Presentaciones útiles para la calculadora: líquidos con concentración y formas sólidas con dosis por unidad */
export function presOptions(list) {
  const out = [];
  for (const p of (Array.isArray(list) ? list : [])) {
    const conc = concOf(p);
    if (conc) { out.push({ p, kind: 'liq', perMl: conc.perMl, unit: conc.unit }); continue; }
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
/** Cantidad por kg elegida: 'min' | 'mid' | 'max' o un número */
export function pickAmount(c, level = 'mid') {
  const { lo, hi } = c.amount;
  if (typeof level === 'number' && level >= lo && level <= hi) return level;
  return level === 'min' ? lo : level === 'max' ? hi : (lo + hi) / 2;
}
const toUnit = (txt, unit) => { const a = parseAmount(txt); if (!a) { const n = parseNum(txt); return n > 0 ? n : null; } return convert(a.v, a.unit === 'ui' ? 'UI' : a.unit, unit) ?? (unitKey(a.unit) === unitKey(unit) ? a.v : null); };
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Dosis por toma. opts = { kg, level, freq (h), pres (texto o opción de presOptions) }.
 * Devuelve null si falta el peso (cuando hace falta) o el cálculo no es válido:
 * { per, unit, amt, nDoses, perDoseRaw, perDose, perDayRaw, perDay, cappedDose, cappedDay, noMax, maxDose, maxDay,
 *   vol, volR, volHalf, units {n, exact, form, ok}, given, steps, freq }
 */
export function doseCalc(c, { kg = 0, level = 'mid', freq = null, pres = null } = {}) {
  c = c && c.amount ? c : normCalc(c);
  if (!c) return null;
  if (needsKg(c) && !validKg(kg)) return null;
  const unit = c.unit;
  const amt = pickAmount(c, level);
  const f = Number(freq) > 0 ? Number(freq) : c.freq || (c.freqs.length ? c.freqs[c.freqs.length - 1] : null);
  const nDoses = f ? 24 / f : null;
  const out = { per: c.per, unit, amt, freq: f, nDoses, cappedDose: false, cappedDay: false, steps: [] };
  const U = (n) => `${fmt(n)} ${unit}`;
  if (c.per === 'kg/h') {
    out.perHourRaw = amt * kg; out.perDoseRaw = out.perHourRaw;
    out.steps.push(`${fmt(amt)} ${unit}/kg/h × ${fmt(kg)} kg = ${U(out.perHourRaw)}/h`);
  } else if (c.per === 'kg/día') {
    if (!nDoses) return null;
    out.perDayRaw = amt * kg; out.perDoseRaw = out.perDayRaw / nDoses;
    out.steps.push(`${fmt(amt)} ${unit}/kg/día × ${fmt(kg)} kg = ${U(out.perDayRaw)}/día`, `÷ ${fmt(nDoses)} ${nDoses === 1 ? 'toma' : 'tomas'} = ${U(out.perDoseRaw)} cada ${fmt(f)} h`);
  } else if (c.per === 'kg/dosis') {
    out.perDoseRaw = amt * kg; out.perDayRaw = nDoses ? out.perDoseRaw * nDoses : null;
    out.steps.push(`${fmt(amt)} ${unit}/kg × ${fmt(kg)} kg = ${U(out.perDoseRaw)}${f ? ` cada ${fmt(f)} h` : ' por dosis'}`);
  } else {
    out.perDoseRaw = amt; out.perDayRaw = nDoses ? amt * nDoses : null;
    out.steps.push(`Dosis fija: ${U(amt)}${f ? ` cada ${fmt(f)} h` : ''}`);
  }
  let perDose = out.perDoseRaw;
  const maxDose = c.maxDose ? toUnit(c.maxDose, unit) : null;
  const maxDay = c.maxDay ? toUnit(c.maxDay, unit) : null;
  out.maxDose = maxDose; out.maxDay = maxDay;
  out.noMax = maxDose == null && maxDay == null;
  if (maxDose != null && perDose > maxDose + 1e-9) { perDose = maxDose; out.cappedDose = true; out.steps.push(`→ tope por ${c.per === 'kg/h' ? 'hora' : 'toma'}: ${U(maxDose)}`); }
  if (maxDay != null && nDoses && c.per !== 'kg/h' && perDose * nDoses > maxDay + 1e-9) { perDose = maxDay / nDoses; out.cappedDay = true; out.steps.push(`→ tope al día: ${U(maxDay)} ÷ ${fmt(nDoses)} = ${U(perDose)}`); }
  out.perDose = perDose;
  out.perDay = nDoses && c.per !== 'kg/h' ? perDose * nDoses : null;
  out.given = perDose;
  // Presentación: volumen (ml) o unidades (comprimidos…)
  const opt = typeof pres === 'string' ? presOptions([pres])[0] : pres;
  if (opt && opt.kind === 'liq' && unitKey(unit) !== 'ml') {
    const per = convert(opt.perMl, opt.unit, unit) ?? (unitKey(opt.unit) === unitKey(unit) ? opt.perMl : null);
    if (per > 0) {
      out.vol = perDose / per; out.volR = r1(out.vol);
      const h = Math.round(out.vol * 2) / 2;
      if (h > 0 && h !== out.volR && Math.abs(h - out.vol) / out.vol <= 0.05) out.volHalf = h;
      out.conc = opt.p;
      out.steps.push(`→ ${fmt(out.volR)} ml${c.per === 'kg/h' ? '/h' : ''} de ${opt.p}`);
    }
  } else if (opt && opt.kind === 'unit') {
    const per = convert(opt.amount, opt.unit, unit) ?? (unitKey(opt.unit) === unitKey(unit) ? opt.amount : null);
    if (per > 0 && c.per !== 'kg/h') {
      const exact = perDose / per;
      const step = opt.half ? 0.5 : 1;
      let n = Math.round(exact / step) * step;
      if (maxDose != null && n * per > maxDose + 1e-9) n = Math.floor(maxDose / per / step) * step; // nunca por encima del tope
      if (maxDay != null && nDoses && n * per * nDoses > maxDay + 1e-9) n = Math.floor(maxDay / nDoses / per / step) * step;
      const ok = n > 0 && Math.abs(n * per - perDose) / perDose <= 0.1;
      out.units = { n, exact, form: opt.form, half: opt.half, ok, each: per };
      if (ok) out.given = n * per; // si no cuadra (±10 %), se da la dosis en mg y se avisa: nunca se redondea a una dosis muy distinta
      out.conc = opt.p;
      out.steps.push(ok ? `→ ${unitsText(out.units)} de ${opt.p}` : `→ con ${opt.p} serían ${fmt(exact)} ${opt.form} (no cuadra)`);
    }
  }
  return out;
}
/** «1½ comp», «2 cáps», «½ comp» */
export function unitsText(u) {
  if (!u) return '';
  const whole = Math.floor(u.n), half = u.n - whole >= 0.5;
  const num = `${whole || ''}${half ? '½' : ''}` || '0';
  return `${num} ${u.form}`;
}
const freqTxt = (h) => (h ? `cada ${fmt(h)} h` : '');
/** Resultado principal: «5,3 ml (533 mg)» · «1½ comp (750 mg)» · «533 mg» · por hora: «12 mg/h (1,2 ml/h)» */
export function doseMain(x) {
  if (!x) return '';
  const u = x.unit, h = x.per === 'kg/h' ? '/h' : '';
  if (x.vol != null) return `${fmt(x.volR)} ml${h} (${fmt(x.perDose)} ${u}${h})`;
  if (x.units && x.units.ok) return `${unitsText(x.units)} (${fmt(x.given)} ${u})`;
  return `${fmt(x.perDose)} ${u}${h}`;
}
/** Línea para el informe: «Amoxicilina 250 mg/5 ml susp. oral: 5,3 ml (533 mg) VO cada 8 h durante 10 días — 80 mg/kg/día, peso 20 kg» */
export function calcLine(name, r, c, x, kg) {
  if (!x) return '';
  const head = [str(name).trim(), str(x.conc || '').trim()].filter(Boolean).join(' ');
  const route = str(r?.route).trim() || (/^(VO|IV|IM|SC|SL|VR|Intranasal|Nebulizado|Inhalada|Rectal)$/i.test(str(r?.type)) ? str(r.type) : '');
  const dur = str(c.duration || r?.duration).trim();
  const parts = [doseMain(x), route, x.per === 'kg/h' ? 'en perfusión' : freqTxt(x.freq), dur ? (/^\d/.test(dur) ? `durante ${dur}` : dur) : ''].filter(Boolean);
  const perTxt = c.per === 'dosis fija' ? '' : `${fmt(x.amt)} ${c.unit}/${c.per}`;
  const tail = [perTxt, needsKg(c) ? `peso ${fmt(kg)} kg` : ''].filter(Boolean).join(', ');
  const cap = x.cappedDose || x.cappedDay ? ' (limitado a la dosis máxima)' : '';
  return `${head}${head ? ': ' : ''}${parts.join(' ')}${tail ? ` — ${tail}` : ''}${cap}`;
}
/** Línea de una pauta con el peso y las opciones habituales (botón Copiar de la pauta, lineOf con kg) */
export function regCalcLine(name, r, kg, presentations = []) {
  const c = calcOf(r);
  if (!c || (needsKg(c) && !validKg(kg))) return '';
  const opts = presOptions(r?.pres ? [r.pres] : presentations);
  const x = doseCalc(c, { kg, freq: c.freq, pres: opts[0] || null });
  return x ? calcLine(name, r, c, x, kg) : '';
}
