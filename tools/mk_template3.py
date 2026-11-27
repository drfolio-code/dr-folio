#!/usr/bin/env python3
"""Plantilla v3 (Dr.Folio v1.24.0): une los fármacos con el MISMO principio activo.

«Fentanilo» + «Fentanilo transdérmico», «Glucosa 5%» + «Glucosa hipertónica»… → una sola ficha. La forma
(transdérmico, tópico, vaginal, 3 %…) pasa a la indicación si no la dice ya. Las combinaciones («A/B») no se tocan.
Mismas reglas que `duplicateGroups`/`mergeGroupLight` de public/js/drugbody.js (lo que hace «Unir fichas repetidas»).
Uso: python3 tools/mk_template3.py   (después de mk_template.py y mk_template2.py; se puede repetir)
"""
import json, re, unicodedata, os
P = os.path.join(os.path.dirname(__file__), '..', 'public', 'plantillas', 'vademecum-ap-urgencias-montana.json')
FORM = set('''transdermico transdermica autoinyector autoinyectable topico topica vaginal otico otica oftalmico oftalmica colirio
nasal rectal depot valerato aceponato retard oral inyectable iv im crema gel pomada spray inhalado inhalada nebulizado nebulizada
hipertonica hipertonico isotonica sublingual parche parches intranasal bucal jarabe gotas solucion ampollas comprimidos capsulas
supositorios'''.split())
norm = lambda s: ''.join(c for c in unicodedata.normalize('NFD', str(s).lower()) if unicodedata.category(c) != 'Mn')
toks = lambda n: re.sub(r'\([^)]*\)', ' ', n).split()
def blen(n):
    t = toks(n); k = len(t)
    while k > 1 and (norm(t[k - 1]) in FORM or re.fullmatch(r'\d+(?:[.,]\d+)?\s*%', t[k - 1])): k -= 1
    return k
bkey = lambda n: ' '.join(norm(x) for x in toks(n)[:blen(n)])
pkey = lambda p: re.sub(r'\s+', '', norm(p).replace('mcg', 'µg')).rstrip('.')
def union(a, b, key=lambda x: norm(x).strip()):
    seen = {key(x) for x in a}; out = list(a)
    for x in b:
        if key(x) not in seen: seen.add(key(x)); out.append(x)
    return out
rk = lambda r: norm('|'.join(str(r.get(k, '')) for k in ('indication', 'route', 'dose', 'frequency', 'text')))

t = json.load(open(P, encoding='utf-8'))
groups = {}
for d in t['drugs']: groups.setdefault(bkey(d['name']), []).append(d)
out, merged = [], []
for d in t['drugs']:
    g = groups[bkey(d['name'])]
    if len(g) == 1: out.append(d); continue
    if d is not g[0]: continue  # se añade una vez, en el sitio del primero
    keep = next((x for x in g if norm(x['name']) == bkey(x['name'])), None) or max(g, key=lambda x: len(x.get('regimens', [])))
    m = dict(keep); m['name'] = keep['name'] if norm(keep['name']) == bkey(keep['name']) else ' '.join(toks(keep['name'])[:blen(keep['name'])])
    m['brands'] = list(keep.get('brands', [])); m['presentations'] = list(keep.get('presentations', [])); m['regimens'] = [dict(r) for r in keep.get('regimens', [])]
    for o in g:
        if o is keep: continue
        form = ' '.join(toks(o['name'])[blen(o['name']):])
        m['brands'] = union(m['brands'], o.get('brands', []))
        m['presentations'] = union(m['presentations'], o.get('presentations', []), pkey)
        for r0 in o.get('regimens', []):
            r = dict(r0); said = norm(' '.join(str(r.get(k, '')) for k in ('indication', 'route', 'presentation', 'text')))
            if form and norm(form)[:7] not in said: r['indication'] = f"{r['indication']} · {form}" if r.get('indication') else form
            if rk(r) not in {rk(x) for x in m['regimens']}: m['regimens'].append(r)
    out.append(m); merged.append(f"{m['name']} ← " + ' + '.join(x['name'] for x in g))
t['drugs'] = out
t['about'] = re.sub(r'\(v\d+\)', '(v3)', t.get('about', ''))
t['templateVersion'] = 3
json.dump(t, open(P, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{len(out)} fármacos; {len(merged)} unidos:'); print('\n'.join('  ' + x for x in merged))
