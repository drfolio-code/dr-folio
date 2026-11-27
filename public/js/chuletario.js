// Ficha de fármaco ampliada (v1.22.0) y «Pegar del Chuletario».
// Este módulo no toca la interfaz ni Firebase: solo constantes de los campos nuevos y el lector del texto
// copiado de una ficha de https://www.chuletariodeurgencias.es (se puede probar con node).
//
// Campos nuevos de drugs/{id} (todos opcionales; las fichas antiguas siguen igual):
//   pregnancy { cat: ''|'A'|'B'|'C'|'D'|'X'|'N' (N = nota/precaución), note }
//   fluids[]            sueros compatibles (chips: SSF, SG5 %, Ringer…)
//   observations[]      contraindications[]      compat[] (compatibilidad en Y)
//   scopes[]            'ap' | 'urg' | 'mont'  (Atención Primaria / Urgencias / Rescate de montaña)
//   source { text, url }
//   regimens[].type     etiqueta de tipo (Bolo, Perfusión, IM…)   regimens[].text = dosis tal cual

const nrm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const clean = (s) => String(s || '').replace(/[   ]/g, ' ').replace(/[ \t]+/g, ' ').trim();

export const PREG_CATS = [['', '—'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D'], ['X', 'X'], ['N', 'Nota / Precaución']];
export const pregLabel = (p) => (!p?.cat ? '' : p.cat === 'N' ? 'Embarazo (precaución)' : `Embarazo (Cat. ${p.cat})`);

export const SCOPES = [['ap', 'Atención Primaria', 'AP'], ['urg', 'Urgencias', 'Urg.'], ['mont', 'Rescate de montaña', 'Montaña']];
export const scopeName = (k) => SCOPES.find((s) => s[0] === k)?.[1] || k;
/** «AP», «Atención primaria», «Urgencias», «Montaña», «Rescate»… → 'ap' | 'urg' | 'mont' */
export function scopeKey(x) {
  const s = nrm(x).trim();
  if (/^(ap|aps|atencion primaria|primaria|centro de salud)$/.test(s)) return 'ap';
  if (/^(urg|urgencias|urgencia|emergencias|hospital)$/.test(s)) return 'urg';
  if (/^(mont|montana|rescate|rescate de montana|rescate en montana|monte)$/.test(s)) return 'mont';
  return '';
}

export const FLUIDS = ['SSF', 'SG5 %', 'SG10 %', 'SGS', 'Ringer lactato', 'Plasmalyte', 'Agua para inyección'];
const FLUID_RE = /\b(SSF(?:\s*0[,.]9\s*%)?|SF(?:\s*0[,.]9\s*%)?|SG\s*\d+(?:[,.]\d+)?\s*%|SGS|SG|G\s*5\s*%|Glucosalino|Glucosado(?:\s*\d+\s*%)?|Ringer(?:\s+lactato)?|RL|Plasmalyte|Plasma-?Lyte|Agua\s+(?:para\s+inyecci[oó]n|PPI|API|bidestilada))(?![A-Za-z0-9])/gi;

/** Etiquetas de tipo de las indicaciones (como en el Chuletario) */
export const REG_TYPES = ['Bolo', 'Perfusión', 'IV', 'IM', 'SC', 'VO', 'SL', 'Intranasal', 'Nebulizado', 'Inhalado', 'IO', 'Rectal', 'Tópico', 'Carga', 'Mantenimiento', 'Endotraqueal', 'Transdérmico'];
const TYPE_ALIASES = {
  'bolo': 'Bolo', 'bolo iv': 'Bolo', 'bolus': 'Bolo', 'iv directa': 'Bolo', 'bolo lento': 'Bolo',
  'perfusion': 'Perfusión', 'perfusion continua': 'Perfusión', 'perfusion iv': 'Perfusión', 'infusion': 'Perfusión', 'pc': 'Perfusión', 'bic': 'Perfusión',
  'iv': 'IV', 'iv lenta': 'IV', 'intravenosa': 'IV', 'im': 'IM', 'intramuscular': 'IM', 'sc': 'SC', 'subcutanea': 'SC', 'subcutaneo': 'SC',
  'vo': 'VO', 'oral': 'VO', 'via oral': 'VO', 'sl': 'SL', 'sublingual': 'SL', 'in': 'Intranasal', 'intranasal': 'Intranasal', 'nasal': 'Intranasal',
  'nebulizado': 'Nebulizado', 'nebulizada': 'Nebulizado', 'nebulizacion': 'Nebulizado', 'neb': 'Nebulizado',
  'inhalado': 'Inhalado', 'inhalada': 'Inhalado', 'inhalacion': 'Inhalado', 'io': 'IO', 'intraosea': 'IO', 'intraoseo': 'IO',
  'rectal': 'Rectal', 'vr': 'Rectal', 'topico': 'Tópico', 'topica': 'Tópico', 'carga': 'Carga', 'dosis de carga': 'Carga',
  'mantenimiento': 'Mantenimiento', 'dosis de mantenimiento': 'Mantenimiento', 'endotraqueal': 'Endotraqueal', 'et': 'Endotraqueal',
  'transdermico': 'Transdérmico', 'transdermica': 'Transdérmico', 'bucal': 'Bucal', 'intradermica': 'Intradérmica', 'epidural': 'Epidural'
};
/** Texto de una etiqueta → etiqueta normalizada, o '' si no lo es */
export function regType(x) {
  const s = nrm(clean(x)).replace(/[.:·]+$/, '').trim();
  return TYPE_ALIASES[s] || '';
}
/** Clase CSS del color de la etiqueta */
export function typeSlug(t) {
  const s = nrm(t).replace(/[^a-z]+/g, '');
  return ['bolo', 'perfusion', 'iv', 'im', 'sc', 'vo', 'sl', 'intranasal', 'nebulizado', 'inhalado', 'io', 'rectal', 'topico', 'carga', 'mantenimiento'].includes(s) ? s : 'otro';
}

export const CHULETARIO_SOURCE = { text: 'Chuletario de Urgencias · C. M. Prados Arredondo', url: 'https://www.chuletariodeurgencias.es' };

// ---------- Lector del texto copiado ----------
const SECTIONS = [
  ['pres', /^(presentaciones?|formas? de presentacion|presentacion comercial)$/],
  ['ind', /^(indicaciones?|posologias?|dosis|dosificacion|indicaciones y (dosis|posologia))$/],
  ['obs', /^(observaciones?|notas?|comentarios?|precauciones?|advertencias?|efectos (adversos|secundarios)|administracion)$/],
  ['contra', /^(contraindicaciones?)$/],
  ['compat', /^(compatibilidad(es)?( en y| y| en y-site| y-site| \(y-site\)| en "y"| iv)?|y-site|compatibilidad en y \(y-site\))$/],
  ['fluids', /^(sueros?( compatibles)?|diluyentes?|diluciones?|dilucion)$/],
  ['preg', /^(embarazo|embarazo y lactancia|lactancia)$/]
];
// Líneas que no son de la ficha (menús, pestañas, pie de página)
const NOISE = /^(farmacos en urgencias|ficha|calculadora|calculo|inicio|menu|buscar|volver|atras|cerrar|ver mas|ver menos|compartir|imprimir|favoritos?|[▼▲⌃⌄˄˅∧∨^v×✕]+|chuletario de urgencias|www\..*|https?:\/\/.*|©.*|copyright.*|licencia.*|cc by.*|todos los derechos.*)$/;

const stripBullet = (l) => l.replace(/^\s*(?:[-–—•·*▪◦●○]|\d+[.)])\s+/, '');
const lc = (l) => /^[a-záéíóúñü(]/.test(l) || /^[\d,.]+\s*(mg|mcg|µg|g|ml|mL|ui|UI|meq|mmol|%)/i.test(l);

/** Si la línea es un encabezado de sección: [clave, resto de la línea] */
function heading(line) {
  const m = line.match(/^([^:]{2,60}?)\s*:\s*(.*)$/);
  const cand = [[line, ''], ...(m ? [[m[1], m[2]]] : [])];
  for (const [h, rest] of cand) {
    const k = nrm(h).replace(/[.:]+$/, '').trim();
    for (const [key, re] of SECTIONS) if (re.test(k)) return [key, clean(rest)];
  }
  // «Embarazo (Cat. C)», «Embarazo: C», «Embarazo – categoría D»
  if (/^embarazo\b/i.test(line)) return ['preg', clean(line)];
  return null;
}

function pregFrom(line) {
  const s = nrm(line);
  const m = s.match(/embarazo\b[^a-z]*(?:\(?\s*)?(?:cat(?:egoria)?\.?\s*:?\s*)?\(?\s*([abcdx])\b(?![a-z])/) || s.match(/\bcat(?:egoria)?\.?\s*:?\s*([abcdx])\b/);
  if (m) return m[1].toUpperCase();
  if (/nota|precaucion|evitar|no recomendad|contraindicad|valorar|riesgo/.test(s)) return 'N';
  return '';
}

function fluidsFrom(text) {
  const out = [];
  for (const m of String(text).matchAll(FLUID_RE)) {
    let f = clean(m[1]).replace(/^SF\b/i, 'SSF').replace(/^G\s*5\s*%/i, 'SG5 %').replace(/^SG\s*(\d+(?:[,.]\d+)?)\s*%/i, 'SG$1 %')
      .replace(/^RL$/i, 'Ringer lactato').replace(/^Plasma-?Lyte$/i, 'Plasmalyte');
    if (/^ssf\s*0/i.test(f)) f = 'SSF';
    if (!out.some((x) => nrm(x) === nrm(f))) out.push(f);
  }
  return out;
}

/** Une líneas partidas: si una línea empieza en minúscula o con «=» se pega a la anterior */
function joinWrapped(lines) {
  const out = [];
  for (const l of lines) {
    if (out.length && (/^[a-záéíóúñü]/.test(l) || /^[=)]/.test(l) || /[,(]$/.test(out[out.length - 1]))) out[out.length - 1] += ` ${l}`;
    else out.push(l);
  }
  return out;
}

/**
 * Texto copiado de una ficha del Chuletario → campos de la ficha. Nunca lanza: lo que no entiende va a «Observaciones»
 * y se avisa en `warnings`. Devuelve { name, brands, pregnancy, fluids, presentations, regimens, observations,
 * contraindications, compat, warnings }.
 */
export function parseChuletario(text) {
  const res = { name: '', brands: [], pregnancy: { cat: '', note: '' }, fluids: [], presentations: [], regimens: [], observations: [], contraindications: [], compat: [], warnings: [] };
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
    .map((l) => clean(l.replace(/[​﻿]/g, '')))
    .filter((l) => l && !NOISE.test(nrm(l)));
  const sec = { head: [], pres: [], ind: [], obs: [], contra: [], compat: [], fluids: [], preg: [] };
  let cur = 'head';
  for (const raw of lines) {
    const h = heading(raw);
    if (h) {
      cur = h[0];
      if (cur === 'preg') { const c = /^[abcdx]$/i.test(h[1]) ? h[1].toUpperCase() : pregFrom(raw) || pregFrom(h[1]); if (c) res.pregnancy.cat = c; if (h[1] && !/^embarazo/i.test(h[1]) && !/^\(?\s*cat/i.test(h[1]) && !/^[abcdx]$/i.test(h[1])) sec.preg.push(h[1]); }
      else if (h[1]) sec[cur].push(h[1]);
      continue;
    }
    // «Sueros: SSF» suele ir en la misma línea; los chips sueltos tras «Embarazo» también son sueros
    if (cur === 'preg' && fluidsFrom(raw).length && clean(raw.replace(FLUID_RE, '').replace(/[,;/·|]+/g, '')).length < 3) { sec.fluids.push(raw); continue; }
    sec[cur].push(raw);
  }

  // Cabecera: nombre y marca(s)
  const head = [...sec.head];
  if (head.length) res.name = clean(head.shift().replace(/[®™]/g, ''));
  if (res.name && res.name === res.name.toUpperCase() && /[A-ZÁÉÍÓÚ]{3}/.test(res.name)) res.name = res.name.charAt(0) + res.name.slice(1).toLowerCase();
  for (const l of head) {
    if (/[®™]/.test(l) || res.brands.length === 0 && l.length <= 60 && !/\d+\s*(mg|ml|amp)/i.test(l)) {
      for (const b of l.split(/\s*(?:,|;|\s\/\s|\s·\s|\|)\s*/)) {
        const name = clean(b.replace(/[®™]/g, ''));
        if (name && !res.brands.some((x) => nrm(x) === nrm(name))) res.brands.push(name);
      }
    } else res.observations.push(l);
  }
  if (res.name && /[®™]/.test(text) === false && res.brands.length === 1 && nrm(res.brands[0]) === nrm(res.name)) res.brands = [];

  // Embarazo
  res.pregnancy.note = joinWrapped(sec.preg).join('\n');
  if (!res.pregnancy.cat && res.pregnancy.note) res.pregnancy.cat = pregFrom(res.pregnancy.note) || 'N';
  res.fluids = fluidsFrom(sec.fluids.join(' , '));

  // Presentaciones: un chip por línea (las equivalencias «1 amp = 1 mL = 1 mg» se mantienen juntas)
  for (const l of sec.pres) {
    const t = stripBullet(l);
    if (res.presentations.length && (/^=/.test(t) || /=$/.test(res.presentations[res.presentations.length - 1]))) res.presentations[res.presentations.length - 1] += ` ${t}`;
    else res.presentations.push(t);
  }

  // Indicaciones: «Título» · ETIQUETA · «dosis…»
  res.regimens = parseIndications(sec.ind.map(stripBullet));
  for (const [k, key] of [['obs', 'observations'], ['contra', 'contraindications'], ['compat', 'compat']]) res[key].push(...joinWrapped(sec[k].map(stripBullet)));
  if (!res.name) res.warnings.push('No se ha encontrado el nombre del fármaco.');
  if (!sec.ind.length) res.warnings.push('No se ha encontrado la sección «Indicaciones».');
  return res;
}

const UNIT = /\d\s*(mg|mcg|µg|ug|g|ml|ui|meq|mmol|gotas?|amp|comp|puff|inh|%|min|h\b|horas?|kg)/i;
const doseLike = (l) => UNIT.test(l) || /^(cada|hasta|repetir|m[aá]x|dosis|seguir|despu[eé]s|luego|en \d|diluir|ritmo)\b/i.test(l);

function parseIndications(lines) {
  // Etiqueta pegada al texto: «BOLO 0,6-1 mg IV…» → dos líneas
  const L = [];
  for (const l of lines) {
    const m = l.match(/^([A-ZÁÉÍÓÚ][A-ZÁÉÍÓÚ ]{1,24}?)\s*[:·-]?\s+(\d.*|[a-záéíóú(].*)$/);
    if (m && regType(m[1]) && m[1] === m[1].toUpperCase()) L.push(m[1], m[2]); else L.push(l);
  }
  const isLabel = (l) => !!regType(l) && l.length <= 30;
  const labels = L.map((l, i) => (isLabel(l) ? i : -1)).filter((i) => i >= 0);
  const out = [];
  if (!labels.length) {
    // Sin etiquetas: «Título» (sin dosis) seguido de su dosis; si no, cada línea es una pauta
    for (let i = 0; i < L.length; i++) {
      if (!doseLike(L[i]) && i + 1 < L.length && doseLike(L[i + 1])) { out.push({ indication: L[i], type: '', text: L[i + 1] }); i++; }
      else if (out.length && doseLike(L[i])) out[out.length - 1].text += `\n${L[i]}`;
      else out.push({ indication: '', type: '', text: L[i] });
    }
    return out.map((r) => ({ ...r, indication: clean(r.indication), text: r.text.trim() }));
  }
  let start = 0;
  labels.forEach((j, n) => {
    const region = L.slice(start, j);
    let title = [];
    if (n === 0) title = region;
    else {
      const prev = out[out.length - 1];
      const rest = region;
      // La primera línea es la dosis de la pauta anterior; al final, las líneas sin dosis son el título de esta
      let k = rest.length;
      while (k > 1 && !doseLike(rest[k - 1])) k--;
      if (k === rest.length && rest.length > 1) k = rest.length - 1; // todas parecen dosis: la última es el título
      const dose = rest.slice(0, rest.length > 1 ? k : rest.length);
      title = rest.length > 1 ? rest.slice(k) : [];
      prev.text = dose.join('\n');
    }
    const indication = title.length ? title.join(' ') : (out[out.length - 1]?.indication || '');
    out.push({ indication, type: regType(L[j]), text: '' });
    start = j + 1;
  });
  out[out.length - 1].text = L.slice(start).join('\n');
  return out.map((r) => ({ ...r, indication: clean(r.indication), text: r.text.trim() }));
}
