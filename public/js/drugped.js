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
  if (!c) return '';
  const head = [str(name).trim(), str(r.pres).trim()].filter(Boolean).join(' ');
  const dur = str(r.duration).trim();
  const parts = [doseText(c), str(r.route).trim(), str(r.freq).trim(), dur ? (/^\d/.test(dur) ? `durante ${dur}` : dur) : ''].filter(Boolean);
  return `${head}${head ? ': ' : ''}${parts.join(' ')} — ${fmt(c.perKg)} ${c.unit}/kg, peso ${fmt(kg)} kg${c.capped ? ' (dosis máxima)' : ''}`;
}
