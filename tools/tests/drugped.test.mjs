// Pruebas de aritmética de la calculadora (sin dosis clínicas reales: solo números de ejemplo).
// Ejecutar: node tools/tests/drugped.test.mjs
import assert from 'node:assert/strict';
import { freqHours, normCalc, calcFromText, calcsFromText, calcListOf, calcOf, noCalcReason, presOptions, doseCalc, doseMain, doseShort, calcLine, unitsText, regCalcLine, pedCalc, concOf, rankPres, bracketFor } from '../../public/js/drugped.js';

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
t('kg/día sin frecuencia → total del día y se pide la frecuencia', () => {
  const x = doseCalc(normCalc({ amount: { lo: 10 }, unit: 'mg', per: 'kg/día' }), { kg: 10 });
  assert.equal(x.needFreq, true); near(x.perDay, 100); assert.equal(x.perDose, null); assert.equal(doseMain(x), '100 mg/día');
  near(doseCalc(normCalc({ amount: { lo: 10 }, unit: 'mg', per: 'kg/día' }), { kg: 10, freq: 12 }).perDose, 50);
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
  assert.equal(calcLine('Amoxicilina', r, c, x, 20), 'Amoxicilina 500 mg/5 ml susp. oral: 5,3 ml (533 mg) VO cada 8 h durante 10 días — 80 mg/kg/día, 20 kg');
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
// ---------- v1.39.0: textos reales (Guía de Aragón y plantilla) ----------
const one = (t, o) => { const l = calcsFromText(t, o); assert.equal(l.length, 1, `${t} → ${l.length}`); return l[0].calc; };
t('lector: variantes de «por kg» y de frecuencia', () => {
  assert.equal(one('10 mg/kg/8 h').per, 'kg/dosis'); assert.deepEqual(one('10 mg/kg/8 h').freqs, [8]);
  assert.equal(one('20 mg/kg/24 h').per, 'kg/día');
  assert.equal(one('15 mg por kg cada 6 h').per, 'kg/dosis');
  assert.equal(one('50 mg/kg y día en 2 dosis').per, 'kg/día'); assert.deepEqual(one('50 mg/kg y día en 2 dosis').freqs, [12]);
  assert.deepEqual(one('40-50 mg/kg/día repartido en 3 tomas cada 8 h durante 5-7 días').freqs, [8]);
  assert.deepEqual(one('30 mg/kg al día en 2-3 dosis').freqs, [8, 12]);
  assert.deepEqual(freqHours('50-100 mg en 1 ó 2 dosis al día'), [12, 24]);
  assert.deepEqual(freqHours('1 vez al día'), [24]);
  assert.deepEqual(freqHours('cada 6-8 horas'), [6, 8]);
  assert.deepEqual(freqHours('c/8h'), [8]);
  assert.deepEqual(one('40 a 50 mg/kg/día').amount, { lo: 40, hi: 50 });
  assert.equal(one('0,15-0,6 mg/kg/dosis').amount.lo, 0.15);
  const iv = one('200 μg/kg (toma única)'); assert.equal(iv.unit, 'mcg'); assert.equal(iv.once, true);
  assert.equal(one('0,1 UI/kg/h').per, 'kg/h'); assert.equal(one('0,1 UI/kg/h').unit, 'UI');
  assert.equal(one('5-20 µg/kg/min').per, 'kg/min');
  assert.equal(one('2 gotas/kg/día').unit, 'gotas');
  assert.equal(one('1,5 mg/kg/toma').per, 'kg/dosis');
});
t('frecuencia no indicada: todas permitidas, ninguna marcada; por día → total y elegir', () => {
  const c = one('60 mg/kg/día'); assert.deepEqual(c.freqs, []); assert.equal(c.freq, null);
  const x = doseCalc(c, { kg: 20 }); assert.equal(x.needFreq, true); near(x.perDay, 1200);
  near(doseCalc(c, { kg: 20, freq: 6 }).perDose, 300);
});
t('máximas: solo las que dice el texto', () => {
  const c = one('Dosis: 0,6 mg/kg (máximo 12 mg) y repetir misma dosis a las 24 horas'); assert.equal(c.maxDose, '12 mg');
  near(doseCalc(c, { kg: 30 }).perDose, 12);
  assert.equal(one('10 mg/kg/día (máx. 500 mg/día)').maxDay, '500 mg');
  assert.equal(one('20 mg/kg cada 8 h, máx 1 g').maxDose, undefined); // con frecuencia y sin «por toma/día»: no se supone
  assert.equal(one('20-40 mg/kg', { max: '3 g; no en embarazo' }).maxDose, '3 g'); // campo «máx» de la plantilla
  assert.equal(one('1 mg/kg', { freqText: 'cada 12 h', max: 'ajustar si FG < 30' }).maxDose, undefined);
  assert.equal(one('2,5-5 mg/kg', { max: '10 mg/kg/dosis' }).maxDose, undefined); // máxima por kg: no se usa como tope
});
t('varias indicaciones en un texto → varias', () => {
  const l = calcsFromText('Mayores de 6 meses a 10 mg/kg/día (máx. 500 mg/día) y después 4 días más a 5 mg/kg/día (máx. 250 mg/día)');
  assert.equal(l.length, 2); assert.equal(l[0].label, 'Mayores de 6 meses'); assert.equal(l[0].calc.maxDay, '500 mg'); assert.equal(l[1].calc.maxDay, '250 mg');
  const n = calcsFromText('150 mg/kg en 1 h, 50 mg/kg en 4 h, 100 mg/kg en 16 h'); assert.equal(n.length, 3);
  const tx = calcsFromText('15 mg/kg en 10 min + 2 mg/kg/h 8 h'); assert.deepEqual(tx.map((x) => x.calc.per), ['kg/dosis', 'kg/h']);
  const r = { id: 'a', text: '150 mg/kg en 1 h, 50 mg/kg en 4 h' };
  assert.deepEqual(calcListOf(r).map((x) => x.key), ['a', 'a~1']);
});
t('tramos de peso → brackets', () => {
  const c = one('< 10 kg: 2,5 ml; 10-20 kg: 5 ml; > 20 kg: 10 ml');
  assert.equal(c.per, 'tramos'); assert.equal(c.brackets.length, 3);
  assert.equal(doseCalc(c, { kg: 9 }).perDose, 2.5); assert.equal(doseCalc(c, { kg: 10 }).perDose, 5); assert.equal(doseCalc(c, { kg: 20 }).perDose, 5); assert.equal(doseCalc(c, { kg: 21 }).perDose, 10);
  const m = one('10 mg (> 40 kg); 5 mg (13-40 kg)');
  assert.equal(doseCalc(m, { kg: 30 }).perDose, 5); assert.equal(doseCalc(m, { kg: 50 }).perDose, 10); assert.equal(doseCalc(m, { kg: 8 }).noBracket, true);
  assert.equal(bracketFor(m, 40).dose, 5);
});
t('sin forma de calcular: motivo', () => {
  assert.match(noCalcReason({ text: '20 mg/m2 cada 12 h' }), /superficie/);
  assert.match(noCalcReason({ text: '< 2 años: 2,5 ml; 2-5 años: 5 ml' }), /edad/);
  assert.match(noCalcReason({ text: 'Ver «Tablas por peso».' }), /tabla/);
  assert.equal(noCalcReason({ text: '1 g cada 8 h' }), '');
});
t('dosis práctica: jeringa y comprimidos con diferencia', () => {
  const c = normCalc({ amount: { lo: 80 }, unit: 'mg', per: 'kg/día', freqs: [8], freq: 8 });
  const x = doseCalc(c, { kg: 20, pres: '250 mg/5 ml susp.' }); assert.equal(x.volR, 10.7); assert.equal(x.volHalf, 10.5); assert.ok(x.volDiff < 0);
  const y = doseCalc(normCalc({ amount: { lo: 15 }, unit: 'mg', per: 'kg/dosis', freqs: [8] }), { kg: 48, pres: '500 mg comp.' });
  assert.equal(y.units.n, 1.5); assert.ok(Math.abs(y.units.diff - 4.2) < 0.1); // 750 vs 720 mg
  assert.equal(doseShort(x), '10,7 ml c/8 h');
});
t('presentación más fácil de medir y la preferida', () => {
  const c = normCalc({ amount: { lo: 15 }, unit: 'mg', per: 'kg/dosis', freqs: [6] });
  const o = presOptions(['1 g sobres', '100 mg/ml sol. oral', '500 mg comp.']);
  assert.equal(rankPres(c, o, { kg: 20 })[0].p, '100 mg/ml sol. oral');   // 3 ml
  assert.equal(rankPres({ ...c, presPref: '1 g sobres' }, o, { kg: 20 })[0].p, '1 g sobres');
});
t('habitual de un rango', () => {
  const c = normCalc({ amount: { lo: 40, hi: 90, usual: 80 }, unit: 'mg', per: 'kg/día', freqs: [8], freq: 8 });
  near(doseCalc(c, { kg: 10 }).perDay, 800); near(doseCalc(c, { kg: 10, level: 'mid' }).perDay, 650);
});
t('perfusión por minuto', () => {
  const x = doseCalc(normCalc({ amount: { lo: 0.1 }, unit: 'mcg', per: 'kg/min' }), { kg: 70, pres: '4 mg/50 ml' });
  near(x.perDose, 7); near(x.perHour, 420); near(x.vol, 420 / 80);
});
console.log(`\n${n} pruebas correctas`);
