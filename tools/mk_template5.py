#!/usr/bin/env python3
"""Plantilla v5 del Vademécum (v1.30.0): nueva organización por GRUPO TERAPÉUTICO, una sola carpeta por fármaco y
pocas subcarpetas. Las carpetas por contexto (Montaña y rescate, Soporte vital y urgencias) desaparecen: eso pasa a
ser una etiqueta (ámbito / etiquetas libres).

Se aplica sobre la v4 (tools/mk_template4.py) y es repetible: si la plantilla ya es v5 se vuelve a calcular el
destino de cada fármaco con el mismo mapeo. Solo cambia la carpeta de cada fármaco (nunca su contenido) y añade
«reorg» con el mapeo carpeta antigua → carpeta nueva, que usa el asistente «Nueva organización por carpetas» de la app
para las fichas que no reconoce por nombre.

Uso:  python3 tools/mk_template5.py
"""
import json, os, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
PATH = os.path.join(HERE, '..', 'public', 'plantillas', 'vademecum-ap-urgencias-montana.json')

# ---------- Estructura nueva (orden de los grupos = orden en el que salen) ----------
A = 'Analgesia y anestesia'
CV = 'Cardiovascular'
AI = 'Antiinfecciosos'
NP = 'Neurología y psiquiatría'
STRUCTURE = [
    f'{A} › Analgésicos', f'{A} › AINE', f'{A} › Opioides', f'{A} › Anestésicos locales y sedación',
    f'{CV} › Antihipertensivos y diuréticos', f'{CV} › Antiarrítmicos y vasoactivos',
    f'{CV} › Cardiopatía isquémica e insuficiencia cardiaca', f'{CV} › Hipolipemiantes',
    'Respiratorio', 'Digestivo',
    f'{AI} › Antibacterianos', f'{AI} › Antivirales, antifúngicos y antiparasitarios', f'{AI} › Vacunas e inmunoglobulinas',
    f'{NP} › Neurología', f'{NP} › Psiquiatría',
    'Endocrino y metabolismo', 'Sangre y anticoagulación', 'Alergia e inmunología', 'Dermatología', 'Oftalmología y ORL',
    'Urología y ginecología', 'Aparato locomotor', 'Sueros y electrolitos', 'Antídotos',
]

