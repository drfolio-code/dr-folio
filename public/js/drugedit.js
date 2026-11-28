// Edición fácil del Vademécum (v1.29.0): cada sección de la ficha tiene un lápiz que abre su propio editor
// (modal en el ordenador, hoja desde abajo en el móvil) solo con sus campos. Al guardar, aviso con «Deshacer».
// «Editar todo» (el formulario completo de antes) sigue en el ⋯ de la ficha. Datos: drugbody.js.
import { store } from './store.js';
import { el, norm } from './util.js';
import { toast, modal, confirm, undoToast } from './ui.js';
import { icon } from './icons.js';
import { REG_FIELDS, lineOf, hasDetail, mergeList, presBrandsOf, profOf } from './drugbody.js';
import { FLUIDS, regType, typeSlug } from './chuletario.js';
import { liveTags, tagChip, newTag, EXAMPLES } from './drugtags.js';
import { fixRegIds, resFileIds } from './drugres.js';

let api = null; // { ctx, cur, refresh, regId, write, resEditor, cleanResList, purgeNew }
export function initDrugEdit(a) { api = a; }

const str = (x) => (x == null ? '' : String(x));
const clone = (x) => JSON.parse(JSON.stringify(x ?? null));
const one = (x) => str(x).replace(/\s+/g, ' ').trim();
const lines = (t) => str(t).split('\n').map(one).filter(Boolean);
const csv = (t) => str(t).split(/[,;\n]+/).map((v) => one(v.replace(/[®™]/g, ''))).filter(Boolean);
const QUICK_TYPES = ['Bolo', 'Perfusión', 'IV', 'IM', 'SC', 'VO', 'Intranasal', 'Nebulizado'];

/**
 * Guarda unos campos de la ficha y ofrece «Deshacer» unos segundos (vuelve a dejar los campos como estaban).
 * dropLater = PDF que ya no usa la ficha: se borran solo si no se deshace.
 */
export function saveFields(id, patch, msg = 'Guardado ✓', { dropLater = [] } = {}) {
  const d = store.drugs.get(id);
  if (!d) return;
  const before = {};
  for (const k of Object.keys(patch)) before[k] = d[k] === undefined ? null : clone(d[k]);
  api.write(id, { ...patch, updatedAt: Date.now() });
  api.refresh(id);
  let undone = false;
  if (dropLater.length) setTimeout(() => { if (!undone) api.ctx.dropFiles(dropLater); }, 9000);
  undoToast(msg, () => {
    undone = true;
    if (!store.drugs.get(id)) return;
    api.write(id, { ...before, updatedAt: Date.now() });
    api.refresh(id);
    toast('Deshecho ✓', 'ok', 1600);
  }, 8000);
}

/** Modal de un editor de sección (hoja desde abajo en el móvil) */
function sheet(title, body, { onSave, danger = null, saveLabel = 'Guardar', onOpen, autofocus } = {}) {
  const actions = [];
  if (danger) actions.push({ label: danger.label, danger: true, value: 'del', onClick: danger.onClick });
  actions.push({ label: 'Cancelar' }, { label: saveLabel, primary: true, value: 'ok', onClick: onSave });
  // En el móvil no se abre el teclado solo (casi siempre es para retocar un dato suelto)
  return modal({ title, body, cls: 'dsheet', actions, onOpen, autofocus: autofocus ?? !matchMedia('(pointer: coarse)').matches });
}

