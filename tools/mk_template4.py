#!/usr/bin/env python3
"""Plantilla v4 del Vademécum (Dr.Folio v1.25.0), después de mk_template3.py:

1. Fármacos del Chuletario de Urgencias (vademecum_chuletario.py): sus pautas parenterales sustituyen a las de la plantilla
   (se conservan las orales, tópicas, transdérmicas, intranasales y autoinyectores), y se añaden sueros, observaciones,
   contraindicaciones y la fuente.
2. Todas las fichas: etiqueta de tipo en cada pauta (VO, IV, IM, Perfusión…), ámbito (AP / Urgencias / Montaña) y
   contraindicaciones/observaciones clave de ficha técnica (vademecum_fichas.py).
Uso: python3 tools/mk_template4.py   (sobre la v3; si ya es v4 no hace nada)
"""
import json, re, os, sys, unicodedata
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from vademecum_chuletario import CH
from vademecum_fichas import FT, MONTANA

P = os.path.join(HERE, '..', 'public', 'plantillas', 'vademecum-ap-urgencias-montana.json')
norm = lambda s: ''.join(c for c in unicodedata.normalize('NFD', str(s).lower()) if unicodedata.category(c) != 'Mn')
RENAME = {"Amoxicilina-ácido clavulánico": "Amoxicilina/ácido clavulánico", "Óxido nitroso": "Óxido nitroso/oxígeno 50%"}
SRC = {"text": "Chuletario de Urgencias · C. M. Prados Arredondo (CC BY-NC-SA 4.0) · ficha técnica", "url": "https://www.chuletariodeurgencias.es"}
INJ = re.compile(r'^(iv|im|sc|io|perf|bolo|neb|intraven|intramus|subcut|inhalad)', re.I)
HOSP = {"Rocuronio", "Succinilcolina", "Etomidato", "Propofol", "Noradrenalina", "Dobutamina", "Iloprost", "Idarucizumab", "Complejo protrombínico",
        "Hierro carboximaltosa", "Insulina regular", "Sugammadex", "Efedrina", "Heparina sódica", "Hidroxocobalamina", "Antiveneno de víbora",
        "Bicarbonato sódico 1 M", "Gluconato cálcico 10%", "N-acetilcisteína", "Amiodarona", "Adenosina", "Labetalol", "Urapidil", "Levetiracetam",
        "Valproato sódico", "Lacosamida", "Protamina", "Ketamina", "Fentanilo", "Óxido nitroso/oxígeno 50%"}
URG_TOP = {"Soporte vital y urgencias", "Antídotos y toxicología"}

def rtype(route):
    r = norm(route).strip()
    for k, t in [('perfusi', 'Perfusión'), ('nebuliz', 'Nebulizado'), ('intranasal', 'Intranasal'), ('transderm', 'Transdérmico'),
                 ('inhala', 'Inhalado'), ('sublingual', 'SL'), ('topic', 'Tópico'), ('rectal', 'Rectal'), ('intraarticular', ''), ('iv/io', 'IV'), ('io', 'IO')]:
        if r.startswith(k) or (k in ('perfusi', 'nebuliz', 'transderm') and k in r):
            return t
    for k, t in [('vo', 'VO'), ('sl', 'SL'), ('iv', 'IV'), ('im', 'IM'), ('sc', 'SC')]:
        if re.match(rf'^{k}\b', r): return t
    return ''

def is_inj(r):
    route, pres = (r.get('route') or '').strip(), norm(r.get('presentation') or '')
    if 'autoinyector' in pres or norm(route).startswith('intranasal'): return False
    return bool(INJ.match(route)) or bool(re.search(r'\b(amp|vial)\b', pres))

def ch_reg(p):
    r = {"indication": p['indicacion'], "presentation": p.get('presentacion', ''), "route": p.get('via', ''), "dose": p.get('dosis', ''),
         "frequency": p.get('frecuencia', ''), "duration": p.get('duracion', ''), "max": p.get('maxima', '')}
    r['type'] = rtype(r['route']) or ('Bolo' if 'iv' in norm(r['route']) else '')
    return {k: v for k, v in r.items() if v}

def union(a, b, key=lambda x: norm(x).strip()):
    seen = {key(x) for x in a}; out = list(a)
    for x in b:
        if key(x) not in seen: seen.add(key(x)); out.append(x)
    return out

pkey = lambda p: re.sub(r'\s+', '', norm(p).replace('mcg', 'µg'))
t = json.load(open(P, encoding='utf-8'))
if t.get('templateVersion', 0) >= 4: sys.exit('La plantilla ya es v4 (parte de la v3: git checkout de la v3 y repite).')
by = {norm(d['name']): d for d in t['drugs']}
n_ch = 0
for name, c in CH.items():
    d = by.get(norm(RENAME.get(name, name)))
    if not d: print('Sin ficha en la plantilla:', name); continue
    n_ch += 1
    keep = [r for r in d.get('regimens', []) if not is_inj(r)]
    d['regimens'] = [ch_reg(p) for p in c['pautas']] + keep
    tp = [p for p in d.get('presentations', []) if not re.search(r'\b(amp|vial|bala)\b', norm(p)) or 'autoinyector' in norm(p)]
    d['presentations'] = union(tp, c['pres'], pkey)
    d['brands'] = union(d.get('brands', []), c.get('marcas', []))
    d['fluids'] = [s.strip().replace('SG5%', 'SG5 %') for s in c.get('sueros', '').split(',') if s.strip()]
    d['observations'] = list(c.get('obs', []))
    d['contraindications'] = list(c.get('ci', []))
    d['source'] = SRC

for d in t['drugs']:
    for r in d.get('regimens', []):
        if not r.get('type'):
            ty = rtype(r.get('route', ''))
            if ty: r['type'] = ty
    f = FT.get(d['name'])
    if f:
        d['observations'] = union(d.get('observations', []), f.get('obs', []))
        d['contraindications'] = union(d.get('contraindications', []), f.get('ci', []))
    top = d['folder'].split(' › ')[0]
    types = {r.get('type', '') for r in d.get('regimens', [])}
    sc = []
    if d['name'] not in HOSP and top not in URG_TOP: sc.append('AP')
    if top in URG_TOP or d['name'] in HOSP or types & {'IV', 'Bolo', 'Perfusión', 'IO', 'Nebulizado'} or norm(d['name']) in {norm(RENAME.get(k, k)) for k in CH}:
        sc.append('Urgencias')
    if top == 'Montaña y rescate' or d['name'] in MONTANA or any(re.search(r'altura|montaña|congela|rescate', norm(r.get('indication', ''))) for r in d.get('regimens', [])):
        sc.append('Montaña')
    d['scopes'] = sc or ['AP']

t['templateVersion'] = 4
t['about'] = re.sub(r'\(v\d+\)', '(v4)', t.get('about', '')) + ' v4: revisada con el Chuletario de Urgencias y fichas técnicas (tipo de vía, ámbito, contraindicaciones).'
json.dump(t, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
from collections import Counter
print(f"{len(t['drugs'])} fármacos · {n_ch} con datos del Chuletario · {sum(1 for d in t['drugs'] if d.get('contraindications'))} con contraindicaciones")
print('Ámbitos:', Counter(s for d in t['drugs'] for s in d['scopes']))
print('Pautas sin tipo:', sum(1 for d in t['drugs'] for r in d.get('regimens', []) if not r.get('type')), 'de', sum(len(d.get('regimens', [])) for d in t['drugs']))
