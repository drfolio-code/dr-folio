// Pruebas de aritmética de la calculadora (sin dosis clínicas reales: solo números de ejemplo).
// Ejecutar: node tools/tests/drugped.test.mjs
import assert from 'node:assert/strict';
import { freqHours, normCalc, calcFromText, calcOf, presOptions, doseCalc, doseMain, calcLine, unitsText, regCalcLine, pedCalc, concOf } from '../../public/js/drugped.js';

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('✓', name); };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

t('frecuencias del texto', () => {
  assert.deepEqual(freqHours('cada 8 h'), [8]);
  assert.deepEqual(freqHours('cada 6-8 h'), [6, 8]);
  assert.deepEqual(freqHours('c/12h'), [12]);
  assert.deepEqual(freqHours('3 veces al día'), [8]);
  assert.deepEqual(freqHours('cada 3-5 min'), []);
});
t('kg/día ÷ tomas', () => {
  const c = normCalc({ amount: { lo: 80 }, unit: 'mg', per: 'kg/día', freqs: [8, 12], freq: 8 });
  const x = doseCalc(c, { kg: 20 });
  near(x.perDayRaw, 1600); near(x.perDose, 1600 / 3); assert.equal(x.nDoses, 3);
  assert.equal(doseMain(x), '533 mg');
  const y = doseCalc(c, { kg: 20, freq: 12 }); near(y.perDose, 800);
});
t('kg/dosis', () => {
  const x = doseCalc(normCalc({ amount: { lo: 10 }, unit: 'mg', per: 'kg/dosis', freqs: [6], freq: 6 }), { kg: 12.5 });
  near(x.perDose, 125); near(x.perDay, 500);
});
t('rango: mínima / media / máxima', () => {
  const c = normCalc({ amount: { lo: 40, hi: 60 }, unit: 'mg', per: 'kg/día', freqs: [8], freq: 8 });
  near(doseCalc(c, { kg: 10, level: 'min' }).perDay, 400);
  near(doseCalc(c, { kg: 10, level: 'mid' }).perDay, 500);
  near(doseCalc(c, { kg: 10, level: 'max' }).perDay, 600);
  near(doseCalc(c, { kg: 10, level: 45 }).perDay, 450);
});
t('tope por toma', () => {
  const x = doseCalc(normCalc({ amount: { lo: 20 }, unit: 'mg', per: 'kg/dosis', freqs: [8], freq: 8, maxDose: '0,5 g' }), { kg: 40 });
  assert.equal(x.cappedDose, true); near(x.perDoseRaw, 800); near(x.perDose, 500);
});
t('tope por día', () => {
  const x = doseCalc(normCalc({ amount: { lo: 100 }, unit: 'mg', per: 'kg/día', freqs: [6], freq: 6, maxDay: '3 g' }), { kg: 50 });
  assert.equal(x.cappedDay, true); near(x.perDay, 3000); near(x.perDose, 750);
});
t('sin máxima → aviso', () => {
  const x = doseCalc(normCalc({ amount: { lo: 1 }, unit: 'mg', per: 'kg/dosis' }), { kg: 10 });
  assert.equal(x.noMax, true);
});
t('mg/ml y mg/5 ml, redondeo a 0,1 y a 0,5 ml', () => {
  const c = normCalc({ amount: { lo: 80 }, unit: 'mg', per: 'kg/día', freqs: [8], freq: 8 });
  const x = doseCalc(c, { kg: 20, pres: '250 mg/5 ml susp. oral' });
  near(x.vol, (1600 / 3) / 50); assert.equal(x.volR, 10.7); assert.equal(x.volHalf, 10.5);
  const y = doseCalc(normCalc({ amount: { lo: 15 }, unit: 'mg', per: 'kg/dosis', freqs: [6] }), { kg: 20, pres: '100 mg/ml sol. oral' });
  assert.equal(y.volR, 3); assert.equal(y.volHalf, undefined);
  assert.equal(doseMain(y), '3 ml (300 mg)');
});
t('mcg ↔ mg', () => {
  const x = doseCalc(normCalc({ amount: { lo: 200 }, unit: 'mcg', per: 'kg/dosis' }), { kg: 10, pres: '1 mg/ml amp' });
  near(x.perDose, 2000); near(x.vol, 2);
  const y = doseCalc(normCalc({ amount: { lo: 0.1 }, unit: 'mg', per: 'kg/dosis', maxDose: '500 mcg' }), { kg: 10 });
  assert.equal(y.cappedDose, true); near(y.perDose, 0.5);
});
t('comprimidos enteros y medios', () => {
  const c = normCalc({ amount: { lo: 15 }, unit: 'mg', per: 'kg/dosis', freqs: [8] });
  const x = doseCalc(c, { kg: 50, pres: '500 mg comp.' }); // 750 mg → 1½ comp
  assert.equal(x.units.n, 1.5); assert.equal(x.units.ok, true); assert.equal(unitsText(x.units), '1½ comp');
  const y = doseCalc(c, { kg: 50, pres: '500 mg cáps.' }); // cápsulas: sin medias → 2 (1000 mg, no cuadra)
  assert.equal(y.units.n, 2); assert.equal(y.units.ok, false); assert.equal(doseMain(y), '750 mg'); // no cuadra: se da en mg
  const z = doseCalc(c, { kg: 20, pres: '500 mg comp.' }); // 300 mg → ½ comp (250), no cuadra (17 %)
  assert.equal(z.units.n, 0.5); assert.equal(z.units.ok, false);
});
t('comprimidos: nunca por encima del tope', () => {
  const c = normCalc({ amount: { lo: 30 }, unit: 'mg', per: 'kg/dosis', freqs: [8], maxDose: '700 mg' });
  const x = doseCalc(c, { kg: 50, pres: '500 mg comp.' }); // 1500 → tope 700 → 1 comp (no 1½)
  assert.equal(x.perDose, 700); assert.equal(x.units.n, 1);
});
t('sin peso y sin concentración', () => {
  const c = normCalc({ amount: { lo: 10 }, unit: 'mg', per: 'kg/dosis' });
  assert.equal(doseCalc(c, { kg: 0 }), null);
  const x = doseCalc(c, { kg: 10, pres: 'colirio' }); assert.equal(x.vol, undefined); assert.equal(x.units, undefined);
  assert.ok(doseCalc(normCalc({ amount: { lo: 500 }, unit: 'mg', per: 'dosis fija', freqs: [8] }), { kg: 0 }));
});
t('kg/día sin frecuencia → no se calcula', () => {
  assert.equal(doseCalc(normCalc({ amount: { lo: 10 }, unit: 'mg', per: 'kg/día' }), { kg: 10 }), null);
});
t('kg/h', () => {
  const x = doseCalc(normCalc({ amount: { lo: 0.1 }, unit: 'mg', per: 'kg/h' }), { kg: 30, pres: '1 mg/ml' });
  near(x.perDose, 3); near(x.vol, 3); assert.equal(doseMain(x), '3 ml/h (3 mg/h)');
});
t('lectura del texto (sin duda / con duda)', () => {
  const a = calcFromText('80-90 mg/kg/día cada 8 h durante 10 días');
  assert.equal(a.sure, true); assert.deepEqual(a.calc.amount, { lo: 80, hi: 90 }); assert.equal(a.calc.per, 'kg/día'); assert.equal(a.calc.freq, 8); assert.equal(a.calc.duration, '10 días');
  assert.equal(calcFromText('50 mg/kg/día').sure, false); // por día sin frecuencia
  assert.equal(calcFromText('10 mg/kg/dosis o 20 mg/kg/día cada 8 h').sure, false); // dos dosis
  const b = calcFromText('50 mg/kg/día cada 12 h, máx 1 g/dosis'); assert.equal(b.calc.maxDose, '1 g');
  assert.equal(calcFromText('20 mg/kg cada 8 h, máx 1 g').calc.maxDose, undefined); // máx sin «por toma/día»: no se supone
  assert.equal(calcFromText('Ver tabla'), null);
});
t('calcOf: calc > perKg > texto', () => {
  assert.equal(calcOf({ calc: { amount: { lo: 5 }, unit: 'mg', per: 'kg/dosis' }, perKg: '9' }).amount.lo, 5);
  const p = calcOf({ perKg: '15', perKgUnit: 'mg', max: '1 g', freq: 'cada 6 h' });
  assert.equal(p.per, 'kg/dosis'); assert.equal(p.maxDose, '1 g'); assert.equal(p.freq, 6);
  assert.equal(calcOf({ text: '10 mg/kg/dosis cada 8 h' }).src, 'text');
});
t('línea para el informe', () => {
  const r = { route: 'VO', calc: { amount: { lo: 80 }, unit: 'mg', per: 'kg/día', freqs: [8], freq: 8, duration: '10 días' } };
  const c = calcOf(r);
  const x = doseCalc(c, { kg: 20, pres: '500 mg/5 ml susp. oral' });
  assert.equal(calcLine('Amoxicilina', r, c, x, 20), 'Amoxicilina 500 mg/5 ml susp. oral: 5,3 ml (533 mg) VO cada 8 h durante 10 días — 80 mg/kg/día, peso 20 kg');
  assert.ok(regCalcLine('X', { perKg: '15', max: '100 mg', freq: 'cada 6 h' }, 20).endsWith('(limitado a la dosis máxima)'));
});
t('compatibilidad v1.32.0 (pedCalc, concOf)', () => {
  const c = pedCalc({ perKg: '15', perKgUnit: 'mg', max: '1 g' }, 20, '100 mg/ml'); near(c.dose, 300); near(c.vol, 3);
  assert.deepEqual(concOf('1 g/10 ml'), { perMl: 0.1, unit: 'g' });
});
t('opciones de presentación', () => {
  const o = presOptions(['250 mg/5 ml susp.', '500 mg comp.', '1 g sobres', 'Crema 2 %']);
  assert.deepEqual(o.map((x) => x.kind), ['liq', 'unit', 'unit']);
  assert.equal(o[2].amount, 1); assert.equal(o[2].unit, 'g');
});
console.log(`\n${n} pruebas correctas`);
