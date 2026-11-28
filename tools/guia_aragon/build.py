#!/usr/bin/env python3
"""Archivo de importación del Vademécum PEDIÁTRICO a partir de la Guía de dosificación pediátrica de Aragón
(descargada con scrape.js en out/). Uso: python3 build.py → guia-pediatrica-aragon.json"""
import json, glob, os, re, base64, hashlib, html, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
SRC_TEXT = 'Guía de dosificación pediátrica de Aragón (2021)'

# Nombre de la ficha (página → principio activo). Las páginas del mismo fármaco se juntan en una ficha.
NAMES = {
    'amoxicilina-clavulánico': 'Amoxicilina/ácido clavulánico',
    'trimetoprim-sulfametoxazol': 'Trimetoprim/sulfametoxazol (cotrimoxazol)',
    'atovacuona-proguanil': 'Atovacuona/proguanil',
    'adrenalina-im': 'Adrenalina', 'adrenalina-nebulizada': 'Adrenalina', 'adrenalina': 'Adrenalina',
    'midazolam-urg': 'Midazolam', 'dexclorfeniramina-iv-im': 'Dexclorfeniramina',
    'metilprednisolona-im': 'Metilprednisolona', 'diazepam-rectal': 'Diazepam',
    'salbutamol-inhalado': 'Salbutamol', 'salbutamol-nebulizado': 'Salbutamol',
    'budesonida': 'Budesonida', 'fluticasona': 'Fluticasona',
    'formoterol-budesonida': 'Formoterol/budesonida', 'formoterol-fluticasona': 'Formoterol/fluticasona',
    'salmeterol-fluticasona': 'Salmeterol/fluticasona', 'vilanterol-fluticasona': 'Vilanterol/fluticasona',
    'ondansetron': 'Ondansetrón', 'radecadotrilo': 'Racecadotrilo', 'tranexamico': 'Ácido tranexámico',
    'magnesio': 'Sales de magnesio', 'parafina': 'Parafina líquida', 'polietilenglicol': 'Polietilenglicol (macrogol)',
    'vitaminad3': 'Vitamina D3 (colecalciferol)', 'fluor': 'Flúor', 'glucagon': 'Glucagón', 'codeina': 'Codeína',
    'sueros-orales': 'Sueros de rehidratación oral', 'formulas': 'Fórmulas hidrolizadas', 'probioticos': 'Probióticos',
    'camaras-para-inhalacion': 'Cámaras para inhalación', 'penicilinas': 'Penicilinas (penicilina V y benzatina)',
    'corticoide-antibiotico': 'Corticoide + antibiótico (tópico)', 'corticoide-antimicotico': 'Corticoide + antimicótico (tópico)',
    'corticoides-topicos': 'Corticoides tópicos', 'antibióticos-tópicos': 'Antibióticos tópicos', 'antihistaminicos': 'Antihistamínicos tópicos',
    'antimicoticos': 'Antimicóticos tópicos', 'antivirales': 'Antivirales tópicos', 'antiacneicos': 'Antiacneicos',
    'antiverrugas': 'Antiverrugas', 'antihemorroidales': 'Antihemorroidales', 'inmunomoduladores': 'Inmunomoduladores tópicos',
    'miscelánea': 'Miscelánea dermatológica', 'pediculicidas-y-escabicidas': 'Pediculicidas y escabicidas',
    'antialergicos-nasales': 'Antialérgicos nasales', 'antibioticos-nasales': 'Antibióticos nasales', 'corticoides-nasales': 'Corticoides nasales',
    'otros-nasales': 'Otros nasales', 'antialergicos-oculares': 'Antialérgicos oculares', 'antibioticos-corticoide-oculares': 'Antibiótico + corticoide oculares',
    'antibioticos-oculares': 'Antibióticos oculares', 'antiinflamatorios-no-esteroideos': 'AINE oculares', 'ciclopléjico': 'Ciclopléjico',
    'corticoides-oculares': 'Corticoides oculares', 'epitelizantes': 'Epitelizantes oculares', 'higiene-palpebral': 'Higiene e hidratación palpebral',
    'lagrimas-artificiales': 'Lágrimas artificiales', 'varios': 'Óticos', 'descongestivos': 'Descongestivos nasales', 'desimpactantes': 'Desimpactantes (enemas)',
    'antigripales': 'Vacuna antigripal', 'antihepatitis-a': 'Vacuna hepatitis A', 'antimeningococicaacwy': 'Vacuna meningococo ACWY',
    'antimeningococicab': 'Vacuna meningococo B', 'antineumococica23': 'Vacuna neumococo polisacárida 23v', 'antirrotavirus': 'Vacuna rotavirus',
    'antisalmonella': 'Vacuna fiebre tifoidea (Salmonella typhi)', 'antivph': 'Vacuna VPH',
}
# Carpeta pediátrica (misma estructura que el adulto) según la sección de la guía
AB = 'Antiinfecciosos › Antibacterianos'
AV = 'Antiinfecciosos › Antivirales, antifúngicos y antiparasitarios'
def folder_of(path, slug):
    p = path.split('/')
    sec, sub = p[1], (p[2] if len(p) > 3 else '')
    special = {'ibuprofeno': 'Analgesia y anestesia › AINE', 'metamizol': 'Analgesia y anestesia › Analgésicos', 'paracetamol': 'Analgesia y anestesia › Analgésicos',
               'hierro': 'Sangre y anticoagulación', 'tranexamico': 'Sangre y anticoagulación', 'desmopresina': 'Urología y ginecología',
               'fluor': 'Endocrino y metabolismo', 'vitaminad3': 'Endocrino y metabolismo',
               'melatonina': 'Neurología y psiquiatría › Psiquiatría', 'metilfenidato': 'Neurología y psiquiatría › Psiquiatría', 'lisdenxanfetamina': 'Neurología y psiquiatría › Psiquiatría',
               'adrenalina-im': 'Cardiovascular › Antiarrítmicos y vasoactivos', 'adrenalina-nebulizada': 'Cardiovascular › Antiarrítmicos y vasoactivos', 'adrenalina': 'Cardiovascular › Antiarrítmicos y vasoactivos',
               'ceftriaxona': AB, 'dexclorfeniramina-iv-im': 'Alergia e inmunología', 'diazepam-rectal': 'Neurología y psiquiatría › Neurología',
               'glucagon': 'Endocrino y metabolismo', 'metilprednisolona-im': 'Endocrino y metabolismo', 'midazolam-urg': 'Neurología y psiquiatría › Neurología'}
    if slug in special: return special[slug]
    if sec.startswith('1-'): return AV if sub in ('antivirales', 'antimicóticos', 'antiparasitarios', 'antipalúdicos') else AB
    if sec.startswith('3-'): return 'Endocrino y metabolismo'
    if sec.startswith('4-'): return 'Alergia e inmunología' if sub == 'antihistamínicos' else 'Respiratorio'
    if sec.startswith('5-'): return 'Digestivo'
    if sec.startswith('6-'): return 'Neurología y psiquiatría › Neurología'
    if sec.startswith('8-'): return 'Antiinfecciosos › Vacunas e inmunoglobulinas'
    if sec.startswith('9-'): return 'Dermatología' if sub == 'dermatológicos' else 'Oftalmología y ORL'
    raise SystemExit(f'sin carpeta: {path}')

