import json
# (carpeta, nombre, marcas, presentaciones, [pautas: (indicación, presentación, vía, dosis, frecuencia, duración, máx)])
D = []
def add(folder, name, brands, pres, regs):
    D.append({"name": name, "brands": brands, "folder": folder, "presentations": pres,
              "regimens": [dict(zip(["indication", "presentation", "route", "dose", "frequency", "duration", "max"], r)) for r in regs]})

# ---------- Analgesia y anestesia ----------
add("Analgesia y anestesia › Analgésicos no opioides", "Paracetamol", ["Gelocatil", "Termalgin", "Efferalgan", "Perfalgan"],
    ["650 mg comp", "1 g comp", "1 g sobres", "1 g/100 ml vial IV"],
    [("Dolor leve o fiebre", "1 g comp", "VO", "1 g", "cada 8 h", "", "4 g/día (3 g/día si hepatopatía, alcoholismo o < 50 kg)"),
     ("Dolor moderado (urgencias)", "1 g/100 ml vial IV", "IV en 15 min", "1 g", "cada 8 h", "", "4 g/día")])
add("Analgesia y anestesia › Analgésicos no opioides", "Metamizol", ["Nolotil"], ["575 mg cáps", "2 g/5 ml amp"],
    [("Dolor moderado o fiebre", "575 mg cáps", "VO", "1 cáps", "cada 8 h", "", "6 cáps/día"),
     ("Dolor agudo (urgencias)", "2 g/5 ml amp", "IV lenta diluida", "2 g", "cada 8 h", "", "6 g/día")])
add("Analgesia y anestesia › AINE", "Ibuprofeno", ["Espidifen", "Dalsy", "Neobrufen"], ["400 mg comp", "600 mg comp", "600 mg sobres"],
    [("Dolor o inflamación", "600 mg comp", "VO con comida", "600 mg", "cada 8 h", "5 días", "2.400 mg/día"),
     ("Congelaciones (desde el rescate)", "400 mg comp", "VO", "400 mg", "cada 12 h", "", "")])
add("Analgesia y anestesia › AINE", "Dexketoprofeno", ["Enantyum", "Ketesse"], ["25 mg comp", "25 mg sobres", "50 mg/2 ml amp"],
    [("Dolor agudo leve-moderado", "25 mg comp", "VO", "1 comp", "cada 8 h", "5 días", "75 mg/día"),
     ("Cólico renal o dolor agudo (urgencias)", "50 mg/2 ml amp", "IV lenta o IM", "50 mg", "cada 8-12 h", "2 días", "150 mg/día")])
add("Analgesia y anestesia › Opioides", "Tramadol", ["Adolonta", "Tradonal"], ["50 mg cáps", "100 mg/2 ml amp"],
    [("Dolor moderado-intenso", "50 mg cáps", "VO", "50-100 mg", "cada 6-8 h", "", "400 mg/día")])
add("Analgesia y anestesia › Opioides", "Morfina", ["Cloruro mórfico Braun", "Oramorph", "Sevredol"], ["10 mg/1 ml amp", "10 mg comp"],
    [("Dolor intenso (urgencias)", "10 mg/1 ml amp", "IV lenta (diluir 1 amp en 9 ml SF)", "2-3 mg", "cada 5 min hasta control", "", "titular según respuesta; vigilar FR y sedación")])
add("Analgesia y anestesia › Anestésicos locales", "Lidocaína", ["Lidocaína Braun"], ["1% amp (10 mg/ml)", "2% amp (20 mg/ml)"],
    [("Infiltración local (suturas)", "1% amp (10 mg/ml)", "Infiltración SC", "según la herida", "", "", "4,5 mg/kg (≤ 300 mg) sin adrenalina")])
add("Analgesia y anestesia › Sedoanalgesia", "Ketamina", ["Ketolar"], ["50 mg/ml vial 10 ml"],
    [("Analgesia (dosis subdisociativa)", "50 mg/ml vial 10 ml", "IV lenta", "0,1-0,3 mg/kg", "cada 10-15 min si precisa", "", ""),
     ("Inducción o sedación para procedimientos", "50 mg/ml vial 10 ml", "IV", "1-2 mg/kg", "", "", "IM: 4-5 mg/kg")])
add("Analgesia y anestesia › Sedoanalgesia", "Midazolam", ["Dormicum"], ["5 mg/5 ml amp", "15 mg/3 ml amp"],
    [("Sedación para procedimientos", "5 mg/5 ml amp", "IV lenta", "1-2 mg", "cada 2-3 min hasta efecto", "", "ancianos: dosis menores"),
     ("Crisis convulsiva (sin vía)", "15 mg/3 ml amp", "IM", "10 mg (> 40 kg)", "dosis única", "", "")])