// ====================== Nombre, marcas y fuente ======================
export async function editHead(id, { isNew = false } = {}) {
  const d = store.drugs.get(id);
  if (!d) return;
  const name = el('input', { type: 'text', maxlength: 150, placeholder: 'Principio activo (p. ej. Dexketoprofeno)', autocomplete: 'off' });
  name.value = d.name || '';
  const brands = el('textarea', { rows: 2, placeholder: 'Enantyum, Quiralam… (separados por comas)' });
  brands.value = (d.brands || []).join(', ');
  const st = el('input', { type: 'text', maxlength: 200, placeholder: 'Fuente (p. ej. Chuletario de Urgencias)' });
  st.value = d.source?.text || '';
  const su = el('input', { type: 'url', maxlength: 500, placeholder: 'https://…', inputmode: 'url' });
  su.value = d.source?.url || '';
  const r = await sheet(isNew ? 'Nuevo fármaco' : 'Nombre y nombres comerciales', [
    el('label', { class: 'rf' }, 'Principio activo', name),
    el('label', { class: 'rf' }, 'Nombres comerciales', brands),
    el('details', { class: 'reg-more', open: !!(d.source?.text || d.source?.url) }, el('summary', {}, 'Fuente (opcional)'),
      el('label', { class: 'rf' }, 'Fuente', st), el('label', { class: 'rf' }, 'Enlace', su))
  ], { saveLabel: isNew ? 'Crear' : 'Guardar', onSave: () => { if (!one(name.value)) { toast('Escribe el principio activo', 'error'); name.focus(); return false; } return true; } });
  if (r !== 'ok') { if (isNew) api.purgeNew(id); return; }
  const list = csv(brands.value);
  const [next] = mergeList([], list);
  const url = /^https?:\/\//i.test(su.value.trim()) ? su.value.trim() : '';
  const patch = { name: one(name.value), brands: next, source: { text: one(st.value), url } };
  // marcas quitadas: dejan de estar asignadas a sus presentaciones
  if ((d.presBrands || []).length) patch.presBrands = d.presBrands.map((e) => ({ p: e.p, b: e.b.filter((b) => next.includes(b)) })).filter((e) => e.b.length);
  if (isNew) { api.write(id, { ...patch, updatedAt: Date.now() }); api.refresh(id); toast(`Ficha «${patch.name}» creada ✓`, 'ok'); return; }
  saveFields(id, patch);
}

// ====================== Etiquetas (v1.31.0) ======================
export async function editTags(id) {
  const d = store.drugs.get(id);
  if (!d) return;
  const on = new Set(d.tags || []);
  const row = el('div', { class: 'tag-pick' });
  const render = () => row.replaceChildren(...liveTags(profOf(d)).map((t) => tagChip(t, {
    class: `toggle ${on.has(t.id) ? 'on' : ''}`, 'aria-pressed': String(on.has(t.id)),
    onclick: () => { if (on.has(t.id)) on.delete(t.id); else on.add(t.id); render(); }
  }, on.has(t.id) ? icon('check') : null, t.name)),
  el('button', { class: 'chip', type: 'button', onclick: async () => { const nid = await newTag(profOf(d)); if (nid) { on.add(nid); render(); } } }, '＋ Nueva'));
  render();
  if (await sheet('Etiquetas', [el('p', { class: 'muted small' }, `Toca para poner o quitar. Ejemplos: ${EXAMPLES}. Se gestionan en Vademécum ⋯ → «Etiquetas…».`), row]) !== 'ok') return;
  const order = liveTags(profOf(d)).map((t) => t.id);
  saveFields(id, { tags: order.filter((t) => on.has(t)) });
}

// ====================== Presentaciones ======================
export async function editPres(id, { addNew = false } = {}) {
  const d = store.drugs.get(id);
  if (!d) return;
  const brands = d.brands || [];
  const rows = (d.presentations || []).map((p) => ({ p, b: [...presBrandsOf(d, p)] }));
  if (addNew || !rows.length) rows.push({ p: '', b: [] });
  const box = el('div', { class: 'pres-rows', 'data-own-enter': '1' });
  const render = (focusLast = false) => {
    box.replaceChildren(...rows.map((row, i) => {
      const inp = el('input', { type: 'text', value: row.p, placeholder: 'p. ej. 37,5/325 mg comp · 1 amp = 1 mL = 1 mg', maxlength: 150, autocomplete: 'off', 'aria-label': `Presentación ${i + 1}` });
      inp.addEventListener('input', () => { row.p = inp.value; });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); rows.push({ p: '', b: [] }); render(true); } });
      const chips = brands.map((b) => {
        const onB = row.b.includes(b);
        return el('button', { type: 'button', class: `chip toggle ${onB ? 'on' : ''}`, 'aria-pressed': String(onB),
          onclick: () => { const k = row.b.indexOf(b); if (k >= 0) row.b.splice(k, 1); else row.b.push(b); render(); } }, onB ? icon('check') : null, b);
      });
      const mv = (dir) => { [rows[i], rows[i + dir]] = [rows[i + dir], rows[i]]; render(); };
      return el('div', { class: 'pres-row' },
        el('div', { class: 'pres-row-top' }, inp,
          i > 0 ? el('button', { class: 'icon-btn', type: 'button', title: 'Subir', 'aria-label': 'Subir', onclick: () => mv(-1) }, icon('arrow-up')) : null,
          el('button', { class: 'icon-btn', type: 'button', title: 'Quitar', 'aria-label': 'Quitar esta presentación', onclick: () => { rows.splice(i, 1); render(); } }, icon('x'))),
        brands.length ? el('div', { class: 'pres-row-brands' }, el('span', { class: 'muted small' }, 'Marca:'), ...chips) : null);
    }));
    if (focusLast) { const ins = box.querySelectorAll('input'); ins[ins.length - 1]?.focus(); }
  };
  render();
  const r = await sheet('Presentaciones', [box,
    el('button', { class: 'btn sm', type: 'button', onclick: () => { rows.push({ p: '', b: [] }); render(true); } }, '＋ Añadir presentación'),
    brands.length ? null : el('p', { class: 'muted small' }, 'Para indicar de qué marca es cada presentación, añade antes los nombres comerciales (lápiz junto al nombre).')
  ], { onOpen: (b) => { if (addNew) setTimeout(() => { const ins = b.querySelectorAll('.pres-row input'); ins[ins.length - 1]?.focus(); }, 60); } });
  if (r !== 'ok') return;
  const clean = rows.map((x) => ({ p: one(x.p), b: x.b.filter((b) => brands.includes(b)) })).filter((x) => x.p);
  const [presentations] = mergeList([], clean.map((x) => x.p));
  saveFields(id, { presentations, presBrands: clean.filter((x) => x.b.length) });
}