SECTION = {'1': 'Antiinfecciosos', '2': 'Antitérmicos y analgésicos', '3': 'Corticoides sistémicos', '4': 'Respiratorio', '5': 'Digestivo',
           '6': 'Sistema nervioso', '7': 'Vitaminas, minerales y otros', '8': 'Vacunas no financiadas', '9': 'Tópicos', '10': 'Medicación de urgencia'}

DOSE_RE = re.compile(r'(mg|μg|µg|mcg|g|UI|ml|gotas?)\s*/\s*(kg|día|dosis|toma|\d+\s*h)', re.I)
PROD_RE = re.compile(r'®|\b(comp|cáps|caps|sobres?|susp|jarabe|gotas|sol\.?|solución|crema|pomada|gel|colirio|amp|ampolla|vial|sup\.|inhalador|polvo|aerosol|spray|nebuliz|jeringa|enema|parche|loción|champú)\b', re.I)
UNIT_RE = re.compile(r'\d\s*(mg|g|ml|μg|µg|mcg|UI|%)\b', re.I)

def clean_url(l):
    return re.sub(r'\s+', '', l)

def esc(t):
    return html.escape(t, quote=True)

def parse(d):
    lines = [unicodedata.normalize('NFC', l).replace('\u00a0', ' ').strip() for l in d['text'].split('\n')]
    lines = [l for l in lines if l]
    # líneas partidas en la web (la siguiente empieza en minúscula) → una sola
    joined = []
    for l in lines:
        if joined and l[:1].islower() and not joined[-1].endswith(('.', ':')) and not l.startswith('http'): joined[-1] += ' ' + l
        else: joined.append(l)
    lines = joined
    slug = d['path'].rstrip('/').split('/')[-1]
    # título (algunas páginas lo parten en 2 líneas)
    body = lines[1:]
    if lines[0].endswith('+') and body: body = body[1:]
    dose, i = [], 0
    while i < len(body) and len(dose) < 4 and DOSE_RE.search(body[i]) and len(body[i]) < 120:
        dose.append(body[i]); i += 1
    rest = body[i:]
    title_words = {re.sub(r'[^a-záéíóúñü]', '', w) for w in re.split(r'[\s/+-]+', lines[0].lower()) if len(w) > 2}
    # presentaciones: lo que está bajo «Presentaciones» con cantidad (mg, ml…), y cualquier línea con ®
    pres, brands, pb = [], [], []
    in_pres = False
    for l in rest:
        if l.lower().startswith('presentaciones'): in_pres = True; continue
        is_prod = '®' in l or (in_pres and UNIT_RE.search(l) and not l.startswith(('http', 'Dosis', 'Más')))
        if not is_prod or l.startswith('http') or len(l) > 160: continue
        bm = re.search(r'([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ\-]*(?:\s[A-ZÁÉÍÓÚÑ\d][\wÁÉÍÓÚÑáéíóúñ\-]*){0,2})\s*®', l)
        b = bm.group(1).strip() if bm else ''
        p = clean_pres(l, b, title_words)
        if not p: continue
        if b and b not in brands: brands.append(b)
        pres.append((p, b))
    # Presentaciones iguales (o una que empieza como otra) se juntan con todas sus marcas
    merged = []
    for p, b in pres:
        k = nkey(p)
        hit = next((m for m in merged if m['k'] == k or m['k'].startswith(k + ' ') or k.startswith(m['k'] + ' ')), None)
        if hit:
            if len(p) > len(hit['p']): hit['p'], hit['k'] = p, k
            if b and b not in hit['b']: hit['b'].append(b)
        else:
            merged.append({'p': p, 'k': k, 'b': [b] if b else []})
    # Lo importante de la guía (sin enlaces a otras guías): dosis por indicación → pautas; 2-3 puntos clave → «Mis notas»
    sec, regs, cands = '', [], []
    for l in rest:
        if l.lower().startswith('presentaciones'): sec = 'Presentaciones'; continue
        if sec == 'Presentaciones' or l.startswith('http') or l == 'Más info' or '®' in l: continue
        if is_heading(l): sec = l; continue
        prot = re.sub(r'\b(máx|max|aprox|comp|sol|susp|cáps|caps|env|ej|amp|p\.ej)\.\s', lambda m: m.group(1) + '.§', l, flags=re.I)
        for snt in re.split(r'(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¡¿<>])', prot):
            snt = snt.replace('§', ' ').strip()
            if len(snt) < 25 or snt.startswith('('): continue
            general = not sec or sec.lower().startswith('recomendaciones') or sec.lower() in ('dosis',)
            if PERKG_RE.search(snt) and not general and len(regs) < 6:
                regs.append({'indication': sec, 'text': cut(snt, 300)})
                continue
            sc = sum(w for rx, w in KEYS if re.search(rx, snt, re.I))
            if sc > 0: cands.append((sc, len(cands), (f'{sec}: ' if not general and sec else '') + snt))
    return {'slug': slug, 'dose': dose, 'pres': merged, 'brands': brands, 'regs': regs, 'cands': [c for c in cands if c[0] >= 2]}