# ---------- Cardiovascular ----------
add("Cardiovascular › Antihipertensivos", "Enalapril", ["Renitec"], ["5 mg comp", "20 mg comp"],
    [("Hipertensión arterial", "5 mg comp", "VO", "5 mg", "cada 24 h", "crónico", "40 mg/día")])
add("Cardiovascular › Antihipertensivos", "Amlodipino", ["Norvas"], ["5 mg comp", "10 mg comp"],
    [("Hipertensión arterial", "5 mg comp", "VO", "5 mg", "cada 24 h", "crónico", "10 mg/día")])
add("Cardiovascular › Diuréticos", "Furosemida", ["Seguril"], ["40 mg comp", "20 mg/2 ml amp"],
    [("Edemas o insuficiencia cardiaca", "40 mg comp", "VO", "40 mg", "cada 24 h por la mañana", "", ""),
     ("Edema agudo de pulmón", "20 mg/2 ml amp", "IV lenta", "40 mg (o 1 mg/kg)", "repetir según diuresis", "", "")])
add("Cardiovascular › Diuréticos", "Hidroclorotiazida", ["Esidrex", "Hidrosaluretil"], ["25 mg comp", "50 mg comp"],
    [("Hipertensión arterial", "25 mg comp", "VO", "12,5-25 mg", "cada 24 h", "crónico", "")])
add("Cardiovascular › Antiarrítmicos y control de frecuencia", "Bisoprolol", ["Emconcor"], ["2,5 mg comp", "5 mg comp", "10 mg comp"],
    [("Control de frecuencia en FA / cardiopatía isquémica", "2,5 mg comp", "VO", "2,5 mg", "cada 24 h", "crónico (subir según FC)", "10 mg/día")])
add("Cardiovascular › Antiarrítmicos y control de frecuencia", "Amiodarona", ["Trangorex"], ["150 mg/3 ml amp", "200 mg comp"],
    [("FA o arritmia ventricular estable", "150 mg/3 ml amp", "IV en SG5% (vía central preferible)", "300 mg (5 mg/kg)", "en 20-60 min", "después 900 mg en 24 h", "1,2 g en 24 h"),
     ("Parada: FV/TV sin pulso tras 3.ª descarga", "150 mg/3 ml amp", "IV/IO en bolo", "300 mg", "150 mg tras la 5.ª descarga", "", "")])
add("Cardiovascular › Antianginosos", "Nitroglicerina", ["Vernies", "Solinitrina", "Trinispray"], ["0,4 mg/pulsación spray SL", "0,4 mg comp SL", "5 mg/5 ml amp"],
    [("Dolor torácico anginoso (si PAS > 90)", "0,4 mg/pulsación spray SL", "SL", "1 pulsación", "cada 5 min", "", "3 dosis; no si iPDE5 en 24-48 h")])
add("Cardiovascular › Antiagregantes", "Ácido acetilsalicílico", ["Adiro", "Tromalyt"], ["100 mg comp", "300 mg comp", "500 mg comp"],
    [("Prevención secundaria", "100 mg comp", "VO", "100 mg", "cada 24 h", "crónico", ""),
     ("Sospecha de síndrome coronario agudo", "300 mg comp", "VO masticado", "150-300 mg", "dosis de carga", "", "")])
add("Cardiovascular › Antiagregantes", "Clopidogrel", ["Plavix", "Iscover"], ["75 mg comp", "300 mg comp"],
    [("Prevención secundaria", "75 mg comp", "VO", "75 mg", "cada 24 h", "", ""),
     ("Carga en SCA (según protocolo)", "300 mg comp", "VO", "300-600 mg", "dosis única", "", "")])
add("Cardiovascular › Anticoagulantes", "Enoxaparina", ["Clexane", "Hepaxane", "Inhixa"], ["40 mg jer", "60 mg jer", "80 mg jer", "100 mg jer"],
    [("Profilaxis de ETV", "40 mg jer", "SC", "40 mg", "cada 24 h", "mientras dure el riesgo", "20 mg si FG < 30"),
     ("Tratamiento de TVP/TEP", "", "SC", "1 mg/kg", "cada 12 h", "", "ajustar si FG < 30")])
add("Cardiovascular › Anticoagulantes", "Apixabán", ["Eliquis"], ["2,5 mg comp", "5 mg comp"],
    [("FA no valvular", "5 mg comp", "VO", "5 mg", "cada 12 h", "crónico", "2,5 mg/12 h si 2 de: ≥ 80 años, ≤ 60 kg, Cr ≥ 1,5")])
add("Cardiovascular › Hipolipemiantes", "Atorvastatina", ["Cardyl", "Zarator"], ["10 mg comp", "20 mg comp", "40 mg comp", "80 mg comp"],
    [("Hipercolesterolemia / prevención CV", "20 mg comp", "VO", "10-80 mg", "cada 24 h", "crónico", "80 mg/día")])