// ====================== Una pauta (indicación) ======================
/** Editor de una sola pauta. regIdx = posición; null = nueva. Vista previa en directo de la línea que se copia. */
export async function editReg(id, regIdx = null) {
  const d = store.drugs.get(id);
  if (!d) return;
  const isNew = regIdx == null;
  const r = isNew ? { id: api.regId(), indication: '', type: '', text: '', pres: '', route: '', dose: '', freq: '', duration: '', max: '', line: '', lineAuto: true }
    : clone(d.regimens[regIdx]);
  if (!r) return;
  const name = d.name || '';
  const preview = el('div', { class: 'line-preview', 'aria-live': 'polite' });
  const lineBox = el('textarea', { class: 'reg-line-edit hidden', rows: 2, placeholder: 'Línea para el informe' });
  const auto = el('button', { class: 'btn sm', type: 'button' });
  const typeRow = el('div', { class: 'type-quick' });
  const extra = api.extraFields?.(r, () => sync()) || null; // pediátrico (fase 5)
  const sync = () => {
    const custom = r.lineAuto === false;
    const line = custom ? str(r.line) : api.genLine(name, r);
    preview.replaceChildren(el('span', { class: 'lp-lbl' }, icon('copy'), custom ? ' Se copiará (retocada a mano):' : ' Se copiará:'), el('span', { class: 'lp-txt' }, line || '—'));
    lineBox.classList.toggle('hidden', !custom);
    auto.textContent = custom ? '↺ Volver a la automática' : '✎ Retocar a mano';
    for (const b of typeRow.children) b.classList.toggle('on', b.dataset.t === r.type);
  };
  auto.addEventListener('click', () => {
    if (r.lineAuto === false) { r.lineAuto = true; r.line = ''; }
    else { r.lineAuto = false; r.line = api.genLine(name, r); lineBox.value = r.line; setTimeout(() => lineBox.focus(), 0); }
    sync();
  });
  lineBox.value = r.lineAuto === false ? str(r.line) : '';
  lineBox.addEventListener('input', () => { r.line = lineBox.value; sync(); });
  const mk = ([k, label, ph], attrs = {}) => {
    const inp = el('input', { type: 'text', value: r[k] || '', placeholder: ph, autocomplete: 'off', maxlength: k === 'indication' ? 200 : 120, ...attrs });
    inp.addEventListener('input', () => { r[k] = inp.value; sync(); });
    return el('label', { class: `rf rf-${k}` }, label, inp);
  };
  const typeIn = el('input', { type: 'text', value: r.type || '', placeholder: 'Bolo, Perfusión, IM…', list: 'drug-type-dl', autocomplete: 'off', maxlength: 30 });
  typeIn.addEventListener('input', () => { r.type = regType(typeIn.value) || typeIn.value.trim(); sync(); });
  typeRow.append(...QUICK_TYPES.map((t) => el('button', { type: 'button', class: `reg-type t-${typeSlug(t)} tq`, 'data-t': t,
    onclick: () => { r.type = r.type === t ? '' : t; typeIn.value = r.type; sync(); } }, t)));
  const textIn = el('textarea', { rows: 2, placeholder: 'Dosis tal cual (p. ej. 0,6-1 mg IV cada 3-5 min, máx 3 mg)' });
  textIn.value = r.text || '';
  textIn.addEventListener('input', () => { r.text = textIn.value; sync(); });
  const dl = el('datalist', { id: 'dedit-pres-dl' }, ...(d.presentations || []).map((p) => el('option', { value: p })));
  const [indF, presF, ...rest] = REG_FIELDS;
  sync();
  const res = await sheet(isNew ? 'Nueva indicación' : 'Editar indicación', [
    el('div', { class: 'line-box' }, preview, lineBox, el('div', { class: 'reg-actions' }, auto)),
    mk(indF),
    el('div', { class: 'rf' }, 'Tipo', typeRow, typeIn),
    el('label', { class: 'rf' }, hasDetail(r) && !str(r.text).trim() ? 'Dosis (texto; esta pauta usa los campos detallados de abajo)' : 'Dosis', textIn),
    extra,
    mk(presF, { list: 'dedit-pres-dl' }), dl,
    el('details', { class: 'reg-more', open: hasDetail(r) || !!extra }, el('summary', {}, 'Campos detallados (opcional): vía, dosis, frecuencia, máx…'),
      el('div', { class: 'reg-grid' }, rest.map((f) => mk(f, f[0] === 'route' ? { list: 'drug-route-dl' } : f[0] === 'freq' ? { list: 'drug-freq-dl' } : {}))))
  ], {
    autofocus: isNew ? undefined : false,
    saveLabel: isNew ? 'Añadir' : 'Guardar',
    danger: isNew ? null : { label: 'Eliminar', onClick: async () => confirm('Eliminar indicación', `¿Eliminar «${d.regimens[regIdx].indication || 'esta pauta'}»? Podrás deshacerlo.`, { okLabel: 'Eliminar', danger: true }) },
    onSave: () => { if (!one(r.indication) && !one(r.text) && !hasDetail(r) && !api.hasExtra?.(r)) { toast('Escribe al menos la indicación o la dosis', 'error'); return false; } return true; }
  });
  const cur = store.drugs.get(id);
  if (!cur) return;
  const regs = clone(cur.regimens || []);
  if (res === 'del') {
    const i = regs.findIndex((x) => x.id === r.id);
    if (i < 0) return;
    regs.splice(i, 1);
    saveFields(id, { regimens: regs, ...((cur.resources || []).length ? { resources: fixRegIds(cur.resources, regs) } : {}) }, 'Indicación eliminada');
    return;
  }
  if (res !== 'ok') return;
  const out = { ...r, indication: one(r.indication), text: str(r.text).trim(), line: r.lineAuto === false ? str(r.line) : '' };
  const i = regs.findIndex((x) => x.id === r.id);
  if (i >= 0) regs[i] = out; else regs.push(out);
  saveFields(id, { regimens: regs }, isNew ? 'Indicación añadida ✓' : 'Guardado ✓');
}