PERKG_RE = re.compile(r'\d\s*(mg|μg|µg|mcg|g|UI)\s*/\s*kg', re.I)
KEYS = [(r'\bno (se )?(recomienda|debe|deben|usar|utilizar|administrar|está indicad)', 3), (r'contraindicad|no indicad', 3),
        (r'(de|1ª|primera) elecci[oó]n', 3), (r'dosis m[aá]xima|m[aá]x\.|no superar|sin superar', 3), (r'precauci[oó]n|evitar|riesgo|toxicidad|interacci', 2),
        (r'[<>≤≥]\s*\d+\s*(años|meses|kg)|menores de|mayores de', 2), (r'duraci[oó]n|durante \d+ d[ií]as', 1), (r'sars|covid|coronavirus|situaci[oó]n epidemiol', -5)]
def cut(t, n):
    t = t.strip()
    return t if len(t) <= n else t[:n].rsplit(' ', 1)[0] + '…'
def nkey(p):
    return re.sub(r'[^a-z0-9/,%]+', ' ', unicodedata.normalize('NFD', p.lower()).encode('ascii', 'ignore').decode()).strip()
def is_heading(l):
    return len(l) < 60 and not l.endswith(('.', ':')) and not UNIT_RE.search(l) and '®' not in l and l[0].isupper()
