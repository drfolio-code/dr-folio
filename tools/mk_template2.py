import json, re
P = '/home/user/dr-folio/public/plantillas/vademecum-ap-urgencias-montana.json'
base = json.load(open(P))
drugs = base['drugs']
byname = {d['name'].lower(): d for d in drugs}
KEYS = ["indication", "presentation", "route", "dose", "frequency", "duration", "max"]

# Formato: "# Carpeta › Subcarpeta" y debajo una línea por fármaco:
#   Nombre | marca; marca | presentación; presentación | indicación ~ presentación ~ vía ~ dosis ~ frecuencia ~ duración ~ máx ;; otra pauta
# Si el fármaco ya existe en la plantilla, se le añaden las pautas, marcas y presentaciones nuevas.
DATA = r"""
# Analgesia y anestesia › AINE
Naproxeno | Naprosyn; Antalgin | 500 mg comp; 550 mg comp | Dolor o inflamación ~ 550 mg comp ~ VO con comida ~ 550 mg ~ cada 12 h ~ 5-7 días ~ 1.100 mg/día
Diclofenaco | Voltaren | 50 mg comp; 75 mg/3 ml amp | Dolor agudo ~ 50 mg comp ~ VO con comida ~ 50 mg ~ cada 8 h ~ ~ 150 mg/día ;; Cólico renal ~ 75 mg/3 ml amp ~ IM profunda ~ 75 mg ~ dosis única ~ ~ 150 mg/día
Ketorolaco | Toradol; Droal | 10 mg comp; 30 mg/1 ml amp | Dolor agudo moderado-intenso ~ 30 mg/1 ml amp ~ IV lenta o IM ~ 10-30 mg ~ cada 6-8 h ~ máx 2 días ~ 90 mg/día (60 mg/día si > 65 años)
Aceclofenaco | Airtal; Falcol | 100 mg comp; 100 mg sobres | Dolor musculoesquelético ~ 100 mg comp ~ VO con comida ~ 100 mg ~ cada 12 h ~ ~ 200 mg/día
Celecoxib | Celebrex | 100 mg cáps; 200 mg cáps | Artrosis o dolor ~ 200 mg cáps ~ VO ~ 200 mg ~ cada 24 h (o 100 mg cada 12 h) ~ ~ 400 mg/día
Etoricoxib | Arcoxia | 60 mg comp; 90 mg comp; 120 mg comp | Artrosis ~ 60 mg comp ~ VO ~ 60 mg ~ cada 24 h ~ ~ ;; Crisis de gota ~ 120 mg comp ~ VO ~ 120 mg ~ cada 24 h ~ máx 8 días ~
Ibuprofeno | | | Prevención del mal agudo de montaña (alternativa) ~ 600 mg comp ~ VO ~ 600 mg ~ cada 8 h ~ desde el día del ascenso ~

# Analgesia y anestesia › Opioides
Tramadol/paracetamol | Zaldiar; Pazital | 37,5/325 mg comp | Dolor moderado ~ 37,5/325 mg comp ~ VO ~ 1-2 comp ~ cada 6-8 h ~ ~ 8 comp/día
Codeína/paracetamol | Termalgin codeína; Cod-efferalgan | 500/30 mg comp | Dolor moderado ~ 500/30 mg comp ~ VO ~ 1-2 comp ~ cada 6-8 h ~ ~ 8 comp/día
Tapentadol | Palexia retard; Yantil retard | 50 mg comp liberación prolongada; 100 mg comp liberación prolongada | Dolor crónico intenso ~ 50 mg comp liberación prolongada ~ VO ~ 50 mg ~ cada 12 h ~ ~ 500 mg/día
Oxicodona/naloxona | Targin | 5/2,5 mg comp; 10/5 mg comp; 20/10 mg comp | Dolor crónico intenso ~ 10/5 mg comp ~ VO ~ 10/5 mg ~ cada 12 h ~ ~ 160/80 mg/día
Fentanilo transdérmico | Durogesic Matrix; Matrifen | 12 mcg/h parche; 25 mcg/h parche; 50 mcg/h parche | Dolor crónico (paciente ya tratado con opioides) ~ 12 mcg/h parche ~ Transdérmica ~ 12-25 mcg/h ~ cambiar cada 72 h ~ ~
Petidina | Dolantina | 100 mg/2 ml amp | Dolor intenso ~ 100 mg/2 ml amp ~ IM o IV lenta diluida ~ 50-100 mg ~ cada 4-6 h ~ ~ 400 mg/día
Buprenorfina transdérmica | Transtec; Feliben | 35 mcg/h parche; 52,5 mcg/h parche | Dolor crónico moderado-intenso ~ 35 mcg/h parche ~ Transdérmica ~ 35 mcg/h ~ cambiar cada 3-4 días ~ ~

# Analgesia y anestesia › Anestésicos locales
Mepivacaína | Scandinibsa | 1% amp; 2% amp | Infiltración o bloqueo ~ 1% amp ~ Infiltración ~ según la zona ~ ~ ~ ≈ 4 mg/kg (≤ 300 mg) sin vasoconstrictor
Bupivacaína | Bupivacaína Braun | 0,25% amp; 0,5% amp | Bloqueo de larga duración ~ 0,25% amp ~ Infiltración o bloqueo ~ según la zona ~ ~ ~ 2 mg/kg (≤ 150 mg)
Lidocaína/prilocaína | EMLA | 5% crema | Anestesia tópica antes de punción ~ 5% crema ~ Tópica con apósito oclusivo ~ capa gruesa ~ 60 min antes ~ ~

# Analgesia y anestesia › Sedoanalgesia
Propofol | Diprivan; Propofol Lipuro | 10 mg/ml amp 20 ml | Sedación para procedimiento ~ 10 mg/ml amp 20 ml ~ IV lenta ~ 0,5-1 mg/kg ~ después 0,25-0,5 mg/kg si precisa ~ ~ ;; Inducción anestésica ~ 10 mg/ml amp 20 ml ~ IV ~ 1-2,5 mg/kg ~ ~ ~
Óxido nitroso/oxígeno 50% | Kalinox; Entonox | bala de gas medicinal | Analgesia en procedimientos breves ~ bala de gas medicinal ~ Inhalado autoadministrado ~ a demanda con mascarilla ~ ~ ~ no en neumotórax ni TCE
Ketamina | | | Analgesia sin vía (fuera de ficha) ~ 50 mg/ml vial 10 ml ~ Intranasal con atomizador ~ 0,5-1 mg/kg ~ ~ ~

# Analgesia y anestesia › Dolor neuropático
Pregabalina | Lyrica | 25 mg cáps; 75 mg cáps; 150 mg cáps | Dolor neuropático ~ 75 mg cáps ~ VO ~ 75 mg ~ cada 12 h; subir según respuesta ~ ~ 600 mg/día
Gabapentina | Neurontin | 300 mg cáps; 600 mg comp; 800 mg comp | Dolor neuropático ~ 300 mg cáps ~ VO ~ 300 mg ~ día 1: 1 vez, día 2: cada 12 h, día 3: cada 8 h ~ ~ 3.600 mg/día
Amitriptilina | Tryptizol | 10 mg comp; 25 mg comp; 50 mg comp | Dolor neuropático o cefalea tensional ~ 10 mg comp ~ VO por la noche ~ 10-25 mg ~ cada 24 h ~ ~ 75 mg/día
Capsaicina tópica | Capsicin; Qutenza | 0,075% crema; 8% parche | Dolor neuropático localizado ~ 0,075% crema ~ Tópica ~ capa fina ~ cada 6-8 h ~ ~

# Cardiovascular › Antihipertensivos
Ramipril | Acovil | 2,5 mg comp; 5 mg comp; 10 mg comp | Hipertensión / cardiopatía ~ 2,5 mg comp ~ VO ~ 2,5-5 mg ~ cada 24 h ~ crónico ~ 10 mg/día
Losartán | Cozaar | 50 mg comp; 100 mg comp | Hipertensión arterial ~ 50 mg comp ~ VO ~ 50 mg ~ cada 24 h ~ crónico ~ 100 mg/día
Valsartán | Diovan | 80 mg comp; 160 mg comp; 320 mg comp | Hipertensión arterial ~ 80 mg comp ~ VO ~ 80-160 mg ~ cada 24 h ~ crónico ~ 320 mg/día
Candesartán | Atacand; Parapres | 8 mg comp; 16 mg comp; 32 mg comp | Hipertensión arterial ~ 8 mg comp ~ VO ~ 8-16 mg ~ cada 24 h ~ crónico ~ 32 mg/día
Olmesartán | Openvas; Olmetec | 10 mg comp; 20 mg comp; 40 mg comp | Hipertensión arterial ~ 20 mg comp ~ VO ~ 20 mg ~ cada 24 h ~ crónico ~ 40 mg/día
Lercanidipino | Zanidip; Lercadip | 10 mg comp; 20 mg comp | Hipertensión arterial ~ 10 mg comp ~ VO antes del desayuno ~ 10 mg ~ cada 24 h ~ crónico ~ 20 mg/día
Doxazosina | Carduran Neo | 4 mg comp liberación prolongada; 8 mg comp liberación prolongada | Hipertensión / HBP ~ 4 mg comp liberación prolongada ~ VO ~ 4 mg ~ cada 24 h ~ crónico ~ 8 mg/día
Nebivolol | Lobivon; Silostar | 5 mg comp | Hipertensión arterial ~ 5 mg comp ~ VO ~ 5 mg ~ cada 24 h ~ crónico ~
Captopril | Capoten | 25 mg comp; 50 mg comp | Urgencia hipertensiva (sin daño de órgano) ~ 25 mg comp ~ VO ~ 25 mg ~ repetir a los 30-60 min si precisa ~ ~ 50 mg
Labetalol | Trandate | 100 mg comp; 100 mg/20 ml amp | Emergencia hipertensiva ~ 100 mg/20 ml amp ~ IV lenta (2 min) ~ 20 mg ~ repetir 20-80 mg cada 10 min ~ ~ 300 mg
Urapidil | Elgadil | 50 mg/10 ml amp | Emergencia hipertensiva ~ 50 mg/10 ml amp ~ IV lenta ~ 12,5-25 mg ~ repetir a los 5 min si precisa ~ ~

# Cardiovascular › Diuréticos
Torasemida | Dilutol; Sutril | 5 mg comp; 10 mg comp | Edemas o insuficiencia cardiaca ~ 5 mg comp ~ VO ~ 5-20 mg ~ cada 24 h ~ ~
Espironolactona | Aldactone | 25 mg comp; 100 mg comp | Insuficiencia cardiaca ~ 25 mg comp ~ VO ~ 25 mg ~ cada 24 h ~ crónico (vigilar K y FG) ~ 50 mg/día ;; Ascitis ~ 100 mg comp ~ VO ~ 100 mg ~ cada 24 h ~ ~ 400 mg/día
Indapamida | Tertensif retard | 1,5 mg comp liberación prolongada | Hipertensión arterial ~ 1,5 mg comp liberación prolongada ~ VO ~ 1,5 mg ~ cada 24 h ~ crónico ~
Clortalidona | Higrotona | 50 mg comp | Hipertensión arterial ~ 50 mg comp ~ VO ~ 12,5-25 mg ~ cada 24 h ~ crónico ~

# Cardiovascular › Antiarrítmicos y control de frecuencia
Atenolol | Tenormin | 50 mg comp; 100 mg comp | Hipertensión / control de frecuencia ~ 50 mg comp ~ VO ~ 50 mg ~ cada 24 h ~ crónico ~ 100 mg/día
Metoprolol | Beloken; Lopresor | 100 mg comp; 5 mg/5 ml amp | Control de frecuencia ~ 100 mg comp ~ VO ~ 50-100 mg ~ cada 12 h ~ ~ ;; FA rápida o taquicardia (urgencias) ~ 5 mg/5 ml amp ~ IV lenta ~ 2,5-5 mg ~ cada 5 min ~ ~ 15 mg
Carvedilol | Coropres | 6,25 mg comp; 25 mg comp | Insuficiencia cardiaca ~ 6,25 mg comp ~ VO ~ 3,125 mg ~ cada 12 h; subir cada 2 semanas ~ crónico ~ 25 mg/12 h
Diltiazem | Masdil | 60 mg comp; 120 mg cáps retard; 25 mg vial | Control de frecuencia en FA ~ 60 mg comp ~ VO ~ 60 mg ~ cada 8 h ~ ~ 360 mg/día ;; FA rápida (urgencias) ~ 25 mg vial ~ IV en 2 min ~ 0,25 mg/kg ~ repetir 0,35 mg/kg a los 15 min ~ ~
Verapamilo | Manidon | 80 mg comp; 5 mg/2 ml amp | Taquicardia supraventricular ~ 5 mg/2 ml amp ~ IV en 2 min ~ 5 mg ~ repetir 5 mg a los 10 min ~ ~ 20 mg
Digoxina | Digoxina Kern; Lanacordin | 0,25 mg comp; 0,25 mg/1 ml amp | Control de frecuencia en FA con IC ~ 0,25 mg comp ~ VO ~ 0,125-0,25 mg ~ cada 24 h ~ crónico (ajustar a FG y edad) ~ ;; FA rápida (urgencias) ~ 0,25 mg/1 ml amp ~ IV lenta ~ 0,25-0,5 mg ~ después 0,25 mg cada 4-6 h ~ ~ 1 mg en 24 h
Adenosina | Adenocor | 6 mg/2 ml vial | Taquicardia supraventricular ~ 6 mg/2 ml vial ~ IV en bolo rápido + 20 ml SF ~ 6 mg ~ si no cede: 12 mg y después 18 mg ~ ~
Flecainida | Apocard | 100 mg comp | FA paroxística («pastilla en el bolsillo») ~ 100 mg comp ~ VO ~ 200 mg (< 70 kg) o 300 mg ~ dosis única ~ ~ solo sin cardiopatía estructural

# Cardiovascular › Antianginosos
Nitroglicerina transdérmica | Nitroplast; Trinipatch | 5 mg/24 h parche; 10 mg/24 h parche; 15 mg/24 h parche | Angina estable ~ 10 mg/24 h parche ~ Transdérmica ~ 1 parche ~ 12-14 h al día (retirar por la noche) ~ ~
Mononitrato de isosorbida | Uniket retard | 50 mg cáps retard | Angina estable ~ 50 mg cáps retard ~ VO ~ 50 mg ~ cada 24 h por la mañana ~ ~
Ranolazina | Ranexa | 375 mg comp; 500 mg comp | Angina estable (2.ª línea) ~ 375 mg comp ~ VO ~ 375 mg ~ cada 12 h ~ ~ 750 mg/12 h
Ivabradina | Procoralan | 5 mg comp; 7,5 mg comp | Angina / IC en ritmo sinusal ~ 5 mg comp ~ VO con comida ~ 5 mg ~ cada 12 h ~ ~ 7,5 mg/12 h

# Cardiovascular › Antiagregantes
Ticagrelor | Brilique | 90 mg comp | Síndrome coronario agudo (según protocolo) ~ 90 mg comp ~ VO ~ 180 mg de carga ~ después 90 mg cada 12 h ~ 12 meses ~
Prasugrel | Efient | 10 mg comp | SCA con angioplastia (según protocolo) ~ 10 mg comp ~ VO ~ 60 mg de carga ~ después 10 mg cada 24 h ~ 12 meses ~ 5 mg si ≥ 75 años o < 60 kg

# Cardiovascular › Anticoagulantes
Rivaroxabán | Xarelto | 10 mg comp; 15 mg comp; 20 mg comp | FA no valvular ~ 20 mg comp ~ VO con comida ~ 20 mg ~ cada 24 h ~ crónico ~ 15 mg si FG 15-49 ;; TVP/TEP ~ 15 mg comp ~ VO con comida ~ 15 mg ~ cada 12 h 21 días, luego 20 mg cada 24 h ~ ~
Edoxabán | Lixiana | 30 mg comp; 60 mg comp | FA no valvular ~ 60 mg comp ~ VO ~ 60 mg ~ cada 24 h ~ crónico ~ 30 mg si FG 15-50, ≤ 60 kg o inhibidores de P-gp
Dabigatrán | Pradaxa | 110 mg cáps; 150 mg cáps | FA no valvular ~ 150 mg cáps ~ VO ~ 150 mg ~ cada 12 h ~ crónico ~ 110 mg/12 h si ≥ 80 años o riesgo de sangrado
Acenocumarol | Sintrom | 1 mg comp; 4 mg comp | Anticoagulación oral ~ 4 mg comp ~ VO ~ según INR ~ cada 24 h ~ crónico ~ INR objetivo habitual 2-3
Bemiparina | Hibor | 2.500 UI jer; 3.500 UI jer; 5.000-10.000 UI jer | Profilaxis de ETV ~ 3.500 UI jer ~ SC ~ 2.500-3.500 UI ~ cada 24 h ~ mientras dure el riesgo ~ ;; Tratamiento de TVP ~ ~ SC ~ 115 UI/kg ~ cada 24 h ~ ~
Tinzaparina | Innohep | 3.500 UI jer; 10.000-18.000 UI jer | Tratamiento de TVP/TEP ~ ~ SC ~ 175 UI/kg ~ cada 24 h ~ ~
Heparina sódica | Heparina sódica Chiesi | 1% (1.000 UI/ml) vial; 5% (5.000 UI/ml) vial | SCA o TEP (según protocolo) ~ 5% (5.000 UI/ml) vial ~ IV en bolo ~ 60-80 UI/kg ~ después perfusión según TTPa ~ ~

# Cardiovascular › Hipolipemiantes
Rosuvastatina | Crestor | 5 mg comp; 10 mg comp; 20 mg comp | Hipercolesterolemia / prevención CV ~ 10 mg comp ~ VO ~ 5-20 mg ~ cada 24 h ~ crónico ~ 40 mg/día
Simvastatina | Zocor | 20 mg comp; 40 mg comp | Hipercolesterolemia ~ 20 mg comp ~ VO por la noche ~ 20-40 mg ~ cada 24 h ~ crónico ~ 40 mg/día
Ezetimiba | Ezetrol | 10 mg comp | Hipercolesterolemia (con estatina) ~ 10 mg comp ~ VO ~ 10 mg ~ cada 24 h ~ crónico ~
Fenofibrato | Secalip | 145 mg comp; 160 mg comp | Hipertrigliceridemia ~ 145 mg comp ~ VO ~ 145 mg ~ cada 24 h ~ crónico ~

# Cardiovascular › Insuficiencia cardiaca
Sacubitrilo/valsartán | Entresto | 24/26 mg comp; 49/51 mg comp; 97/103 mg comp | IC con FE reducida ~ 49/51 mg comp ~ VO ~ 49/51 mg ~ cada 12 h; subir a las 2-4 semanas ~ crónico ~ 97/103 mg/12 h
Dapagliflozina | Forxiga | 10 mg comp | IC, ERC o DM2 ~ 10 mg comp ~ VO ~ 10 mg ~ cada 24 h ~ crónico ~

# Respiratorio › Broncodilatadores de rescate
Terbutalina | Terbasmin | 500 mcg/inh Turbuhaler; 0,5 mg/ml amp | Broncoespasmo ~ 500 mcg/inh Turbuhaler ~ Inhalada ~ 1 inhalación ~ a demanda ~ ~ 6 inh/día ;; Crisis asmática grave sin respuesta ~ 0,5 mg/ml amp ~ SC ~ 0,25-0,5 mg ~ repetir a los 20 min ~ ~

# Respiratorio › Inhaladores de mantenimiento
Fluticasona/salmeterol | Seretide; Inaladuo; Plusvent | 250/50 mcg Accuhaler; 500/50 mcg Accuhaler; 125/25 mcg aerosol | Asma o EPOC (mantenimiento) ~ 250/50 mcg Accuhaler ~ Inhalada ~ 1 inhalación ~ cada 12 h ~ crónico ~
Beclometasona/formoterol | Foster; Formodual | 100/6 mcg aerosol; 100/6 mcg Nexthaler | Asma o EPOC (mantenimiento) ~ 100/6 mcg aerosol ~ Inhalada con cámara ~ 1-2 inhalaciones ~ cada 12 h ~ crónico ~
Fluticasona furoato/vilanterol | Relvar Ellipta; Revinty Ellipta | 92/22 mcg Ellipta; 184/22 mcg Ellipta | Asma o EPOC (mantenimiento) ~ 92/22 mcg Ellipta ~ Inhalada ~ 1 inhalación ~ cada 24 h ~ crónico ~
Umeclidinio/vilanterol | Anoro Ellipta | 55/22 mcg Ellipta | EPOC (mantenimiento) ~ 55/22 mcg Ellipta ~ Inhalada ~ 1 inhalación ~ cada 24 h ~ crónico ~
Indacaterol/glicopirronio | Ultibro Breezhaler | 85/43 mcg cáps inhalación | EPOC (mantenimiento) ~ 85/43 mcg cáps inhalación ~ Inhalada ~ 1 cápsula ~ cada 24 h ~ crónico ~
Fluticasona furoato/umeclidinio/vilanterol | Trelegy Ellipta | 92/55/22 mcg Ellipta | EPOC con exacerbaciones (triple terapia) ~ 92/55/22 mcg Ellipta ~ Inhalada ~ 1 inhalación ~ cada 24 h ~ crónico ~
Budesonida | Pulmicort | 200 mcg/inh Turbuhaler; 0,5 mg/2 ml susp nebulizar | Asma (mantenimiento) ~ 200 mcg/inh Turbuhaler ~ Inhalada ~ 200-400 mcg ~ cada 12 h ~ crónico ~ ;; Laringitis (crup) ~ 0,5 mg/2 ml susp nebulizar ~ Nebulizada ~ 2 mg ~ dosis única ~ ~
Montelukast | Singulair | 10 mg comp; 4 mg y 5 mg comp masticables | Asma o rinitis alérgica ~ 10 mg comp ~ VO por la noche ~ 10 mg ~ cada 24 h ~ ~

# Respiratorio › Corticoides sistémicos
Hidrocortisona | Actocortina; Hidroaltesona | 100 mg vial; 500 mg vial; 20 mg comp | Crisis asmática grave / anafilaxia (adyuvante) ~ 100 mg vial ~ IV ~ 100-200 mg ~ cada 6 h ~ ~ ;; Crisis suprarrenal ~ 100 mg vial ~ IV o IM ~ 100 mg ~ después 50 mg cada 6 h ~ ~ ;; Insuficiencia suprarrenal (mantenimiento) ~ 20 mg comp ~ VO ~ 15-25 mg/día repartidos ~ 2-3 tomas ~ crónico ~
Deflazacort | Dezacor; Zamene | 6 mg comp; 30 mg comp | Corticoterapia oral ~ 30 mg comp ~ VO por la mañana ~ 6-90 mg ~ cada 24 h ~ pauta descendente según duración ~

# Respiratorio › Antitusivos y mucolíticos
Cloperastina | Flutox | 3,54 mg/ml jarabe; 10 mg comp | Tos seca ~ 3,54 mg/ml jarabe ~ VO ~ 10-20 mg ~ cada 8 h ~ ~
Codeína | Codeisan | 28,7 mg comp | Tos seca rebelde ~ 28,7 mg comp ~ VO ~ 1 comp ~ cada 6-8 h ~ pocos días ~ 120 mg/día
Ambroxol | Mucosan | 30 mg comp; 15 mg/5 ml jarabe | Secreciones espesas ~ 30 mg comp ~ VO ~ 30 mg ~ cada 8 h ~ ~

# Respiratorio › Oxigenoterapia
Oxígeno medicinal | Oxígeno medicinal | bala o concentrador; gafas nasales; mascarilla con reservorio | Hipoxemia ~ gafas nasales ~ Inhalado ~ 1-4 l/min ~ objetivo SatO2 94-98% (88-92% en EPOC) ~ ~ ;; Hipoxemia grave / intoxicación por CO ~ mascarilla con reservorio ~ Inhalado ~ 10-15 l/min ~ ~ ~

# Respiratorio › Rinitis y congestión nasal
Mometasona nasal | Nasonex | 50 mcg/pulsación spray nasal | Rinitis alérgica / sinusitis ~ 50 mcg/pulsación spray nasal ~ Intranasal ~ 2 pulsaciones en cada fosa ~ cada 24 h ~ ~
Fluticasona furoato nasal | Avamys | 27,5 mcg/pulsación spray nasal | Rinitis alérgica ~ 27,5 mcg/pulsación spray nasal ~ Intranasal ~ 2 pulsaciones en cada fosa ~ cada 24 h ~ ~
Oximetazolina | Utabon; Respibien | 0,05% spray nasal | Congestión nasal ~ 0,05% spray nasal ~ Intranasal ~ 1-2 pulsaciones en cada fosa ~ cada 12 h ~ máx 3 días ~

# Antiinfecciosos › Penicilinas
Fenoximetilpenicilina (penicilina V) | Penilevel | 250 mg sobres; 500 mg comp | Faringoamigdalitis estreptocócica ~ 500 mg comp ~ VO ~ 500 mg ~ cada 12 h ~ 10 días ~
Penicilina G benzatina | Benzetacil; Lentocilin | 1.200.000 UI vial | Faringoamigdalitis (mala adherencia) / sífilis precoz ~ 1.200.000 UI vial ~ IM ~ 1,2 MUI (sífilis 2,4 MUI) ~ dosis única ~ ~
Cloxacilina | Orbenin | 500 mg cáps | Celulitis / infección cutánea estafilocócica ~ 500 mg cáps ~ VO en ayunas ~ 500 mg ~ cada 6 h ~ 7 días ~

# Antiinfecciosos › Cefalosporinas
Cefuroxima axetilo | Zinnat; Nivador | 250 mg comp; 500 mg comp | Infección respiratoria o urinaria ~ 500 mg comp ~ VO con comida ~ 500 mg ~ cada 12 h ~ 7 días ~
Cefixima | Denvar | 400 mg cáps; 200 mg comp | Infección urinaria / pielonefritis leve ~ 400 mg cáps ~ VO ~ 400 mg ~ cada 24 h ~ 7-10 días ~
Cefadroxilo | Duracef | 500 mg cáps; 1 g comp | Infección cutánea / faringoamigdalitis ~ 1 g comp ~ VO ~ 1 g ~ cada 12 h ~ 7-10 días ~
Cefditoreno | Meiact; Spectracef | 200 mg comp; 400 mg comp | Infección respiratoria ~ 400 mg comp ~ VO con comida ~ 400 mg ~ cada 12 h ~ 5-7 días ~

# Antiinfecciosos › Macrólidos
Claritromicina | Klacid; Kofron | 500 mg comp; 500 mg comp liberación prolongada | Infección respiratoria (alergia a penicilina) ~ 500 mg comp ~ VO ~ 500 mg ~ cada 12 h ~ 7 días ~ ;; Erradicación de H. pylori (parte de pauta) ~ 500 mg comp ~ VO ~ 500 mg ~ cada 12 h ~ 14 días ~

# Antiinfecciosos › Quinolonas
Ciprofloxacino | Baycip | 250 mg comp; 500 mg comp; 750 mg comp | Pielonefritis no complicada / prostatitis ~ 500 mg comp ~ VO ~ 500 mg ~ cada 12 h ~ 7 días (prostatitis 4 semanas) ~
Moxifloxacino | Actira; Octegra | 400 mg comp | Neumonía o sinusitis (alergia a betalactámicos) ~ 400 mg comp ~ VO ~ 400 mg ~ cada 24 h ~ 5-7 días ~

# Antiinfecciosos › Otros antibacterianos
Doxiciclina | Vibracina; Proderma | 100 mg cáps; 100 mg comp | Picadura de garrapata (Lyme, rickettsias) / neumonía atípica ~ 100 mg cáps ~ VO con agua, sin tumbarse ~ 100 mg ~ cada 12 h ~ 7-14 días ~ ;; Profilaxis tras picadura de garrapata (Lyme, si procede) ~ 100 mg cáps ~ VO ~ 200 mg ~ dosis única ~ ~
Cotrimoxazol | Septrin Forte | 800/160 mg comp | Infección urinaria / cutánea (SARM comunitario) ~ 800/160 mg comp ~ VO ~ 1 comp ~ cada 12 h ~ 3-7 días ~
Clindamicina | Dalacin | 150 mg cáps; 300 mg cáps | Infección cutánea o dental (alergia a penicilina) ~ 300 mg cáps ~ VO ~ 300 mg ~ cada 8 h ~ 7 días ~
Metronidazol | Flagyl | 250 mg comp; 500 mg comp | Vaginosis / tricomoniasis / C. difficile ~ 500 mg comp ~ VO ~ 500 mg ~ cada 8-12 h ~ 7 días ~
Gentamicina | Gentamicina Braun | 80 mg/2 ml amp; 240 mg/80 ml vial | Pielonefritis (dosis única antes del antibiótico oral) ~ 80 mg/2 ml amp ~ IM o IV ~ 5 mg/kg ~ cada 24 h ~ ~ ajustar a FG

# Antiinfecciosos › Antivirales
Aciclovir | Zovirax | 200 mg comp; 800 mg comp; 5% crema | Herpes zóster ~ 800 mg comp ~ VO ~ 800 mg ~ 5 veces al día ~ 7 días ~ ;; Herpes labial ~ 5% crema ~ Tópica ~ aplicación ~ 5 veces al día ~ 5 días ~
Famciclovir | Famvir | 250 mg comp; 500 mg comp | Herpes zóster ~ 500 mg comp ~ VO ~ 500 mg ~ cada 8 h ~ 7 días ~
Oseltamivir | Tamiflu | 75 mg cáps | Gripe en paciente de riesgo (< 48 h) ~ 75 mg cáps ~ VO ~ 75 mg ~ cada 12 h ~ 5 días ~ ;; Profilaxis postexposición ~ 75 mg cáps ~ VO ~ 75 mg ~ cada 24 h ~ 10 días ~

# Antiinfecciosos › Antifúngicos
Terbinafina | Lamisil | 250 mg comp; 1% crema | Onicomicosis ~ 250 mg comp ~ VO ~ 250 mg ~ cada 24 h ~ 6 semanas (manos) - 12 semanas (pies) ~ ;; Tiña cutánea ~ 1% crema ~ Tópica ~ capa fina ~ cada 12-24 h ~ 1-2 semanas ~
Nistatina | Mycostatin | 100.000 UI/ml suspensión | Candidiasis oral ~ 100.000 UI/ml suspensión ~ VO (enjuagar y tragar) ~ 4-6 ml ~ cada 6 h ~ 7-14 días ~
Miconazol oral | Daktarin oral | 2% gel oral | Candidiasis oral ~ 2% gel oral ~ Bucal ~ 2,5 ml ~ cada 6 h ~ 7 días tras desaparecer ~ interacción con acenocumarol

# Antiinfecciosos › Antiparasitarios
Albendazol | Eskazole | 400 mg comp | Parasitosis intestinal ~ 400 mg comp ~ VO ~ 400 mg ~ dosis única ~ ~
Permetrina | Sarcop; Permetrina Isdin | 5% crema | Sarna ~ 5% crema ~ Tópica de cuello a pies ~ capa fina ~ retirar a las 8-12 h ~ repetir a los 7 días ~
Ivermectina | Ivergalen | 3 mg comp | Sarna (extensa o costrosa) ~ 3 mg comp ~ VO en ayunas ~ 200 mcg/kg ~ dosis única ~ repetir a los 7-14 días ~

# Antiinfecciosos › Vacunas e inmunoglobulinas
Vacuna antitetánica-diftérica | Diftavax; Ditanrix | 0,5 ml jer | Herida con vacunación incompleta o > 10 años ~ 0,5 ml jer ~ IM deltoides ~ 0,5 ml ~ dosis única ~ completar pauta si procede ~
Inmunoglobulina antitetánica | Gammatetanos | 250 UI jer | Herida tetanígena con vacunación incompleta o desconocida ~ 250 UI jer ~ IM (lugar distinto a la vacuna) ~ 250 UI (500 UI si > 24 h o alto riesgo) ~ dosis única ~ ~

# Digestivo › Antiácidos e IBP
Pantoprazol | Anagastra; Pantecta | 20 mg comp; 40 mg comp; 40 mg vial IV | Protección gástrica / ERGE ~ 20 mg comp ~ VO en ayunas ~ 20-40 mg ~ cada 24 h ~ ~ ;; Hemorragia digestiva alta ~ 40 mg vial IV ~ IV ~ 80 mg en bolo ~ después 40 mg cada 12 h ~ ~
Esomeprazol | Nexium; Axiago | 20 mg comp; 40 mg comp | ERGE ~ 40 mg comp ~ VO en ayunas ~ 20-40 mg ~ cada 24 h ~ 4-8 semanas ~
Almagato | Almax | 1,5 g sobres; 500 mg comp masticables | Pirosis ~ 1,5 g sobres ~ VO ~ 1,5 g ~ tras las comidas ~ ~ 6 g/día

# Digestivo › Antieméticos
Domperidona | Motilium | 10 mg comp; 1 mg/ml suspensión | Náuseas y vómitos ~ 10 mg comp ~ VO ~ 10 mg ~ cada 8 h ~ máx 7 días ~ 30 mg/día; riesgo de QT
Doxilamina/piridoxina | Cariban | 10/10 mg cáps | Náuseas y vómitos del embarazo ~ 10/10 mg cáps ~ VO ~ 2 cáps por la noche ~ subir hasta 4 cáps/día ~ ~ 4 cáps/día

# Digestivo › Antidiarreicos y rehidratación
Racecadotrilo | Tiorfan | 100 mg cáps; 10 mg y 30 mg sobres | Diarrea aguda ~ 100 mg cáps ~ VO ~ 100 mg ~ cada 8 h ~ hasta 7 días ~

# Digestivo › Laxantes
Lactulosa | Duphalac | 10 g/15 ml solución; 10 g sobres | Estreñimiento ~ 10 g/15 ml solución ~ VO ~ 15-30 ml ~ cada 24 h ~ ~ ;; Encefalopatía hepática ~ 10 g/15 ml solución ~ VO ~ 30 ml ~ cada 8 h (2-3 deposiciones blandas) ~ ~
Plantago ovata | Plantaben; Metamucil | 3,5 g sobres | Estreñimiento / diarrea funcional ~ 3,5 g sobres ~ VO con mucha agua ~ 1 sobre ~ cada 8-24 h ~ ~
Bisacodilo | Dulcolaxo | 5 mg comp; 10 mg supositorios | Estreñimiento ~ 5 mg comp ~ VO por la noche ~ 5-10 mg ~ cada 24 h ~ uso puntual ~
Enema de fosfatos | Enema Casen | 140 ml y 250 ml enema | Estreñimiento / impactación fecal ~ 250 ml enema ~ Rectal ~ 1 enema ~ dosis única ~ ~ evitar en ERC y ancianos frágiles

# Digestivo › Espasmolíticos
Mebeverina | Duspatalin | 200 mg cáps retard | Síndrome de intestino irritable ~ 200 mg cáps retard ~ VO ~ 200 mg ~ cada 12 h ~ ~
Otilonio bromuro | Spasmoctyl | 40 mg comp | Síndrome de intestino irritable ~ 40 mg comp ~ VO ~ 40 mg ~ cada 8-12 h ~ ~
Simeticona | Aero Red | 40 mg comp; 80 mg comp | Meteorismo ~ 80 mg comp ~ VO tras las comidas ~ 40-80 mg ~ cada 8 h ~ ~

# Digestivo › Hemorroides y patología anal
Hidrocortisona/lidocaína rectal | Anso; Hemoal | pomada rectal | Hemorroides ~ pomada rectal ~ Rectal ~ aplicación ~ cada 8-12 h ~ máx 7 días ~

# Endocrino y metabolismo › Antidiabéticos orales
Sitagliptina | Januvia; Tesavel | 25 mg comp; 50 mg comp; 100 mg comp | Diabetes tipo 2 ~ 100 mg comp ~ VO ~ 100 mg ~ cada 24 h ~ crónico ~ 50 mg si FG 30-45; 25 mg si < 30
Metformina/sitagliptina | Janumet; Velmetia | 50/850 mg comp; 50/1.000 mg comp | Diabetes tipo 2 ~ 50/1.000 mg comp ~ VO con comidas ~ 1 comp ~ cada 12 h ~ crónico ~
Linagliptina | Trajenta | 5 mg comp | Diabetes tipo 2 (también con ERC) ~ 5 mg comp ~ VO ~ 5 mg ~ cada 24 h ~ crónico ~ sin ajuste renal
Gliclazida | Diamicron | 30 mg comp liberación modificada; 60 mg comp | Diabetes tipo 2 ~ 30 mg comp liberación modificada ~ VO con el desayuno ~ 30-120 mg ~ cada 24 h ~ crónico ~ riesgo de hipoglucemia
Repaglinida | Novonorm | 0,5 mg comp; 1 mg comp; 2 mg comp | Diabetes tipo 2 ~ 0,5 mg comp ~ VO antes de cada comida ~ 0,5-4 mg ~ con cada comida principal ~ crónico ~ 16 mg/día

# Endocrino y metabolismo › Antidiabéticos inyectables (GLP-1)
Semaglutida | Ozempic; Rybelsus (oral) | 0,25-0,5 mg pluma; 1 mg pluma; 3, 7 y 14 mg comp | DM2 / obesidad con DM2 ~ 0,25-0,5 mg pluma ~ SC ~ 0,25 mg ~ semanal 4 semanas, luego 0,5 mg y subir a 1 mg ~ crónico ~ 2 mg/semana
Dulaglutida | Trulicity | 1,5 mg pluma; 3 mg pluma | Diabetes tipo 2 ~ 1,5 mg pluma ~ SC ~ 1,5 mg ~ 1 vez a la semana ~ crónico ~ 4,5 mg/semana
Liraglutida | Victoza | 6 mg/ml pluma | Diabetes tipo 2 ~ 6 mg/ml pluma ~ SC ~ 0,6 mg ~ cada 24 h; a la semana 1,2 mg ~ crónico ~ 1,8 mg/día

# Endocrino y metabolismo › Insulinas
Insulina degludec | Tresiba | 100 UI/ml FlexTouch; 200 UI/ml FlexTouch | Insulina basal ~ 100 UI/ml FlexTouch ~ SC ~ 10 UI (o 0,1-0,2 UI/kg) ~ cada 24 h ~ ajustar según glucemia basal ~
Insulina NPH | Insulatard; Humulina NPH | 100 UI/ml FlexPen / KwikPen | Insulina basal (intermedia) ~ 100 UI/ml FlexPen / KwikPen ~ SC ~ 0,1-0,2 UI/kg ~ cada 12-24 h ~ ~
Insulina aspart | NovoRapid; Fiasp | 100 UI/ml FlexPen | Insulina prandial / corrección ~ 100 UI/ml FlexPen ~ SC antes de comer ~ según pauta ~ con las comidas ~ ~
Insulina lispro | Humalog | 100 UI/ml KwikPen | Insulina prandial / corrección ~ 100 UI/ml KwikPen ~ SC antes de comer ~ según pauta ~ con las comidas ~ ~
Insulina regular | Actrapid; Humulina Regular | 100 UI/ml vial | Cetoacidosis / hiperglucemia grave (urgencias) ~ 100 UI/ml vial ~ Perfusión IV ~ 0,1 UI/kg/h ~ ajustar según glucemia y K ~ ~ no iniciar si K < 3,5

# Endocrino y metabolismo › Tiroides
Tiamazol | Tirodril | 5 mg comp | Hipertiroidismo ~ 5 mg comp ~ VO ~ 10-30 mg ~ cada 24 h ~ según TSH/T4 ~

# Endocrino y metabolismo › Electrolitos
Cloruro potásico | Potasion; Boi-K aspártico | 600 mg cáps (8 mEq); 2 mEq/ml amp | Hipopotasemia leve ~ 600 mg cáps (8 mEq) ~ VO con comida ~ 1-2 cáps ~ cada 8-12 h ~ ~ ;; Hipopotasemia (urgencias) ~ 2 mEq/ml amp ~ IV diluido ~ 10-20 mEq/h ~ ~ ~ ≤ 10 mEq/h por vía periférica
Gluconato cálcico 10% | Suplecal; Gluconato cálcico Braun | 10% amp 10 ml | Hiperpotasemia con alteraciones en el ECG ~ 10% amp 10 ml ~ IV en 5-10 min ~ 10-30 ml ~ repetir si persiste el ECG ~ ~
Bicarbonato sódico 1 M | Bicarbonato 1 M Braun | 1 M (1 mEq/ml) 250 ml | Hiperpotasemia con acidosis / intoxicación por tricíclicos ~ 1 M (1 mEq/ml) 250 ml ~ IV ~ 1-2 mEq/kg ~ en 10-20 min ~ ~
Cloruro sódico 3% | Suero hipertónico 3% | 3% 100 ml; 3% 250 ml | Hiponatremia grave sintomática ~ 3% 100 ml ~ IV ~ 150 ml (o 2 ml/kg) ~ en 20 min; repetir hasta 2-3 veces ~ ~ no subir Na > 10 mEq/l en 24 h
Calcifediol | Hidroferol | 0,266 mg cáps | Déficit de vitamina D ~ 0,266 mg cáps ~ VO ~ 1 cáps ~ cada 15-30 días ~ ~

# Neurología y psiquiatría › Anticonvulsivantes
Valproato sódico | Depakine | 200 mg comp; 500 mg comp; 400 mg vial IV | Estatus epiléptico (2.ª línea) ~ 400 mg vial IV ~ IV en 10 min ~ 20-40 mg/kg ~ dosis única ~ ~ 3 g; no en embarazo
Lacosamida | Vimpat | 50 mg comp; 200 mg/20 ml vial | Crisis focales / estatus (2.ª línea) ~ 200 mg/20 ml vial ~ IV en 15-60 min ~ 200-400 mg ~ dosis única ~ ~
Clonazepam | Rivotril | 0,5 mg comp; 2 mg comp; 1 mg/1 ml amp | Crisis convulsiva ~ 1 mg/1 ml amp ~ IV lenta ~ 1 mg ~ repetir si persiste ~ ~ 4 mg

# Neurología y psiquiatría › Migraña y cefalea
Rizatriptán | Maxalt; Maxalt Max | 10 mg comp; 10 mg liotabs | Crisis de migraña ~ 10 mg liotabs ~ VO ~ 10 mg ~ repetir a las 2 h si reaparece ~ ~ 20 mg/día (5 mg con propranolol)
Zolmitriptán | Zomig; Zomig Flas | 2,5 mg comp; 5 mg comp; 5 mg spray nasal | Crisis de migraña ~ 2,5 mg comp ~ VO ~ 2,5-5 mg ~ repetir a las 2 h si reaparece ~ ~ 10 mg/día
Almotriptán | Almogran | 12,5 mg comp | Crisis de migraña ~ 12,5 mg comp ~ VO ~ 12,5 mg ~ repetir a las 2 h si reaparece ~ ~ 25 mg/día
Propranolol | Sumial | 10 mg comp; 40 mg comp | Profilaxis de migraña ~ 40 mg comp ~ VO ~ 20-40 mg ~ cada 12 h ~ ≥ 3 meses ~ 160 mg/día ;; Temblor esencial / ansiedad somática ~ 10 mg comp ~ VO ~ 10-40 mg ~ cada 8-12 h ~ ~
Topiramato | Topamax | 25 mg comp; 50 mg comp | Profilaxis de migraña ~ 25 mg comp ~ VO ~ 25 mg ~ por la noche; subir 25 mg cada semana hasta 50 mg cada 12 h ~ ≥ 3 meses ~ 100 mg/día

# Neurología y psiquiatría › Vértigo y mareo
Betahistina | Serc; Fidium | 8 mg comp; 16 mg comp | Enfermedad de Ménière / vértigo ~ 16 mg comp ~ VO con comida ~ 16 mg ~ cada 8 h ~ ~ 48 mg/día

# Neurología y psiquiatría › Ansiolíticos
Alprazolam | Trankimazin | 0,25 mg comp; 0,5 mg comp; 1 mg comp | Ansiedad ~ 0,25 mg comp ~ VO ~ 0,25-0,5 mg ~ cada 8 h ~ uso corto ~ 4 mg/día
Clorazepato dipotásico | Tranxilium | 5 mg cáps; 10 mg cáps; 15 mg cáps; 50 mg vial | Ansiedad ~ 5 mg cáps ~ VO ~ 5-15 mg ~ cada 8-24 h ~ uso corto ~ ;; Agitación / abstinencia (urgencias) ~ 50 mg vial ~ IM o IV lenta ~ 20-50 mg ~ repetir según respuesta ~ ~
Diazepam | | | Ansiedad ~ 5 mg comp ~ VO ~ 5 mg ~ cada 8-12 h ~ uso corto ~

# Neurología y psiquiatría › Hipnóticos
Zolpidem | Stilnox; Dalparan | 10 mg comp | Insomnio ~ 10 mg comp ~ VO al acostarse ~ 5-10 mg (5 mg en mayores) ~ cada 24 h ~ máx 4 semanas ~
Lormetazepam | Noctamid | 1 mg comp; 2 mg comp | Insomnio ~ 1 mg comp ~ VO al acostarse ~ 1 mg ~ cada 24 h ~ máx 4 semanas ~ 2 mg
Trazodona | Deprax | 100 mg comp | Insomnio (uso fuera de ficha) ~ 100 mg comp ~ VO al acostarse ~ 50-100 mg ~ cada 24 h ~ ~ ;; Depresión ~ 100 mg comp ~ VO ~ 150 mg ~ cada 24 h ~ ~ 300 mg/día
Melatonina | Circadin | 2 mg comp liberación prolongada | Insomnio en ≥ 55 años ~ 2 mg comp liberación prolongada ~ VO 1-2 h antes de acostarse ~ 2 mg ~ cada 24 h ~ 13 semanas ~

# Neurología y psiquiatría › Antidepresivos
Escitalopram | Cipralex; Esertia | 10 mg comp; 15 mg comp; 20 mg comp | Depresión / ansiedad ~ 10 mg comp ~ VO ~ 10 mg ~ cada 24 h ~ ≥ 6 meses tras remisión ~ 20 mg/día (10 mg si > 65 años)
Citalopram | Seropram | 20 mg comp; 30 mg comp | Depresión ~ 20 mg comp ~ VO ~ 20 mg ~ cada 24 h ~ ≥ 6 meses tras remisión ~ 40 mg/día (20 mg si > 65 años)
Fluoxetina | Prozac; Adofen | 20 mg cáps; 20 mg comp dispersables | Depresión / bulimia / TOC ~ 20 mg cáps ~ VO por la mañana ~ 20 mg ~ cada 24 h ~ ≥ 6 meses tras remisión ~ 60 mg/día
Paroxetina | Seroxat; Motivan | 20 mg comp | Depresión / pánico ~ 20 mg comp ~ VO por la mañana ~ 20 mg ~ cada 24 h ~ ≥ 6 meses tras remisión ~ 50 mg/día
Venlafaxina | Vandral retard | 75 mg cáps retard; 150 mg cáps retard | Depresión / ansiedad generalizada ~ 75 mg cáps retard ~ VO ~ 75 mg ~ cada 24 h ~ ~ 225 mg/día (AP)
Duloxetina | Cymbalta; Xeristar | 30 mg cáps; 60 mg cáps | Depresión / dolor neuropático diabético ~ 60 mg cáps ~ VO ~ 30-60 mg ~ cada 24 h ~ ~ 120 mg/día
Mirtazapina | Rexer | 15 mg comp; 30 mg comp | Depresión con insomnio o hiporexia ~ 15 mg comp ~ VO al acostarse ~ 15-30 mg ~ cada 24 h ~ ~ 45 mg/día

# Neurología y psiquiatría › Antipsicóticos y agitación
Quetiapina | Seroquel | 25 mg comp; 100 mg comp | Delirium / agitación en ancianos (uso fuera de ficha) ~ 25 mg comp ~ VO ~ 12,5-25 mg ~ cada 12 h ~ ~
Risperidona | Risperdal | 0,5 mg comp; 1 mg comp; 1 mg/ml solución | Agitación en demencia ~ 0,5 mg comp ~ VO ~ 0,25-0,5 mg ~ cada 12 h ~ máx 6 semanas ~ 1 mg/12 h
Biperideno | Akineton | 2 mg comp; 5 mg/1 ml amp | Distonía aguda por neurolépticos o metoclopramida ~ 5 mg/1 ml amp ~ IM o IV lenta ~ 2,5-5 mg ~ repetir a los 30 min si precisa ~ ~ 20 mg/día

# Neurología y psiquiatría › Demencia y Parkinson
Donepezilo | Aricept | 5 mg comp; 10 mg comp | Alzheimer leve-moderado ~ 5 mg comp ~ VO al acostarse ~ 5 mg ~ cada 24 h; a las 4-6 semanas 10 mg ~ ~ 10 mg/día
Levodopa/carbidopa | Sinemet | 100/25 mg comp; 250/25 mg comp | Enfermedad de Parkinson ~ 100/25 mg comp ~ VO ~ 1 comp ~ cada 8 h; ajustar ~ ~

# Neurología y psiquiatría › Alcohol y abstinencia
Tiamina (vitamina B1) | Benerva | 300 mg comp; 100 mg/1 ml amp | Alcoholismo / prevención de Wernicke (antes de la glucosa) ~ 100 mg/1 ml amp ~ IM o IV lenta ~ 100 mg ~ cada 24 h ~ ~ ;; Suplemento ~ 300 mg comp ~ VO ~ 300 mg ~ cada 24 h ~ ~
Clometiazol | Distraneurine | 192 mg cáps | Abstinencia alcohólica ~ 192 mg cáps ~ VO ~ 2-3 cáps ~ cada 8 h; reducir en 5-7 días ~ máx 10 días ~

# Alergia › Antihistamínicos
Ebastina | Ebastel | 10 mg comp; 20 mg comp; 10 mg y 20 mg liotabs | Rinitis o urticaria ~ 10 mg comp ~ VO ~ 10-20 mg ~ cada 24 h ~ ~
Bilastina | Bilaxten; Obalix | 20 mg comp | Rinitis o urticaria ~ 20 mg comp ~ VO en ayunas ~ 20 mg ~ cada 24 h ~ ~
Desloratadina | Aerius; Azomyr | 5 mg comp | Rinitis o urticaria ~ 5 mg comp ~ VO ~ 5 mg ~ cada 24 h ~ ~
Loratadina | Clarityne | 10 mg comp | Rinitis o urticaria ~ 10 mg comp ~ VO ~ 10 mg ~ cada 24 h ~ ~
Rupatadina | Rupafin; Alergoliber | 10 mg comp | Rinitis o urticaria ~ 10 mg comp ~ VO ~ 10 mg ~ cada 24 h ~ ~
Hidroxicina | Atarax | 25 mg comp | Prurito / ansiedad ~ 25 mg comp ~ VO ~ 25 mg ~ cada 8 h ~ ~ 100 mg/día (50 mg en mayores)

# Alergia › Anafilaxia (autoinyectores)
Adrenalina autoinyector | Altellus; Jext; Emerade | 0,15 mg autoinyector; 0,3 mg autoinyector | Anafilaxia (prescripción para casa o botiquín de rescate) ~ 0,3 mg autoinyector ~ IM cara externa del muslo ~ 0,3 mg (≥ 30 kg) ~ repetir a los 5-15 min si no mejora ~ ~ llevar siempre 2

# Hematología › Antídotos de anticoagulantes
Complejo protrombínico | Octaplex; Beriplex | 500 UI vial; 1.000 UI vial | Hemorragia grave con antivitamina K / anti-Xa ~ 500 UI vial ~ IV ~ 25-50 UI/kg ~ dosis única ~ ~ junto con vitamina K si AVK
Idarucizumab | Praxbind | 2,5 g/50 ml vial | Revertir dabigatrán (sangrado grave o cirugía urgente) ~ 2,5 g/50 ml vial ~ IV ~ 5 g (2 viales) ~ dosis única ~ ~
Protamina | Protamina Hospira | 50 mg/5 ml amp | Revertir heparina sódica ~ 50 mg/5 ml amp ~ IV lenta ~ 1 mg por cada 100 UI de heparina ~ dosis única ~ ~ 50 mg

# Hematología › Antianémicos
Ácido fólico | Acfol | 5 mg comp | Déficit de folato / embarazo de riesgo ~ 5 mg comp ~ VO ~ 5 mg ~ cada 24 h ~ ~ ;; Prevención de defectos del tubo neural ~ 5 mg comp ~ VO ~ 0,4-5 mg ~ cada 24 h ~ desde 1 mes antes hasta 12 semanas ~
Cianocobalamina (vitamina B12) | Optovite B12 | 1.000 mcg/2 ml amp | Déficit de B12 ~ 1.000 mcg/2 ml amp ~ IM ~ 1.000 mcg ~ días alternos 2 semanas, luego mensual ~ ~ ;; Déficit de B12 (VO) ~ ~ VO ~ 1.000-2.000 mcg ~ cada 24 h ~ ~
Hierro carboximaltosa | Ferinject | 500 mg/10 ml vial | Ferropenia con intolerancia oral (hospital de día) ~ 500 mg/10 ml vial ~ Perfusión IV ~ 500-1.000 mg ~ dosis única ~ ~ 20 mg/kg

# Musculoesquelético › Gota
Febuxostat | Adenuric | 80 mg comp; 120 mg comp | Hiperuricemia (intolerancia a alopurinol) ~ 80 mg comp ~ VO ~ 80 mg ~ cada 24 h ~ crónico ~

# Musculoesquelético › Osteoporosis
Risedronato | Actonel | 35 mg comp | Osteoporosis ~ 35 mg comp ~ VO en ayunas con agua, de pie 30 min ~ 35 mg ~ 1 vez a la semana ~ 5 años y reevaluar ~
Denosumab | Prolia | 60 mg jer | Osteoporosis ~ 60 mg jer ~ SC ~ 60 mg ~ cada 6 meses ~ no suspender sin pauta de salida ~
Colecalciferol (vitamina D3) | Deltius; Kern Pharma vitamina D | 25.000 UI ampolla bebible; 2.000 UI/ml gotas | Déficit de vitamina D ~ 25.000 UI ampolla bebible ~ VO ~ 25.000 UI ~ cada 2-4 semanas ~ ~
Calcio/colecalciferol | Mastical D; Ideos; Natecal D | 500 mg/400 UI comp masticables; 1.000 mg/880 UI | Osteoporosis con déficit de calcio y vitamina D ~ 500 mg/400 UI comp masticables ~ VO ~ 1 comp ~ cada 12-24 h ~ crónico ~

# Musculoesquelético › Relajantes musculares
Metocarbamol | Robaxin | 500 mg comp | Contractura muscular aguda ~ 500 mg comp ~ VO ~ 1.000-1.500 mg ~ cada 6-8 h ~ pocos días ~
Ciclobenzaprina | Yurelax | 10 mg cáps | Contractura muscular aguda ~ 10 mg cáps ~ VO ~ 5-10 mg ~ cada 8 h ~ máx 2-3 semanas ~ 30 mg/día

# Musculoesquelético › Antiinflamatorios tópicos
Diclofenaco tópico | Voltadol; Voltaren Emulgel | 1% gel; 2% gel; 140 mg apósito | Dolor musculoesquelético localizado ~ 1% gel ~ Tópica ~ aplicación ~ cada 6-8 h ~ máx 14 días ~
Etofenamato | Flogoprofen | 50 mg/g gel; 100 mg/ml spray | Dolor musculoesquelético localizado ~ 50 mg/g gel ~ Tópica ~ aplicación ~ cada 8 h ~ ~

# Musculoesquelético › Infiltraciones
Triamcinolona acetónido | Trigon Depot | 40 mg/1 ml vial | Infiltración articular o periarticular ~ 40 mg/1 ml vial ~ Intraarticular ~ 10-40 mg según articulación ~ dosis única ~ máx 3-4 al año en la misma articulación ~
Betametasona depot | Celestone Cronodose | 6 mg/ml vial | Infiltración / corticoide de depósito ~ 6 mg/ml vial ~ Intraarticular o IM ~ 3-6 mg ~ dosis única ~ ~

# Urología › Próstata y vía urinaria
Silodosina | Urorec; Silodyx | 8 mg cáps | HBP ~ 8 mg cáps ~ VO con comida ~ 8 mg ~ cada 24 h ~ ~
Dutasterida/tamsulosina | Duodart | 0,5/0,4 mg cáps | HBP con próstata grande ~ 0,5/0,4 mg cáps ~ VO ~ 1 cáps ~ cada 24 h ~ ~
Finasterida | Proscar | 5 mg comp | HBP con próstata grande ~ 5 mg comp ~ VO ~ 5 mg ~ cada 24 h ~ ≥ 6 meses ~

# Urología › Vejiga hiperactiva
Solifenacina | Vesicare | 5 mg comp; 10 mg comp | Vejiga hiperactiva ~ 5 mg comp ~ VO ~ 5 mg ~ cada 24 h ~ ~ 10 mg/día
Mirabegrón | Betmiga | 25 mg comp; 50 mg comp | Vejiga hiperactiva (mayores o con riesgo anticolinérgico) ~ 50 mg comp ~ VO ~ 50 mg ~ cada 24 h ~ ~

# Urología › Disfunción eréctil
Sildenafilo | Viagra | 25 mg comp; 50 mg comp; 100 mg comp | Disfunción eréctil ~ 50 mg comp ~ VO 1 h antes ~ 50 mg ~ a demanda, máx 1 vez/día ~ ~ 100 mg; nunca con nitratos ;; Prevención del edema pulmonar de altura (alternativa) ~ 50 mg comp ~ VO ~ 50 mg ~ cada 8 h ~ durante el ascenso ~
Tadalafilo | Cialis | 5 mg comp; 10 mg comp; 20 mg comp | Disfunción eréctil ~ 10 mg comp ~ VO ~ 10-20 mg a demanda (o 5 mg diario) ~ ~ ~ nunca con nitratos ;; Prevención del edema pulmonar de altura (susceptibles) ~ 10 mg comp ~ VO ~ 10 mg ~ cada 12 h ~ durante el ascenso ~

# Dermatología › Corticoides tópicos
Betametasona valerato | Celestoderm; Betnovate | 0,1% crema; 0,1% pomada | Dermatitis / eccema moderado ~ 0,1% crema ~ Tópica ~ capa fina ~ cada 12-24 h ~ máx 2-3 semanas ~
Clobetasol propionato | Clovate; Decloban | 0,05% crema; 0,05% pomada | Dermatosis grave (psoriasis, liquen) ~ 0,05% crema ~ Tópica ~ capa fina ~ cada 12-24 h ~ máx 2 semanas ~ 50 g/semana
Mometasona tópica | Elocom | 0,1% crema; 0,1% pomada | Eccema / dermatitis ~ 0,1% crema ~ Tópica ~ capa fina ~ cada 24 h ~ ~
Hidrocortisona tópica | Lactisona; Dermosa hidrocortisona | 1% crema; 2,5% loción | Dermatitis leve / zonas sensibles ~ 1% crema ~ Tópica ~ capa fina ~ cada 12 h ~ ~

# Dermatología › Antibióticos tópicos
Ácido fusídico | Fucidine | 2% crema; 2% pomada | Impétigo / infección cutánea localizada ~ 2% crema ~ Tópica ~ capa fina ~ cada 8 h ~ 7 días ~

# Dermatología › Antifúngicos tópicos
Ketoconazol tópico | Fungarest; Panfungol | 2% crema; 2% gel/champú | Dermatitis seborreica / pitiriasis versicolor ~ 2% gel/champú ~ Tópica ~ aplicar 5 min y aclarar ~ 2 veces por semana ~ 2-4 semanas ~
Sertaconazol | Dermofix; Zalain | 2% crema; 2% polvo | Tiña / candidiasis cutánea ~ 2% crema ~ Tópica ~ capa fina ~ cada 12-24 h ~ 4 semanas ~
Ciclopirox | Ciclochem | 8% laca de uñas; 1% crema | Onicomicosis leve ~ 8% laca de uñas ~ Tópica ~ capa fina ~ días alternos el 1.er mes ~ 6 meses ~

# Dermatología › Quemaduras y heridas
Povidona yodada | Betadine | 10% solución | Antisepsia de piel y heridas ~ 10% solución ~ Tópica ~ aplicación ~ ~ ~
Clorhexidina | Cristalmina | 1% solución; 2% solución acuosa | Antisepsia de heridas ~ 1% solución ~ Tópica ~ aplicación ~ cada 12-24 h ~ ~

# Dermatología › Acné y rosácea
Peróxido de benzoilo | Peroxiben; Benzac | 2,5%, 5% y 10% gel | Acné leve-moderado ~ 5% gel ~ Tópica por la noche ~ capa fina ~ cada 24 h ~ ≥ 8 semanas ~
Metronidazol tópico | Rozex; Rosiced | 0,75% gel; 0,75% crema | Rosácea ~ 0,75% gel ~ Tópica ~ capa fina ~ cada 12 h ~ 3-4 meses ~

# Oftalmología y ORL › Colirios
Tobramicina/dexametasona colirio | Tobradex | colirio 5 ml; pomada oftálmica | Inflamación ocular con infección (con valoración oftalmológica) ~ colirio 5 ml ~ Oftálmica ~ 1-2 gotas ~ cada 4-6 h ~ 7 días ~
Ofloxacino colirio | Exocin | 0,3% colirio | Conjuntivitis bacteriana / úlcera en portador de lentillas ~ 0,3% colirio ~ Oftálmica ~ 1-2 gotas ~ cada 4 h ~ 7-10 días ~
Ciclopentolato colirio | Colircusi ciclopléjico | 1% colirio | Dolor por erosión corneal / ceguera de las nieves ~ 1% colirio ~ Oftálmica ~ 1 gota ~ cada 8-12 h ~ 1-2 días ~
Fluoresceína colirio | Colircusi fluoresceína | 2% colirio | Diagnóstico de erosión corneal (solo en consulta) ~ 2% colirio ~ Oftálmica ~ 1 gota ~ dosis única ~ ~
Lágrimas artificiales (hialuronato) | Hylo; Aquoral; Systane | colirio multidosis; monodosis | Ojo seco / protección (ceguera de las nieves) ~ colirio multidosis ~ Oftálmica ~ 1 gota ~ a demanda ~ ~
Eritromicina pomada oftálmica | Oftalmolosa Cusí eritromicina | 0,5% pomada oftálmica | Erosión corneal / blefaritis ~ 0,5% pomada oftálmica ~ Oftálmica ~ 1 cm ~ cada 6-8 h ~ 5-7 días ~

# Oftalmología y ORL › Otológicos
Ciprofloxacino/fluocinolona ótico | Cetraxal Plus | gotas óticas monodosis | Otitis externa con inflamación ~ gotas óticas monodosis ~ Ótica ~ 1 monodosis ~ cada 12 h ~ 7 días ~
Cerumenolítico | Otocerum | gotas óticas | Tapón de cerumen ~ gotas óticas ~ Ótica ~ 4-5 gotas ~ cada 8-12 h ~ 3-4 días antes del lavado ~

# Oftalmología y ORL › Garganta y boca
Clorhexidina/benzocaína | Angileptol; Cariax | comp para chupar; colutorio | Odinofagia / gingivitis ~ comp para chupar ~ Bucal ~ 1 comp ~ cada 2-4 h ~ ~ 8 comp/día

# Ginecología y obstetricia › Anticoncepción de urgencia
Ulipristal | ellaOne | 30 mg comp | Anticoncepción de urgencia (< 120 h) ~ 30 mg comp ~ VO ~ 30 mg ~ dosis única ~ ~

# Ginecología y obstetricia › Anticonceptivos
Etinilestradiol/levonorgestrel | Loette; Ovoplex; Microgynon | 20/100 mcg comp; 30/150 mcg comp | Anticoncepción oral combinada ~ 20/100 mcg comp ~ VO ~ 1 comp ~ cada 24 h 21 días + 7 de descanso ~ ~
Desogestrel | Cerazet; Azalia | 75 mcg comp | Anticoncepción solo gestágeno (lactancia, contraindicación de estrógenos) ~ 75 mcg comp ~ VO ~ 1 comp ~ cada 24 h sin descanso ~ ~

# Ginecología y obstetricia › Embarazo y lactancia
Yoduro potásico | Yoduk; Yodocefol | 200 mcg comp | Embarazo y lactancia ~ 200 mcg comp ~ VO ~ 200 mcg ~ cada 24 h ~ ~

# Ginecología y obstetricia › Infecciones vaginales
Clotrimazol vaginal | Gine-Canesten | 500 mg comp vaginal; 2% crema vaginal | Candidiasis vaginal ~ 500 mg comp vaginal ~ Vaginal ~ 500 mg ~ dosis única al acostarse ~ ~
Metronidazol vaginal | Flagyl óvulos | 500 mg óvulos | Vaginosis bacteriana ~ 500 mg óvulos ~ Vaginal ~ 1 óvulo ~ cada 24 h ~ 7 días ~

# Ginecología y obstetricia › Urgencias obstétricas
Sulfato de magnesio | Sulmetin | 1,5 g/10 ml amp | Eclampsia / preeclampsia grave ~ 1,5 g/10 ml amp ~ IV ~ 4 g en 15-20 min ~ después 1 g/h ~ ~ ;; Torsade de pointes ~ 1,5 g/10 ml amp ~ IV ~ 2 g en 10 min ~ ~ ~ ;; Crisis asmática grave ~ 1,5 g/10 ml amp ~ IV ~ 2 g en 20 min ~ dosis única ~ ~
Oxitocina | Syntocinon | 10 UI/1 ml amp | Prevención de hemorragia posparto (parto extrahospitalario) ~ 10 UI/1 ml amp ~ IM ~ 10 UI ~ tras la salida del bebé ~ ~

# Antídotos y toxicología › Humo, cianuro y monóxido
Hidroxocobalamina | Cyanokit | 5 g vial | Intoxicación por humo de incendio con sospecha de cianuro ~ 5 g vial ~ IV en 15 min ~ 5 g (70 mg/kg) ~ repetir 5 g si persiste ~ ~ 10 g

# Antídotos y toxicología › Otros antídotos
Glucagón | | | Intoxicación por betabloqueantes ~ 1 mg vial + jeringa ~ IV ~ 3-10 mg (50-150 mcg/kg) ~ después perfusión ~ ~
Atropina | | | Intoxicación por organofosforados ~ 1 mg/1 ml amp ~ IV ~ 1-2 mg ~ duplicar cada 5 min hasta secar secreciones ~ ~

# Soporte vital y urgencias › Vasoactivos
Dobutamina | Dobutamina Inibsa | 250 mg/20 ml amp | Shock cardiogénico / bajo gasto ~ 250 mg/20 ml amp ~ Perfusión IV ~ 2,5-10 mcg/kg/min ~ ajustar según respuesta ~ ~ 20 mcg/kg/min
Efedrina | Efedrina Level | 50 mg/1 ml amp | Hipotensión tras sedación o anestesia ~ 50 mg/1 ml amp ~ IV en bolo (diluida) ~ 5-10 mg ~ repetir cada 5 min si precisa ~ ~ 50 mg

# Soporte vital y urgencias › Secuencia rápida de intubación
Succinilcolina | Anectine | 100 mg/2 ml amp | Relajación para intubación de secuencia rápida ~ 100 mg/2 ml amp ~ IV ~ 1-1,5 mg/kg ~ dosis única ~ ~ no si hiperpotasemia, quemados > 48 h, inmovilización
Sugammadex | Bridion | 200 mg/2 ml vial | Revertir rocuronio (no intubable / no ventilable) ~ 200 mg/2 ml vial ~ IV en bolo ~ 16 mg/kg ~ dosis única ~ ~

# Soporte vital y urgencias › Sueroterapia
Ringer lactato | Ringer lactato Braun | 500 ml; 1.000 ml | Shock hipovolémico / quemados ~ 500 ml ~ IV ~ 500 ml en bolo ~ reevaluar tras cada bolo ~ ~ quemados: 2-4 ml/kg/% SCQ en 24 h (mitad en las 8 primeras)
Glucosa 5% | Glucosado 5% | 500 ml; 250 ml | Vía de mantenimiento / hipoglucemia tras bolo ~ 500 ml ~ IV ~ 500 ml ~ cada 6-8 h según situación ~ ~

# Montaña y rescate › Mordeduras y picaduras
Antiveneno de víbora | ViperaTAb; Viperfav | vial liofilizado | Mordedura de víbora grado II-III (consultar toxicología) ~ vial liofilizado ~ IV en 15-30 min ~ según producto (ViperaTAb: 2 viales; Viperfav: 4 ml) ~ repetir según evolución ~ ~ pedir al hospital de referencia

# Montaña y rescate › Mal agudo de montaña
Paracetamol | | | Cefalea de altura ~ 1 g comp ~ VO ~ 1 g ~ cada 8 h ~ ~ 4 g/día
"""