/** Lápiz de la sección Indicaciones: ordenar, quitar o abrir cada una */
export async function editRegs(id) {
  const d = store.drugs.get(id);
  if (!d) return;
  const regs = clone(d.regimens || []);
  const box = el('div', { class: 'regs-order' });
  let openIdx = null;
  const render = () => box.replaceChildren(...(regs.length ? regs.map((r, i) => el('div', { class: `ro-row reg t-${typeSlug(r.type || '')}` },
    el('div', { class: 'ro-txt' }, el('b', {}, r.indication || `Indicación ${i + 1}`), el('span', { class: 'muted small' }, ` ${[r.type, str(r.text).slice(0, 70)].filter(Boolean).join(' · ')}`)),
    i > 0 ? el('button', { class: 'icon-btn', type: 'button', title: 'Subir', 'aria-label': 'Subir', onclick: () => { [regs[i - 1], regs[i]] = [regs[i], regs[i - 1]]; render(); } }, icon('arrow-up')) : null,
    i < regs.length - 1 ? el('button', { class: 'icon-btn', type: 'button', title: 'Bajar', 'aria-label': 'Bajar', onclick: () => { [regs[i + 1], regs[i]] = [regs[i], regs[i + 1]]; render(); } }, icon('arrow-down')) : null,
    el('button', { class: 'icon-btn', type: 'button', title: 'Editar', 'aria-label': 'Editar esta indicación', onclick: (e) => { openIdx = r.id; e.currentTarget.closest('.modal').querySelector('.modal-foot .btn.primary').click(); } }, icon('pencil')),
    el('button', { class: 'icon-btn', type: 'button', title: 'Quitar', 'aria-label': 'Quitar esta indicación', onclick: () => { regs.splice(i, 1); render(); } }, icon('trash-2'))))
    : [el('p', { class: 'muted small' }, 'Sin indicaciones.')]));
  render();
  const res = await sheet('Indicaciones', [el('p', { class: 'muted small' }, 'Ordena con las flechas, quita las que sobren o toca el lápiz para editar una.'), box,
    el('button', { class: 'btn sm', type: 'button', onclick: (e) => { openIdx = '__new'; e.currentTarget.closest('.modal').querySelector('.modal-foot .btn.primary').click(); } }, '＋ Añadir indicación')]);
  if (res !== 'ok') return;
  const cur = store.drugs.get(id);
  const changed = JSON.stringify(regs) !== JSON.stringify(cur.regimens || []);
  if (changed) saveFields(id, { regimens: regs, ...((cur.resources || []).length ? { resources: fixRegIds(cur.resources, regs) } : {}) });
  if (openIdx === '__new') editReg(id, null);
  else if (openIdx) { const k = regs.findIndex((x) => x.id === openIdx); if (k >= 0) editReg(id, k); }
}

