// Etiquetas libres del Vademécum (v1.31.0): «Mochila 061», «Carro de paradas», «Montaña», «Uso en embarazo»…
// drugTags/{id} {name, color, order, profile, createdAt}; en cada ficha tags[] (ids). Sustituyen al «ámbito» (scopes:
// ap/urg/mont → «Atención Primaria», «Urgencias», «Montaña»), que se convierte solo (migrateDrugTags) y deja de usarse.
import { writeBatch } from '../vendor/libs.js';
import { db } from './db.js';
import { store, ref, newId, commitBatch, put, patch } from './store.js';
import { el, norm } from './util.js';
import { toast, modal, confirm, prompt, colorPicker } from './ui.js';
import { icon } from './icons.js';
import { DEFAULT_TAGS, scopeTagId, ensureScopeTag, profOf } from './drugbody.js';
import { addQuota, budget } from './backup.js';

const KEY = 'drfolio.drugTagFilter';
export const TAG_COLORS = ['#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777', '#64748b'];
export const EXAMPLES = '«Mochila 061», «Carro de paradas», «Montaña», «Uso en embarazo»';

/** Perfil activo (adulto / pediátrico, v1.32.0) — lo da drugs.js */
let profileFn = () => 'adult';
export function setProfileFn(fn) { profileFn = fn; }

/** Etiquetas del perfil activo, en su orden */
export const liveTags = (profile = profileFn()) => [...store.drugTags.values()].filter((t) => profOf(t) === profile)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name), 'es'));
export const tagsOf = (d) => (d.tags || []).map((id) => store.drugTags.get(id)).filter((t) => t && profOf(t) === profOf(d))
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

// ---------- Filtro (varias a la vez: la ficha tiene que llevar todas las elegidas) ----------
export function tagFilter() {
  let v = [];
  try { v = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { v = []; }
  return Array.isArray(v) ? v.filter((id) => store.drugTags.has(id) && profOf(store.drugTags.get(id)) === profileFn()) : [];
}
export function setTagFilter(ids) { try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* nada */ } }
export function toggleTagFilter(id) {
  const all = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } })();
  const i = all.indexOf(id);
  if (i >= 0) all.splice(i, 1); else all.push(id);
  setTagFilter(all);
}
export const tagOk = (d) => { const f = tagFilter(); return !f.length || f.every((id) => (d.tags || []).includes(id)); };

/** Chip de una etiqueta (color propio) */
export function tagChip(t, attrs = {}, ...kids) {
  return el(attrs.onclick ? 'button' : 'span', { type: attrs.onclick ? 'button' : null, ...attrs, class: `dtag ${attrs.class || ''}`, style: t.color ? { '--tc': t.color } : {} },
    ...(kids.length ? kids : [t.name]));
}

// ---------- Conversión automática del ámbito → etiquetas (idempotente) ----------
let migrating = false;
/** Fichas sin el campo `tags`: reciben las etiquetas de su ámbito (y «Montaña» si estaban en «Montaña y rescate»). */
export async function migrateDrugTags() {
  if (migrating || !store.loaded.drugs || !store.loaded.drugTags || !store.loaded.settings) return;
  if (store.fromCache.drugs || store.fromCache.drugTags) return; // solo con datos del servidor
  const todo = [...store.drugs.values()].filter((d) => !Array.isArray(d.tags));
  if (!todo.length) return;
  if (budget().w < todo.length + 10) return; // mañana
  migrating = true;
  try {
    let batch = writeBatch(db), n = 0;
    for (const d of todo) {
      const p = profOf(d);
      const ks = [...new Set([...(d.scopes || []), ...(d.mountainFolder ? ['mont'] : [])])].filter((k) => DEFAULT_TAGS.some((t) => t[0] === k));
      const tags = ks.map((k) => ensureScopeTag(k, p, batch));
      batch.set(ref('drugs', d.id), { tags }, { merge: true }); // sin updatedAt: no cuenta como editada
      d.tags = tags;
      if (++n >= 400) { await commitBatch(batch); batch = writeBatch(db); n = 0; }
    }
    if (n) await commitBatch(batch);
    addQuota(todo.length + 3, 0);
  } catch (e) { console.warn('migrateDrugTags', e); } finally { migrating = false; }
}

// ---------- Crear / gestionar ----------
export async function newTag(profile = profileFn()) {
  const name = await prompt('Nueva etiqueta', '', { placeholder: 'p. ej. Mochila 061', label: `Ejemplos: ${EXAMPLES}`, okLabel: 'Crear' });
  if (!name) return null;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, 40);
  const dup = liveTags(profile).find((t) => norm(t.name).trim() === norm(clean).trim());
  if (dup) { toast(`Ya tienes «${dup.name}»`, 'ok'); return dup.id; }
  const id = newId('drugTags');
  const used = new Set(liveTags(profile).map((t) => t.color));
  const data = { name: clean, color: TAG_COLORS.find((c) => !used.has(c)) || TAG_COLORS[liveTags(profile).length % TAG_COLORS.length],
    order: Math.max(0, ...liveTags(profile).map((t) => t.order ?? 0)) + 1, profile, createdAt: Date.now() };
  store.drugTags.set(id, { id, ...data });
  put('drugTags', id, data);
  return id;
}