def split(x, sep): return [t.strip() for t in x.split(sep) if t.strip()]
folder = None; added = 0; merged = 0
for line in DATA.strip().split('\n'):
    line = line.strip()
    if not line: continue
    if line.startswith('#'):
        folder = line[1:].strip(); continue
    parts = [p.strip() for p in line.split('|')]
    assert len(parts) == 4, line
    name, brands, pres, regs = parts
    rlist = []
    for r in split(regs, ';;'):
        f = [t.strip() for t in r.split('~')]
        assert len(f) == 7, (name, r, len(f))
        rlist.append({k: v for k, v in zip(KEYS, f)})
    key = name.lower()
    if key in byname:
        d = byname[key]
        for b in split(brands, ';'):
            if b not in d['brands']: d['brands'].append(b)
        for p in split(pres, ';'):
            if p not in d['presentations']: d['presentations'].append(p)
        d['regimens'].extend(rlist); merged += 1
    else:
        d = {"name": name, "brands": split(brands, ';'), "folder": folder, "presentations": split(pres, ';'), "regimens": rlist}
        drugs.append(d); byname[key] = d; added += 1
    assert not re.search(r'[/>]', folder.replace(' › ', '')), folder

base['about'] = ("Plantilla de Dr.Folio (v2) para Atención Primaria, Urgencias y Rescate en montaña: carpetas por grupo terapéutico "
                 "con los fármacos y nombres comerciales principales. Dosis de adulto orientativas: revísalas antes de usarlas.")
base['templateVersion'] = 2
json.dump(base, open(P, 'w'), ensure_ascii=False, indent=1)
open(P, 'a').write('\n')
folders = {d['folder'] for d in drugs}
print(f"añadidos {added}, completados {merged}; total {len(drugs)} fármacos, {len({f.split(' › ')[0] for f in folders})} grupos, {len(folders)} subcarpetas")