# ---------- Carpeta antigua (v2–v4) → carpeta nueva. None = se reparte fármaco a fármaco (no hay una sola) ----------
FOLDER_MAP = {
    'Alergia › Antihistamínicos': 'Alergia e inmunología',
    f'{A} › AINE': f'{A} › AINE',
    f'{A} › Analgésicos no opioides': f'{A} › Analgésicos',
    f'{A} › Anestésicos locales': f'{A} › Anestésicos locales y sedación',
    f'{A} › Dolor neuropático': f'{A} › Analgésicos',
    f'{A} › Opioides': f'{A} › Opioides',
    f'{A} › Sedoanalgesia': f'{A} › Anestésicos locales y sedación',
    f'{AI} › Antifúngicos': f'{AI} › Antivirales, antifúngicos y antiparasitarios',
    f'{AI} › Antiparasitarios': f'{AI} › Antivirales, antifúngicos y antiparasitarios',
    f'{AI} › Antivirales': f'{AI} › Antivirales, antifúngicos y antiparasitarios',
    f'{AI} › Cefalosporinas': f'{AI} › Antibacterianos',
    f'{AI} › Infección urinaria': f'{AI} › Antibacterianos',
    f'{AI} › Macrólidos': f'{AI} › Antibacterianos',
    f'{AI} › Otros antibacterianos': f'{AI} › Antibacterianos',
    f'{AI} › Penicilinas': f'{AI} › Antibacterianos',
    f'{AI} › Quinolonas': f'{AI} › Antibacterianos',
    f'{AI} › Vacunas e inmunoglobulinas': f'{AI} › Vacunas e inmunoglobulinas',
    'Antídotos y toxicología › Descontaminación digestiva': 'Antídotos',
    'Antídotos y toxicología › Humo, cianuro y monóxido': 'Antídotos',
    'Antídotos y toxicología › Opioides y benzodiacepinas': 'Antídotos',
    'Antídotos y toxicología › Paracetamol': 'Antídotos',
    f'{CV} › Antiagregantes': 'Sangre y anticoagulación',
    f'{CV} › Antianginosos': f'{CV} › Cardiopatía isquémica e insuficiencia cardiaca',
    f'{CV} › Antiarrítmicos y control de frecuencia': f'{CV} › Antiarrítmicos y vasoactivos',
    f'{CV} › Anticoagulantes': 'Sangre y anticoagulación',
    f'{CV} › Antihipertensivos': f'{CV} › Antihipertensivos y diuréticos',
    f'{CV} › Diuréticos': f'{CV} › Antihipertensivos y diuréticos',
    f'{CV} › Hipolipemiantes': f'{CV} › Hipolipemiantes',
    f'{CV} › Insuficiencia cardiaca': f'{CV} › Cardiopatía isquémica e insuficiencia cardiaca',
    'Dermatología › Acné y rosácea': 'Dermatología',
    'Dermatología › Antibióticos tópicos': 'Dermatología',
    'Dermatología › Antifúngicos tópicos': 'Dermatología',
    'Dermatología › Corticoides tópicos': 'Dermatología',
    'Dermatología › Quemaduras y heridas': 'Dermatología',
    'Digestivo › Antidiarreicos y rehidratación': 'Digestivo',
    'Digestivo › Antieméticos': 'Digestivo',
    'Digestivo › Antiácidos e IBP': 'Digestivo',
    'Digestivo › Espasmolíticos': 'Digestivo',
    'Digestivo › Hemorroides y patología anal': 'Digestivo',
    'Digestivo › Laxantes': 'Digestivo',
    'Endocrino y metabolismo › Antidiabéticos inyectables (GLP-1)': 'Endocrino y metabolismo',
    'Endocrino y metabolismo › Antidiabéticos orales': 'Endocrino y metabolismo',
    'Endocrino y metabolismo › Electrolitos': 'Sueros y electrolitos',
    'Endocrino y metabolismo › Hipoglucemia': 'Endocrino y metabolismo',
    'Endocrino y metabolismo › Insulinas': 'Endocrino y metabolismo',
    'Endocrino y metabolismo › Tiroides': 'Endocrino y metabolismo',
    'Ginecología y obstetricia › Anticoncepción de urgencia': 'Urología y ginecología',
    'Ginecología y obstetricia › Anticonceptivos': 'Urología y ginecología',
    'Ginecología y obstetricia › Embarazo y lactancia': 'Urología y ginecología',
    'Ginecología y obstetricia › Urgencias obstétricas': 'Urología y ginecología',
    'Hematología › Antianémicos': 'Sangre y anticoagulación',
    'Hematología › Antídotos de anticoagulantes': 'Sangre y anticoagulación',
    'Hematología › Hemostáticos': 'Sangre y anticoagulación',
    # Montaña y rescate: carpetas por contexto → cada fármaco a su grupo (y etiqueta «Montaña»)
    'Montaña y rescate › Analgesia en rescate': None,
    'Montaña y rescate › Edema cerebral de altura': None,
    'Montaña y rescate › Edema pulmonar de altura': None,
    'Montaña y rescate › Hipotermia y congelaciones': None,
    'Montaña y rescate › Mal agudo de montaña': None,
    'Montaña y rescate › Mordeduras y picaduras': None,
    'Musculoesquelético › Antiinflamatorios tópicos': 'Aparato locomotor',
    'Musculoesquelético › Gota': 'Aparato locomotor',
    'Musculoesquelético › Infiltraciones': 'Aparato locomotor',
    'Musculoesquelético › Osteoporosis': 'Aparato locomotor',
    'Musculoesquelético › Relajantes musculares': 'Aparato locomotor',
    f'{NP} › Alcohol y abstinencia': f'{NP} › Psiquiatría',
    f'{NP} › Ansiolíticos': f'{NP} › Psiquiatría',
    f'{NP} › Anticonvulsivantes': f'{NP} › Neurología',
    f'{NP} › Antidepresivos': f'{NP} › Psiquiatría',
    f'{NP} › Antipsicóticos y agitación': f'{NP} › Psiquiatría',
    f'{NP} › Demencia y Parkinson': f'{NP} › Neurología',
    f'{NP} › Hipnóticos': f'{NP} › Psiquiatría',
    f'{NP} › Migraña y cefalea': f'{NP} › Neurología',
    f'{NP} › Vértigo y mareo': f'{NP} › Neurología',
    'Oftalmología y ORL › Colirios': 'Oftalmología y ORL',
    'Oftalmología y ORL › Garganta y boca': 'Oftalmología y ORL',
    'Oftalmología y ORL › Otológicos': 'Oftalmología y ORL',
    'Respiratorio › Antitusivos y mucolíticos': 'Respiratorio',
    'Respiratorio › Broncodilatadores de rescate': 'Respiratorio',
    'Respiratorio › Corticoides sistémicos': 'Endocrino y metabolismo',
    'Respiratorio › Inhaladores de mantenimiento': 'Respiratorio',
    'Respiratorio › Oxigenoterapia': 'Respiratorio',
    'Respiratorio › Rinitis y congestión nasal': 'Respiratorio',
    'Soporte vital y urgencias › Bradicardia': f'{CV} › Antiarrítmicos y vasoactivos',
    'Soporte vital y urgencias › Parada y anafilaxia': f'{CV} › Antiarrítmicos y vasoactivos',
    'Soporte vital y urgencias › Secuencia rápida de intubación': f'{A} › Anestésicos locales y sedación',
    'Soporte vital y urgencias › Sueroterapia': 'Sueros y electrolitos',
    'Soporte vital y urgencias › Vasoactivos': f'{CV} › Antiarrítmicos y vasoactivos',
    'Urología › Disfunción eréctil': 'Urología y ginecología',
    'Urología › Próstata y vía urinaria': 'Urología y ginecología',
    'Urología › Vejiga hiperactiva': 'Urología y ginecología',
}