/** Vademécum ⋯ → «Etiquetas…»: crear, renombrar, color, ordenar, borrar */
export async function manageTags(onChange = () => {}) {
  const box = el('div', { class: 'tag-admin' });
  const count = (id) => [...store.drugs.values()].filter((d) => !d.trashed && (d.tags || []).includes(id)).length;
  const render = () => {
    const list = liveTags();
    box.replaceChildren(...(list.length ? list.map((t, i) => el('div', { class: 'tag-row' },
      tagChip(t, {}), el('span', { class: 'muted small tag-n' }, `${count(t.id)} ficha(s)`), el('span', { class: 'spacer' }),
      i > 0 ? el('button', { class: 'icon-btn', type: 'button', title: 'Subir', 'aria-label': `Subir ${t.name}`, onclick: () => move(list, i, -1) }, icon('arrow-up')) : null,
      i < list.length - 1 ? el('button', { class: 'icon-btn', type: 'button', title: 'Bajar', 'aria-label': `Bajar ${t.name}`, onclick: () => move(list, i, 1) }, icon('arrow-down')) : null,
      el('button', { class: 'icon-btn', type: 'button', title: 'Color', 'aria-label': `Color de ${t.name}`, onclick: () => recolor(t) }, icon('palette')),
      el('button', { class: 'icon-btn', type: 'button', title: 'Renombrar', 'aria-label': `Renombrar ${t.name}`, onclick: () => rename(t) }, icon('pencil')),
      el('button', { class: 'icon-btn', type: 'button', title: 'Borrar', 'aria-label': `Borrar ${t.name}`, onclick: () => del(t) }, icon('trash-2'))))
      : [el('p', { class: 'muted small' }, 'Aún no tienes etiquetas.')]));
  };
  const changed = () => { render(); onChange(); };
  const move = (list, i, dir) => {
    [list[i], list[i + dir]] = [list[i + dir], list[i]];
    list.forEach((t, k) => { if (t.order !== k) { t.order = k; patch('drugTags', t.id, { order: k }); } });
    changed();
  };
  const rename = async (t) => {
    const v = await prompt('Renombrar etiqueta', t.name, { okLabel: 'Guardar' });
    if (!v || v.trim() === t.name) return;
    t.name = v.replace(/\s+/g, ' ').trim().slice(0, 40);
    patch('drugTags', t.id, { name: t.name });
    changed();
  };
  const recolor = async (t) => {
    const c = await colorPicker(`Color de «${t.name}»`, TAG_COLORS, 'label');
    if (c === undefined) return;
    t.color = c || null;
    patch('drugTags', t.id, { color: t.color });
    changed();
  };
  const del = async (t) => {
    const n = count(t.id);
    if (!await confirm('Borrar etiqueta', `¿Borrar «${t.name}»?${n ? ` Se quitará de ${n} ficha(s) (las fichas no se borran).` : ''}`, { okLabel: 'Borrar', danger: true })) return;
    const users = [...store.drugs.values()].filter((d) => (d.tags || []).includes(t.id));
    if (budget().w < users.length + 2) { toast('Hoy ya casi no quedan escrituras del plan gratuito. Inténtalo mañana.', 'error', 6000); return; }
    let batch = writeBatch(db), k = 0;
    for (const d of users) {
      d.tags = d.tags.filter((x) => x !== t.id);
      batch.set(ref('drugs', d.id), { tags: d.tags }, { merge: true });
      if (++k >= 400) { commitBatch(batch); batch = writeBatch(db); k = 0; }
    }
    batch.delete(ref('drugTags', t.id));
    commitBatch(batch);
    store.drugTags.delete(t.id);
    addQuota(users.length, 1);
    toast(`Etiqueta «${t.name}» borrada`, 'ok');
    changed();
  };
  render();
  await modal({
    title: 'Etiquetas del Vademécum',
    body: [el('p', { class: 'muted small' }, `Agrupa fichas sin moverlas de carpeta, p. ej. ${EXAMPLES}. Una ficha puede tener varias. Filtra por ellas arriba de la lista.`),
      box, el('button', { class: 'btn sm', type: 'button', onclick: async () => { if (await newTag()) changed(); } }, '＋ Nueva etiqueta')],
    actions: [{ label: 'Cerrar' }]
  });
}

export { scopeTagId };