PED_WORDS = r'\b(pedi[aá]tric[oa]s?|infantil(es)?|lactantes?|niños|adultos?|junior|kids?)\b'
def clean_pres(line, brand, title_words):
    t = re.sub(r'\s*[®™]\s*', ' ', line)
    if brand and t.lower().startswith(brand.lower()): t = t[len(brand):]
    words = t.split()
    while len(words) > 1 and not re.search(r'\d', words[0]) and re.sub(r'[^a-záéíóúñü]', '', words[0].lower()) in title_words: words = words[1:]
    t = ' '.join(words)
    t = re.sub(r'\((?:env|envase|caja)[^)]*\)', '', t, flags=re.I)                       # (env. 30 y 60 ml)
    t = re.sub(r'\((?:\d+(?:[.,]\d+)?\s*(?:,|y|-)?\s*)+(?:ml|comp\.?|sobres|viales|c[aá]ps\.?|sup\.?|unidades)\)', '', t, flags=re.I)  # (200 ml)
    t = re.sub(r'\benv\.?\s*[\d ,y]+$', '', t, flags=re.I)
    t = re.sub(r'\(\s*\d+\s*(?:amp|ampollas|viales|sobres|comp|c[aá]ps|unid|jeringas|plumas|dosis)\b[^)]*\)', '', t, flags=re.I)  # (60 amp 2 ml)
    t = re.sub(r'\bEFG\b', '', t)
    t = re.sub(PED_WORDS, '', t, flags=re.I)
    t = re.sub(r'\s+([,.;)])', r'\1', re.sub(r'\s+', ' ', t)).strip(' ,.;-')
    t = re.sub(r'\(\s*\)', '', t).strip()
    return t if re.search(r'\d', t) else ''