# ---------- Revisión fármaco a fármaco: los que no van donde dice su carpeta antigua ----------
DRUG_OVERRIDES = {
    # Montaña y rescate
    'Metoxiflurano': f'{A} › Analgésicos',                         # analgésico inhalado
    'Fentanilo': f'{A} › Opioides',
    'Dexametasona': 'Endocrino y metabolismo',                     # corticoide sistémico (con los demás)
    'Nifedipino retard': f'{CV} › Antihipertensivos y diuréticos',  # calcioantagonista
    'Iloprost': 'Sangre y anticoagulación',                        # ATC B01AC (antiagregante, prostaciclina)
    'Acetazolamida': f'{CV} › Antihipertensivos y diuréticos',      # diurético (inhibidor de la anhidrasa carbónica)
    'Antiveneno de víbora': 'Antídotos',
    # Otros que cambian de grupo
    'Calcifediol': 'Aparato locomotor',                            # vitamina D (con colecalciferol)
    'Glucosa': 'Endocrino y metabolismo',                          # hipoglucemia (con glucagón)
    'Biperideno': f'{NP} › Neurología',                            # anticolinérgico antiparkinsoniano (distonías)
    'Doxilamina/piridoxina': 'Digestivo',                          # antiemético (náuseas del embarazo)
    'Sales de rehidratación oral': 'Digestivo',
    'Propranolol': f'{NP} › Neurología',                           # en la plantilla está por migraña/temblor
    'Amitriptilina': f'{A} › Analgésicos',                         # en AP casi siempre por dolor neuropático
    'Sulfato de magnesio': 'Urología y ginecología',               # eclampsia (también asma / torsade: etiqueta Urgencias)
    'Clorhexidina': 'Dermatología',
    'Clorhexidina/benzocaína': 'Oftalmología y ORL',
    'Codeína': 'Respiratorio',                                     # antitusivo
    'Montelukast': 'Respiratorio',
    'Dapagliflozina': f'{CV} › Cardiopatía isquémica e insuficiencia cardiaca',
    'Etofenamato': 'Aparato locomotor',
    'Capsaicina tópica': f'{A} › Analgésicos',
    'Tiamina (vitamina B1)': f'{NP} › Psiquiatría',                # abstinencia / Wernicke (con clometiazol)
}


def main():
    t = json.load(open(PATH, encoding='utf-8'))
    old = t.get('templateVersion', 0)
    if old < 4:
        sys.exit('La plantilla no es v4: ejecuta antes mk_template.py, mk_template2.py, mk_template3.py y mk_template4.py')
    prev = t.get('reorg', {}).get('drugFolders', {})
    out = collections.OrderedDict((k, []) for k in STRUCTURE)
    drug_folders = {}
    for d in t['drugs']:
        # en una v5 ya generada, la carpeta antigua se recuerda en reorg.drugFolders (repetible)
        src = prev.get(d['name'], {}).get('from') or d['folder']
        dest = DRUG_OVERRIDES.get(d['name']) or FOLDER_MAP.get(src) or (src if src in STRUCTURE else None)
        if dest not in STRUCTURE:
            sys.exit(f'Sin destino: {d["name"]} ({src})')
        d['folder'] = dest
        drug_folders[d['name']] = {'from': src, 'to': dest}
        out[dest].append(d['name'])
    t['templateVersion'] = 5
    t['about'] = ('Plantilla de Dr.Folio (v5) para Atención Primaria, Urgencias y Rescate en montaña: carpetas por grupo '
                  'terapéutico (una sola por fármaco, pocas subcarpetas) con los fármacos y nombres comerciales principales. '
                  'El contexto (AP, Urgencias, Montaña) va en etiquetas. Dosis de adulto orientativas: revísalas antes de usarlas.')
    t['reorg'] = {
        'version': 1,
        'structure': STRUCTURE,
        'folderMap': {k: v for k, v in FOLDER_MAP.items()},
        'contextFolders': ['Montaña y rescate', 'Soporte vital y urgencias'],  # carpetas por contexto → etiqueta
        'mountainFolders': ['Montaña y rescate'],
        'drugFolders': drug_folders,
    }
    json.dump(t, open(PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for k, v in out.items():
        print(f'{len(v):3d}  {k}')
    print(f'{sum(len(v) for v in out.values())} fármacos en {len(STRUCTURE)} carpetas · plantilla v{old} → v5')


if __name__ == '__main__':
    main()