# ---------- Respiratorio ----------
add("Respiratorio › Broncodilatadores de rescate", "Salbutamol", ["Ventolin", "Buto-Asma"], ["100 mcg/inh aerosol", "5 mg/ml solución para nebulizar", "2,5 mg/2,5 ml amp nebulizar"],
    [("Broncoespasmo leve", "100 mcg/inh aerosol", "Inhalada con cámara", "2-4 inhalaciones", "a demanda (cada 20 min la 1.ª hora en crisis)", "", ""),
     ("Crisis asmática o EPOC moderada-grave", "5 mg/ml solución para nebulizar", "Nebulizado (O2 6-8 l/min)", "2,5-5 mg", "cada 20 min x3, luego cada 4-6 h", "", "")])
add("Respiratorio › Broncodilatadores de rescate", "Bromuro de ipratropio", ["Atrovent"], ["20 mcg/inh aerosol", "500 mcg/2 ml amp nebulizar"],
    [("Crisis asmática grave / agudización EPOC", "500 mcg/2 ml amp nebulizar", "Nebulizado junto a salbutamol", "500 mcg", "cada 20 min x3, luego cada 6-8 h", "", "")])
add("Respiratorio › Inhaladores de mantenimiento", "Budesonida/formoterol", ["Symbicort", "Rilast", "Bufomix"], ["160/4,5 mcg Turbuhaler", "320/9 mcg Turbuhaler"],
    [("Asma o EPOC (mantenimiento)", "160/4,5 mcg Turbuhaler", "Inhalada", "1-2 inhalaciones", "cada 12 h", "crónico", "asma MART: hasta 12 inh/día")])
add("Respiratorio › Inhaladores de mantenimiento", "Tiotropio", ["Spiriva", "Spiriva Respimat"], ["18 mcg cáps inhalación", "2,5 mcg/pulsación Respimat"],
    [("EPOC (mantenimiento)", "2,5 mcg/pulsación Respimat", "Inhalada", "2 pulsaciones", "cada 24 h", "crónico", "")])
add("Respiratorio › Corticoides sistémicos", "Prednisona", ["Dacortin", "Prednisona Cinfa"], ["5 mg comp", "30 mg comp", "50 mg comp"],
    [("Agudización de asma o EPOC", "30 mg comp", "VO", "40-50 mg", "cada 24 h por la mañana", "5 días", "")])
add("Respiratorio › Corticoides sistémicos", "Metilprednisolona", ["Urbason", "Solu-Moderin"], ["40 mg vial", "125 mg vial", "4 mg comp"],
    [("Crisis asmática grave / anafilaxia (adyuvante)", "40 mg vial", "IV o IM", "1-2 mg/kg (habitual 40-80 mg)", "dosis única, repetir según evolución", "", "")])
add("Respiratorio › Antitusivos y mucolíticos", "Dextrometorfano", ["Romilar", "Bisolvon antitusivo"], ["15 mg/5 ml jarabe", "15 mg comp"],
    [("Tos seca molesta", "15 mg comp", "VO", "15-30 mg", "cada 6-8 h", "máx 7 días", "120 mg/día")])

# ---------- Antiinfecciosos ----------
add("Antiinfecciosos › Penicilinas", "Amoxicilina/ácido clavulánico", ["Augmentine", "Clavumox"], ["875/125 mg comp", "500/125 mg comp", "1 g/200 mg vial IV"],
    [("Sinusitis, otitis, neumonía o mordedura", "875/125 mg comp", "VO", "875/125 mg", "cada 8 h", "5-7 días", "")])
add("Antiinfecciosos › Penicilinas", "Amoxicilina", ["Clamoxyl"], ["500 mg cáps", "750 mg comp", "1 g comp"],
    [("Faringoamigdalitis estreptocócica", "500 mg cáps", "VO", "500 mg", "cada 8-12 h", "10 días", ""),
     ("Neumonía adquirida en la comunidad", "1 g comp", "VO", "1 g", "cada 8 h", "5-7 días", "")])
add("Antiinfecciosos › Macrólidos", "Azitromicina", ["Zitromax", "Toraseptol"], ["500 mg comp", "200 mg/5 ml suspensión"],
    [("Infección respiratoria (alergia a penicilina)", "500 mg comp", "VO", "500 mg", "cada 24 h", "3 días", "")])
add("Antiinfecciosos › Cefalosporinas", "Ceftriaxona", ["Rocefalin"], ["1 g vial IV", "1 g vial IM", "2 g vial IV"],
    [("Infección grave / sospecha de meningitis (prehospitalario según protocolo)", "2 g vial IV", "IV o IM", "1-2 g", "cada 24 h (meningitis 2 g/12 h)", "", "")])