OLD = {}
def main():
    global OLD
    v1 = os.path.join(HERE, 'guia-v1.json')
    if os.path.exists(v1): OLD = {x['name']: x for x in json.load(open(v1, encoding='utf-8'))['drugs']}
    drugs = {}
    seen_img = {}
    files = sorted(glob.glob(os.path.join(OUT, '*.json')))
    for f in files:
        d = json.load(open(f, encoding='utf-8'))
        if d['path'].split('/')[1].startswith(('inicio',)): continue
        x = parse(d)
        slug = x['slug']
        title = d['text'].split('\n')[0].strip()
        name = NAMES.get(slug) or title
        secn = d['path'].split('/')[1].split('-')[0]
        sec = SECTION.get(secn, '')
        it = drugs.get(name)
        if not it:
            it = drugs[name] = {'name': name, 'profile': 'ped', 'folder': folder_of(d['path'], slug), 'brands': [], 'presentations': [], 'regimens': [],
                                'tags': ['Guía Aragón'], 'source': {'text': SRC_TEXT, 'url': d['url']}, 'notesHtml': '', 'tables': [], '_pages': [], '_cands': []}
        it['_pages'].append(sec)
        if secn == '10' and 'Urgencias' not in it['tags']: it['tags'].append('Urgencias')
        many = name in ('Adrenalina', 'Midazolam', 'Dexclorfeniramina', 'Metilprednisolona', 'Diazepam', 'Salbutamol')
        label = f'{sec} · {title}' if many else 'Dosis (Guía de Aragón)'
        for k, dl in enumerate(x['dose']):
            it['regimens'].append({'indication': label, 'text': dl, 'type': ''})
        for r in x['regs']:  # dosis por indicación que da la propia guía (p. ej. Neumonía: 90 mg/kg/día…)
            if r['text'] not in [q['text'] for q in it['regimens']]: it['regimens'].append({**r, 'type': ''})
        it['regimens'] = [r for i, r in enumerate(it['regimens']) if r['text'] not in [q['text'] for q in it['regimens'][:i]]]
        for b in x['brands']:
            if b not in it['brands']: it['brands'].append(b)
        for m in x['pres']:
            old = next((q for q in it['presentations'] if nkey(q['text']) == m['k']), None)
            if old: old['brands'] += [b for b in m['b'] if b not in old['brands']]
            else: it['presentations'].append({'text': m['p'], 'brands': list(m['b'])})
        it['_cands'] += x['cands']
        imgs = d['images']
        for k, im in enumerate(imgs):
            raw = open(os.path.join(OUT, 'img', im['file']), 'rb').read()
            h = hashlib.sha1(raw).hexdigest()
            if h in seen_img.get(name, set()): continue
            seen_img.setdefault(name, set()).add(h)
            mime = 'image/png' if im['file'].endswith('png') else 'image/jpeg' if im['file'].endswith('jpg') else 'image/webp'
            t = 'Tabla por peso' + (f' · {sec}' if many else '') + (f' ({k + 1} de {len(imgs)})' if len(imgs) > 1 else '')
            it['tables'].append({'title': t, 'key': f'gpa-{h[:16]}', 'source': {'text': SRC_TEXT, 'url': d['url']},
                                 'image': f'data:{mime};base64,{base64.b64encode(raw).decode()}'})
    out = []
    for it in drugs.values():
        pages = it.pop('_pages')
        # «Mis notas»: solo 2-3 puntos clave de la guía (o nada); el resto del espacio es para ti
        seen, best = set(), []
        for sc, i, t in sorted(it.pop('_cands'), key=lambda x: -x[0]):
            k = nkey(t.split(': ', 1)[-1])
            if k in seen: continue
            seen.add(k); best.append((i, t))
            if len(best) == 3: break
        it['notesHtml'] = f'<p><b>Puntos clave (Guía de Aragón)</b></p><ul>{"".join(f"<li>{esc(cut(t, 200))}</li>" for _, t in best)}</ul>' if best else ''
        if not it['regimens']:
            it['regimens'].append({'indication': 'Dosis (Guía de Aragón)', 'text': 'Ver «Tablas por peso».' if it['tables'] else 'Ver la ficha de la guía (enlace en «Fuente»).'})
        it['presentations'] = [q if q['brands'] else q['text'] for q in it['presentations']]
        # v2: actualizar lo importado con la v1 (presentaciones y «Mis notas») si no lo has cambiado tú
        o = OLD.get(it['name'])
        if o:
            it['guideUpdate'] = 2
            it['presOld'] = [q if isinstance(q, str) else q['text'] for q in o['presentations']]
        out.append(it)
    out.sort(key=lambda x: x['name'].lower())
    doc = {'format': 'drfolio-vademecum', 'version': 1, 'profile': 'ped',
           'about': f'{SRC_TEXT}: sites.google.com/view/guia-pediatrica-aragon. Para uso personal. Comprueba siempre las dosis.',
           'drugs': out}
    path = os.path.join(HERE, 'guia-pediatrica-aragon.json')
    json.dump(doc, open(path, 'w', encoding='utf-8'), ensure_ascii=False)
    n_t = sum(len(x['tables']) for x in out)
    print(len(out), 'fichas ·', n_t, 'tablas ·', os.path.getsize(path) // 1024, 'KB')

if __name__ == '__main__':
    main()
