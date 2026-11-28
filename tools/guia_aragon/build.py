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
    slug = d['path'].rstrip('/').split('/')[-1]
    # título (algunas páginas lo parten en 2 líneas)
    body = lines[1:]
    if lines[0].endswith('+') and body: body = body[1:]
    dose, i = [], 0
    while i < len(body) and len(dose) < 4 and DOSE_RE.search(body[i]) and len(body[i]) < 120:
        dose.append(body[i]); i += 1
    rest = body[i:]
    # presentaciones: lo que está bajo «Presentaciones» y tiene pinta de producto, y cualquier línea con ®
    pres, brands, pb = [], [], []
    in_pres = False
    for l in rest:
        if l.lower().startswith('presentaciones'): in_pres = True; continue
        is_prod = '®' in l or (in_pres and PROD_RE.search(l) and UNIT_RE.search(l))
        if not is_prod or l.startswith('http') or len(l) > 160: continue
        p = re.sub(r'\s*®\s*', ' ', l).replace('  ', ' ').strip()
        if p not in pres: pres.append(p)
        for m in re.finditer(r'([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ\-]*(?:\s[A-ZÁÉÍÓÚÑ\d][\wÁÉÍÓÚÑáéíóúñ\-]*){0,2})\s*®', l):
            b = m.group(1).strip()
            if b not in brands: brands.append(b)
            pb.append({'text': p, 'brands': [b]})
    # «Mis notas»: la página entera (salvo título y dosis), en orden, con títulos y enlaces
    parts = []
    for l in rest:
        if l.startswith('http'):
            u = clean_url(l); parts.append(f'<p><a href="{esc(u)}" target="_blank" rel="noopener noreferrer">{esc(u)}</a></p>')
        elif l == 'Más info':
            continue
        elif len(l) < 60 and not l.endswith('.') and not UNIT_RE.search(l) and '®' not in l and l[0].isupper() and not l.endswith(':'):
            parts.append(f'<h3>{esc(l)}</h3>')
        else:
            parts.append(f'<p>{esc(l)}</p>')
    return {'slug': slug, 'dose': dose, 'pres': pres, 'brands': brands, 'pb': pb, 'html': ''.join(parts), 'text': '\n'.join(rest)}

def main():
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
                                'tags': ['Guía Aragón'], 'source': {'text': SRC_TEXT, 'url': d['url']}, 'notesHtml': '', 'tables': [], '_pages': []}
        it['_pages'].append(sec)
        if secn == '10' and 'Urgencias' not in it['tags']: it['tags'].append('Urgencias')
        many = name in ('Adrenalina', 'Midazolam', 'Dexclorfeniramina', 'Metilprednisolona', 'Diazepam', 'Salbutamol')
        label = f'{sec} · {title}' if many else 'Dosis (Guía de Aragón)'
        for k, dl in enumerate(x['dose']):
            it['regimens'].append({'indication': label, 'text': dl, 'type': ''})
        for b in x['brands']:
            if b not in it['brands']: it['brands'].append(b)
        for p in x['pres']:
            if p not in [q if isinstance(q, str) else q['text'] for q in it['presentations']]:
                br = [e['brands'][0] for e in x['pb'] if e['text'] == p]
                it['presentations'].append({'text': p, 'brands': br} if br else p)
        head = f'<h2>{esc(sec)} · {esc(title)}</h2>' if many else ''
        link = f'<p><a href="{esc(d["url"])}" target="_blank" rel="noopener noreferrer">Ficha en la Guía de dosificación pediátrica de Aragón</a></p>'
        it['notesHtml'] += head + x['html'] + link
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
        if not it['regimens']:
            it['regimens'].append({'indication': 'Dosis (Guía de Aragón)', 'text': 'Ver «Tablas por peso» y «Mis notas» (recomendaciones de la guía).' if it['tables'] else 'Ver «Mis notas» (recomendaciones y pautas de la guía).'})
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