add("Antiinfecciosos › Quinolonas", "Levofloxacino", ["Tavanic"], ["500 mg comp", "500 mg/100 ml vial IV"],
    [("Neumonía (alergia a betalactámicos)", "500 mg comp", "VO", "500 mg", "cada 24 h (o 12 h si grave)", "5-7 días", "")])
add("Antiinfecciosos › Infección urinaria", "Fosfomicina trometamol", ["Monurol"], ["3 g sobres"],
    [("Cistitis no complicada en la mujer", "3 g sobres", "VO en ayunas", "3 g", "dosis única", "", "")])
add("Antiinfecciosos › Infección urinaria", "Nitrofurantoína", ["Furantoina"], ["50 mg cáps"],
    [("Cistitis no complicada", "50 mg cáps", "VO con comida", "50-100 mg", "cada 6-8 h", "5-7 días", "evitar si FG < 45")])
add("Antiinfecciosos › Antivirales", "Valaciclovir", ["Valtrex"], ["500 mg comp", "1 g comp"],
    [("Herpes zóster", "1 g comp", "VO", "1 g", "cada 8 h", "7 días", ""),
     ("Herpes labial", "1 g comp", "VO", "2 g", "cada 12 h", "1 día", "")])
add("Antiinfecciosos › Antifúngicos", "Fluconazol", ["Diflucan"], ["50 mg cáps", "150 mg cáps"],
    [("Candidiasis vaginal", "150 mg cáps", "VO", "150 mg", "dosis única", "", "")])
add("Antiinfecciosos › Antiparasitarios", "Mebendazol", ["Lomper"], ["100 mg comp", "100 mg/5 ml suspensión"],
    [("Oxiuriasis", "100 mg comp", "VO", "100 mg", "dosis única", "repetir a las 2 semanas", "")])

# ---------- Digestivo ----------
add("Digestivo › Antiácidos e IBP", "Omeprazol", ["Losec", "Omeprazol Cinfa"], ["20 mg cáps", "40 mg vial IV"],
    [("Protección gástrica / ERGE", "20 mg cáps", "VO en ayunas", "20 mg", "cada 24 h", "mientras dure el riesgo", ""),
     ("Hemorragia digestiva alta", "40 mg vial IV", "IV", "80 mg en bolo", "después 40 mg cada 12 h", "", "")])
add("Digestivo › Antieméticos", "Ondansetrón", ["Zofran", "Yatrox"], ["4 mg comp bucodispersables", "8 mg comp", "4 mg/2 ml amp"],
    [("Náuseas y vómitos", "4 mg/2 ml amp", "IV lenta o IM", "4 mg", "cada 8 h", "", "16 mg dosis IV única; vigilar QT")])
add("Digestivo › Antieméticos", "Metoclopramida", ["Primperan"], ["10 mg comp", "10 mg/2 ml amp"],
    [("Náuseas y vómitos", "10 mg comp", "VO o IV lenta", "10 mg", "cada 8 h", "máx 5 días", "30 mg/día")])
add("Digestivo › Antidiarreicos y rehidratación", "Loperamida", ["Fortasec"], ["2 mg cáps", "2 mg comp bucodispersables"],
    [("Diarrea aguda sin fiebre ni sangre", "2 mg cáps", "VO", "4 mg inicial, luego 2 mg tras cada deposición", "", "máx 2 días", "16 mg/día")])
add("Digestivo › Antidiarreicos y rehidratación", "Sales de rehidratación oral", ["Sueroral", "Cito-Oral"], ["sobres", "solución lista para tomar"],
    [("Deshidratación leve-moderada", "sobres", "VO", "1 sobre en 1 l de agua", "a pequeños sorbos tras cada deposición", "", "")])
add("Digestivo › Laxantes", "Macrogol", ["Movicol", "Casenlax"], ["13,8 g sobres", "10 g sobres"],
    [("Estreñimiento", "13,8 g sobres", "VO", "1-3 sobres", "cada 24 h", "", "")])
add("Digestivo › Espasmolíticos", "Butilescopolamina", ["Buscapina"], ["10 mg grageas", "20 mg/1 ml amp"],
    [("Dolor cólico abdominal", "10 mg grageas", "VO", "10-20 mg", "cada 6-8 h", "", "60 mg/día"),
     ("Cólico (urgencias)", "20 mg/1 ml amp", "IV lenta o IM", "20 mg", "dosis única, repetible", "", "100 mg/día")])

# ---------- Endocrino y metabolismo ----------
add("Endocrino y metabolismo › Antidiabéticos orales", "Metformina", ["Dianben"], ["850 mg comp", "1.000 mg comp"],
    [("Diabetes tipo 2", "850 mg comp", "VO con comidas", "425-850 mg", "cada 12-24 h; subir cada 1-2 semanas", "crónico", "3 g/día; reducir si FG < 45, suspender si < 30")])