// ====================== Listas: observaciones, contraindicaciones, sueros y compatibilidad ======================
const LIST_TITLES = { observations: 'Observaciones', contraindications: 'Contraindicaciones' };
export async function editList(id, k) {
  const d = store.drugs.get(id);
  if (!d) return;
  if (k === 'compat') return editCompat(id);
  const ta = el('textarea', { rows: 8, placeholder: 'Una por línea' });
  ta.value = (d[k] || []).join('\n');
  if (await sheet(LIST_TITLES[k], [el('label', { class: 'rf' }, el('span', { class: 'muted small' }, 'Una por línea'), ta)]) !== 'ok') return;
  saveFields(id, { [k]: lines(ta.value) });
}
async function editCompat(id) {
  const d = store.drugs.get(id);
  const fl = el('input', { type: 'text', list: 'drug-fluid-dl', placeholder: 'SSF, SG5 %… (separados por comas)', autocomplete: 'off' });
  fl.value = (d.fluids || []).join(', ');
  const quick = el('div', { class: 'chips' }, ...FLUIDS.map((f) => el('button', { type: 'button', class: 'chip', onclick: () => {
    const [next, n] = mergeList(csv(fl.value), [f]); if (n) fl.value = next.join(', ');
  } }, `＋ ${f}`)));
  const ta = el('textarea', { rows: 5, placeholder: 'Fármacos compatibles en Y (uno por línea)' });
  ta.value = (d.compat || []).join('\n');
  if (await sheet('Sueros y compatibilidad', [el('label', { class: 'rf' }, 'Sueros compatibles', fl), quick, el('label', { class: 'rf' }, 'Compatibilidad en Y (uno por línea)', ta)]) !== 'ok') return;
  saveFields(id, { fluids: mergeList([], csv(fl.value))[0], compat: lines(ta.value) });
}

// ====================== Enlaces y bibliografía ======================
export async function editRes(id) {
  const d = store.drugs.get(id);
  if (!d) return;
  const before = clone(d.resources || []);
  const state = { list: clone(d.resources || []), regs: () => d.regimens || [], owner: { drugId: id }, added: [] };
  const r = await sheet('Enlaces y bibliografía', [el('p', { class: 'muted small' }, 'Las calculadoras salen también como botones arriba de la ficha.'), api.resEditor(state)]);
  if (r !== 'ok') { api.ctx.dropFiles(state.added); return; }
  const list = api.cleanResList(state.list, d.regimens || []);
  const keep = new Set(resFileIds(list));
  saveFields(id, { resources: list }, 'Guardado ✓', { dropLater: [...resFileIds(before), ...state.added].filter((x) => !keep.has(x)) });
}

export const sameText = (a, b) => norm(a).trim() === norm(b).trim();
export { lineOf };