add("Endocrino y metabolismo › Antidiabéticos orales", "Empagliflozina", ["Jardiance"], ["10 mg comp", "25 mg comp"],
    [("DM2 / IC / ERC", "10 mg comp", "VO", "10 mg", "cada 24 h", "crónico", "")])
add("Endocrino y metabolismo › Insulinas", "Insulina glargina", ["Lantus", "Abasaglar", "Toujeo"], ["100 UI/ml pluma SoloStar"],
    [("Inicio de insulina basal en DM2", "100 UI/ml pluma SoloStar", "SC", "10 UI (o 0,1-0,2 UI/kg)", "cada 24 h a la misma hora", "ajustar 2 UI cada 3 días según glucemia basal", "")])
add("Endocrino y metabolismo › Hipoglucemia", "Glucagón", ["GlucaGen Hypokit", "Baqsimi"], ["1 mg vial + jeringa", "3 mg polvo nasal"],
    [("Hipoglucemia grave sin vía", "1 mg vial + jeringa", "IM o SC", "1 mg", "dosis única", "", "")])
add("Endocrino y metabolismo › Hipoglucemia", "Glucosa hipertónica", ["Glucosmon R50", "Glucosa 33%"], ["50% amp 20 ml (10 g)"],
    [("Hipoglucemia grave con vía", "50% amp 20 ml (10 g)", "IV lenta por vía gruesa", "10-20 g (20-40 ml)", "repetir según glucemia", "", "")])
add("Endocrino y metabolismo › Tiroides", "Levotiroxina", ["Eutirox", "Levothroid"], ["25 mcg comp", "50 mcg comp", "100 mcg comp"],
    [("Hipotiroidismo", "50 mcg comp", "VO en ayunas", "25-50 mcg (1,6 mcg/kg en jóvenes)", "cada 24 h", "crónico; control TSH a las 6-8 semanas", "")])

# ---------- Neurología y psiquiatría ----------
add("Neurología y psiquiatría › Anticonvulsivantes", "Diazepam", ["Valium", "Stesolid"], ["5 mg comp", "10 mg/2 ml amp", "5 mg y 10 mg microenema rectal"],
    [("Crisis convulsiva (sin vía)", "5 mg y 10 mg microenema rectal", "Rectal", "10 mg", "repetir a los 10 min si persiste", "", ""),
     ("Crisis convulsiva (con vía)", "10 mg/2 ml amp", "IV lenta", "5-10 mg", "repetir a los 5-10 min si persiste", "", "20 mg")])
add("Neurología y psiquiatría › Anticonvulsivantes", "Levetiracetam", ["Keppra"], ["500 mg comp", "500 mg/5 ml vial IV"],
    [("Estatus epiléptico (2.ª línea)", "500 mg/5 ml vial IV", "IV en 10-15 min", "60 mg/kg", "dosis única", "", "4.500 mg")])
add("Neurología y psiquiatría › Migraña y cefalea", "Sumatriptán", ["Imigran"], ["50 mg comp", "6 mg/0,5 ml jer SC", "20 mg spray nasal"],
    [("Crisis de migraña", "50 mg comp", "VO", "50-100 mg", "repetir a las 2 h si reaparece", "", "300 mg/día")])
add("Neurología y psiquiatría › Vértigo y mareo", "Dimenhidrinato", ["Biodramina"], ["50 mg comp", "50 mg chicles"],
    [("Mareo cinético / vértigo", "50 mg comp", "VO", "50-100 mg", "cada 4-6 h (30 min antes del viaje)", "", "400 mg/día")])
add("Neurología y psiquiatría › Vértigo y mareo", "Sulpirida", ["Dogmatil"], ["50 mg cáps", "100 mg/2 ml amp"],
    [("Crisis de vértigo periférico", "100 mg/2 ml amp", "IM", "100 mg", "dosis única", "después VO 50 mg cada 8 h, pocos días", "")])
add("Neurología y psiquiatría › Ansiolíticos", "Lorazepam", ["Orfidal", "Idalprem"], ["1 mg comp", "5 mg comp"],
    [("Crisis de ansiedad", "1 mg comp", "VO o SL", "1 mg", "hasta cada 8 h", "uso corto", "")])
add("Neurología y psiquiatría › Antidepresivos", "Sertralina", ["Besitran"], ["50 mg comp", "100 mg comp"],
    [("Depresión / ansiedad", "50 mg comp", "VO", "50 mg", "cada 24 h", "≥ 6 meses tras remisión", "200 mg/día")])
add("Neurología y psiquiatría › Antipsicóticos y agitación", "Haloperidol", ["Haloperidol Esteve"], ["5 mg/1 ml amp", "2 mg/ml gotas"],
    [("Agitación psicomotriz", "5 mg/1 ml amp", "IM", "2,5-5 mg", "repetir cada 30-60 min si precisa", "", "20 mg/día; vigilar QT y extrapiramidalismo")])
add("Neurología y psiquiatría › Antipsicóticos y agitación", "Olanzapina", ["Zyprexa", "Zyprexa Velotab"], ["5 mg y 10 mg comp bucodispersables", "10 mg vial IM"],
    [("Agitación (colabora para VO)", "5 mg y 10 mg comp bucodispersables", "VO bucodispersable", "5-10 mg", "repetir a las 2 h si precisa", "", "20 mg/día")])

# ---------- Alergia ----------
add("Alergia › Antihistamínicos", "Dexclorfeniramina", ["Polaramine"], ["2 mg comp", "5 mg/1 ml amp"],
    [("Urticaria o reacción alérgica", "5 mg/1 ml amp", "IV lenta o IM", "5 mg", "cada 6-8 h", "", "20 mg/día"),
     ("Urticaria leve", "2 mg comp", "VO", "2 mg", "cada 6-8 h", "", "12 mg/día")])
add("Alergia › Antihistamínicos", "Cetirizina", ["Zyrtec", "Alerlisin"], ["10 mg comp"],
    [("Rinitis o urticaria", "10 mg comp", "VO", "10 mg", "cada 24 h", "", "")])

# ---------- Hematología ----------
add("Hematología › Hemostáticos", "Ácido tranexámico", ["Amchafibrin"], ["500 mg comp", "500 mg/5 ml amp"],
    [("Hemorragia grave por trauma (< 3 h)", "500 mg/5 ml amp", "IV en 10 min", "1 g", "dosis de carga", "después 1 g en 8 h", ""),
     ("Epistaxis (tópico)", "500 mg/5 ml amp", "Tópico en gasa intranasal", "500 mg", "", "", "")])
add("Hematología › Antídotos de anticoagulantes", "Fitomenadiona (vitamina K)", ["Konakion"], ["10 mg/1 ml amp"],
    [("INR alto con sangrado (con complejo protrombínico)", "10 mg/1 ml amp", "IV lenta diluida", "10 mg", "dosis única", "", ""),
     ("INR alto sin sangrado", "10 mg/1 ml amp", "VO (contenido de la ampolla)", "1-2 mg", "dosis única", "", "")])
add("Hematología › Antianémicos", "Sulfato ferroso", ["Ferogradumet", "Tardyferon"], ["105 mg Fe comp", "80 mg Fe comp"],
    [("Anemia ferropénica", "105 mg Fe comp", "VO en ayunas (o días alternos)", "1 comp", "cada 24 h", "3 meses tras normalizar Hb", "")])

# ---------- Musculoesquelético ----------
add("Musculoesquelético › Gota", "Colchicina", ["Colchicine Seid"], ["1 mg comp", "0,5 mg comp"],
    [("Crisis de gota", "0,5 mg comp", "VO", "1 mg y 0,5 mg 1 h después", "luego 0,5 mg cada 8-12 h", "hasta resolución", "1,5 mg el primer día; reducir si ERC")])
add("Musculoesquelético › Gota", "Alopurinol", ["Zyloric"], ["100 mg comp", "300 mg comp"],
    [("Hiperuricemia / prevención de gota", "100 mg comp", "VO", "100 mg", "cada 24 h; subir hasta urato < 6", "crónico", "ajustar a FG")])
add("Musculoesquelético › Osteoporosis", "Ácido alendrónico", ["Fosamax"], ["70 mg comp"],
    [("Osteoporosis", "70 mg comp", "VO en ayunas con agua, de pie 30 min", "70 mg", "1 vez a la semana", "5 años y reevaluar", "")])

# ---------- Urología ----------
add("Urología › Próstata y vía urinaria", "Tamsulosina", ["Omnic", "Urolosin"], ["0,4 mg cáps"],
    [("HBP / expulsión de cálculo distal", "0,4 mg cáps", "VO tras el desayuno", "0,4 mg", "cada 24 h", "", "")])

# ---------- Dermatología ----------
add("Dermatología › Corticoides tópicos", "Metilprednisolona aceponato", ["Adventan", "Lexxema"], ["0,1% crema", "0,1% pomada"],
    [("Eccema o dermatitis", "0,1% crema", "Tópica", "capa fina", "cada 24 h", "máx 2-4 semanas en adultos", "")])
add("Dermatología › Antibióticos tópicos", "Mupirocina", ["Bactroban", "Plasimine"], ["2% pomada"],
    [("Impétigo o herida infectada superficial", "2% pomada", "Tópica", "capa fina", "cada 8 h", "5-10 días", "")])
add("Dermatología › Antifúngicos tópicos", "Clotrimazol", ["Canesten"], ["1% crema", "1% solución"],
    [("Tiña o candidiasis cutánea", "1% crema", "Tópica", "capa fina", "cada 8-12 h", "2-4 semanas", "")])
add("Dermatología › Quemaduras y heridas", "Sulfadiazina argéntica", ["Silvederma"], ["1% crema"],
    [("Quemadura de 2.º grado", "1% crema", "Tópica", "capa de 2-3 mm", "cada 12-24 h con la cura", "", "")])

# ---------- Oftalmología y ORL ----------
add("Oftalmología y ORL › Colirios", "Tobramicina colirio", ["Tobrex"], ["0,3% colirio", "0,3% pomada oftálmica"],
    [("Conjuntivitis bacteriana", "0,3% colirio", "Oftálmica", "1-2 gotas", "cada 4-6 h", "7 días", "")])
add("Oftalmología y ORL › Colirios", "Oxibuprocaína/tetracaína colirio", ["Colircusi anestésico doble"], ["colirio 10 ml"],
    [("Exploración ocular / cuerpo extraño (solo en consulta)", "colirio 10 ml", "Oftálmica", "1-2 gotas", "dosis única", "", "no prescribir para casa")])
add("Oftalmología y ORL › Otológicos", "Ciprofloxacino ótico", ["Cetraxal ótico", "Baycip ótico"], ["0,3% gotas óticas monodosis"],
    [("Otitis externa", "0,3% gotas óticas monodosis", "Ótica", "1 monodosis", "cada 12 h", "7 días", "")])

# ---------- Ginecología ----------
add("Ginecología y obstetricia › Anticoncepción de urgencia", "Levonorgestrel", ["Norlevo", "Postinor"], ["1,5 mg comp"],
    [("Anticoncepción de urgencia (< 72 h)", "1,5 mg comp", "VO", "1,5 mg", "dosis única", "", "")])

# ---------- Antídotos y toxicología ----------
add("Antídotos y toxicología › Opioides y benzodiacepinas", "Naloxona", ["Naloxona Kern"], ["0,4 mg/1 ml amp"],
    [("Intoxicación por opioides con depresión respiratoria", "0,4 mg/1 ml amp", "IV, IM, SC o intranasal", "0,4 mg (0,1 mg si dependencia)", "repetir cada 2-3 min", "", "10 mg; vida media corta: vigilar")])
add("Antídotos y toxicología › Opioides y benzodiacepinas", "Flumazenilo", ["Anexate"], ["0,5 mg/5 ml amp", "1 mg/10 ml amp"],
    [("Sedación por benzodiacepinas (no en intoxicación mixta ni epilépticos)", "0,5 mg/5 ml amp", "IV en 15 s", "0,2 mg", "después 0,1 mg cada 60 s", "", "1 mg")])
add("Antídotos y toxicología › Descontaminación digestiva", "Carbón activado", ["Carbón Ultra Adsorbente Lainco"], ["50 g frasco"],
    [("Intoxicación oral reciente (< 1-2 h), vía aérea protegida", "50 g frasco", "VO o SNG", "1 g/kg (50 g)", "dosis única", "", "")])
add("Antídotos y toxicología › Paracetamol", "N-acetilcisteína", ["Hidonac antídoto"], ["5 g/25 ml vial"],
    [("Intoxicación por paracetamol (según nomograma)", "5 g/25 ml vial", "IV", "150 mg/kg en 1 h, 50 mg/kg en 4 h, 100 mg/kg en 16 h", "", "21 h", "")])

# ---------- Soporte vital y urgencias ----------
add("Soporte vital y urgencias › Parada y anafilaxia", "Adrenalina", ["Adrenalina Braun", "Altellus", "Jext", "Emerade"], ["1 mg/1 ml amp (1:1.000)", "0,3 mg autoinyector"],
    [("Anafilaxia", "1 mg/1 ml amp (1:1.000)", "IM cara anterolateral del muslo", "0,5 mg (0,01 mg/kg)", "repetir a los 5 min si no mejora", "", ""),
     ("Parada cardiorrespiratoria", "1 mg/1 ml amp (1:1.000)", "IV o IO", "1 mg", "cada 3-5 min (desfibrilable: tras la 3.ª descarga)", "", "")])
add("Soporte vital y urgencias › Bradicardia", "Atropina", ["Atropina Braun"], ["1 mg/1 ml amp"],
    [("Bradicardia sintomática", "1 mg/1 ml amp", "IV en bolo", "0,5 mg", "cada 3-5 min", "", "3 mg")])
add("Soporte vital y urgencias › Vasoactivos", "Noradrenalina", ["Noradrenalina Braun"], ["1 mg/ml amp 4 ml y 10 ml"],
    [("Shock distributivo / hipotensión refractaria", "1 mg/ml amp 4 ml y 10 ml", "Perfusión IV (vía central si es posible)", "0,05-0,1 mcg/kg/min", "ajustar a PAM ≥ 65", "", "")])
add("Soporte vital y urgencias › Secuencia rápida de intubación", "Rocuronio", ["Esmeron"], ["10 mg/ml vial 5 ml"],
    [("Relajación para intubación de secuencia rápida", "10 mg/ml vial 5 ml", "IV", "1-1,2 mg/kg", "dosis única", "", "reversión: sugammadex 16 mg/kg")])
add("Soporte vital y urgencias › Secuencia rápida de intubación", "Etomidato", ["Hypnomidate", "Sibul"], ["20 mg/10 ml amp"],
    [("Inducción en intubación (inestable hemodinámicamente)", "20 mg/10 ml amp", "IV", "0,3 mg/kg", "dosis única", "", "")])
add("Soporte vital y urgencias › Sueroterapia", "Cloruro sódico 0,9%", ["Suero fisiológico"], ["500 ml", "1.000 ml", "100 ml"],
    [("Hipovolemia / shock", "500 ml", "IV", "250-500 ml en bolo", "reevaluar tras cada bolo", "", "trauma: hipotensión permisiva (PAS 80-90)")])

# ---------- Montaña y rescate ----------
add("Montaña y rescate › Mal agudo de montaña", "Acetazolamida", ["Edemox"], ["250 mg comp"],
    [("Prevención del mal agudo de montaña (riesgo moderado-alto)", "250 mg comp", "VO", "125 mg", "cada 12 h", "desde el día antes del ascenso hasta 2-3 días en la altura máxima", ""),
     ("Tratamiento del mal agudo de montaña", "250 mg comp", "VO", "250 mg", "cada 12 h", "hasta mejoría", "")])
add("Montaña y rescate › Edema cerebral de altura", "Dexametasona", ["Fortecortin", "Dexametasona Kern"], ["4 mg comp", "4 mg/1 ml amp", "40 mg/5 ml amp"],
    [("Edema cerebral de altura", "4 mg/1 ml amp", "IV, IM o VO", "8 mg", "después 4 mg cada 6 h", "descenso inmediato", ""),
     ("Mal agudo de montaña moderado-grave", "4 mg comp", "VO o IM", "4 mg", "cada 6 h", "", "")])
add("Montaña y rescate › Edema pulmonar de altura", "Nifedipino retard", ["Adalat Oros", "Adalat retard"], ["30 mg comp liberación prolongada", "20 mg comp retard"],
    [("Edema pulmonar de altura (con descenso y O2)", "30 mg comp liberación prolongada", "VO", "30 mg", "cada 12 h", "hasta descenso y mejoría", "no usar formulación de liberación rápida")])
add("Montaña y rescate › Analgesia en rescate", "Metoxiflurano", ["Penthrox"], ["3 ml frasco + inhalador"],
    [("Dolor moderado-intenso por trauma (paciente consciente)", "3 ml frasco + inhalador", "Inhalado autoadministrado", "3 ml", "puede repetirse 1 vez", "", "6 ml/día; 15 ml/semana")])
add("Montaña y rescate › Analgesia en rescate", "Fentanilo", ["Fentanest"], ["0,15 mg/3 ml amp (50 mcg/ml)"],
    [("Dolor intenso (con vía)", "0,15 mg/3 ml amp (50 mcg/ml)", "IV lenta", "1 mcg/kg (50-100 mcg)", "repetir 0,5 mcg/kg cada 5-10 min", "", "vigilar FR y SatO2"),
     ("Dolor intenso sin vía (uso fuera de ficha)", "0,15 mg/3 ml amp (50 mcg/ml)", "Intranasal con atomizador (MAD)", "1,5 mcg/kg", "repetir a los 10 min si precisa", "", "")])
add("Montaña y rescate › Hipotermia y congelaciones", "Iloprost", [], ["20 mcg/ml amp IV (uso hospitalario)"],
    [("Congelación grave (< 48 h, en hospital)", "20 mcg/ml amp IV (uso hospitalario)", "Perfusión IV", "0,5-2 ng/kg/min", "6 h al día", "hasta 5-8 días", "solo en centro hospitalario")])

out = {"format": "drfolio-vademecum", "version": 1,
       "about": "Plantilla de Dr.Folio para Atención Primaria, Urgencias y Rescate en montaña: carpetas por grupo terapéutico con un fármaco de ejemplo en cada una. Dosis de adulto orientativas: revísalas antes de usarlas.",
       "drugs": D}
for p in ['/home/user/dr-folio/public/plantillas/vademecum-ap-urgencias-montana.json']:
    import os; os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w').write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
folders = sorted({d['folder'] for d in D})
print(len(D), 'fármacos,', len({f.split(' › ')[0] for f in folders}), 'categorías,', len(folders), 'subcarpetas')
names = [d['name'] for d in D]; assert len(names) == len(set(names))
assert not any('/' in f.replace(' › ', '') or '>' in f for f in folders)
