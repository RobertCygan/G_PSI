#!/usr/bin/env python3
"""
Oppdater datagrunnlaget (js/data.js) for Utgiftsanalyse Steigen kommune.
G-PSI GovTech Solutions.

Bruk:
    pip install pandas openpyxl
    python tools/oppdater_data.py --xlsm Ready2.xlsm --out js/data.js

Leser arket «Grunn_data» i Ready2.xlsm og henter KOSTRA (12362, 12367),
KPI (03014) og folkemengde (07459) fra SSBs åpne API (data.ssb.no).
Analyseperioden er 2016–2025; juster årstallene i skriptet ved ny periode.
"""
import argparse, json, math, datetime, itertools, re, urllib.request, urllib.parse
import pandas as pd, numpy as np

AP = argparse.ArgumentParser()
AP.add_argument('--xlsm', required=True, help='Sti til Ready2.xlsm')
AP.add_argument('--out', default='js/data.js', help='Utfil (standard js/data.js)')
ARGS = AP.parse_args()

def fetch(table, codes):
    q = {'lang': 'no', 'outputFormat': 'json-stat2'}
    for k, v in codes.items(): q['valueCodes[' + k + ']'] = v
    url = 'https://data.ssb.no/api/pxwebapi/v2/tables/' + table + '/data?' + urllib.parse.urlencode(q, safe='*,[]')
    with urllib.request.urlopen(url, timeout=120) as r:
        return json.loads(r.read().decode('utf-8'))

# ---------------- JSON-stat ----------------
def load(d):
    ids = d['id']; sizes = d['size']
    cats = []
    for i in ids:
        c = d['dimension'][i]['category']
        idx = c['index']
        order = sorted(idx, key=lambda k: idx[k]) if isinstance(idx, dict) else idx
        cats.append(order)
    vals = d['value']
    rows = []
    for n, combo in enumerate(itertools.product(*cats)):
        v = vals[n] if isinstance(vals, list) else vals.get(str(n))
        rows.append(combo + (v,))
    df = pd.DataFrame(rows, columns=ids + ['value'])
    labels = {i: d['dimension'][i]['category'].get('label', {}) for i in ids}
    return df, labels, d

# ---------------- Klassifisering av privatpersoner ----------------
ORG_TOKENS = r"""as asa sa da ans ba kf iks nuf ab gmbh ltd inc oy aps sl llc bv ug sf
kommune kommunes fylkeskommune fylkeskommunen kommunen staten stat etat etaten direktoratet direktorat tilsynet nav husbanken skatteetaten
statens politi politiet tingrett lagmannsrett domstol fylkesmannen statsforvalteren sykehus helse hf universitet universitetet høgskole høgskolen skole skolen barnehage
stiftelse stiftelsen forening foreningen lag laget idrettslag bygdelag velforening sanitetsforening klubb klubben forbund forbundet
senter senteret senter, sentret hotel hotell hotels taxi transport bil bilutleie rent kraft energi elektro el
bygg byggservice entreprenør entreprenør maskin maskiner verksted service services consult consulting rådgivning regnskap revisjon advokat advokatfirma
gruppen group norge norway nord sør vest øst finans bank sparebank forsikring forsikringsselskap leasing
butikk handel handelslag joker coop rema kiwi spar bunnpris extra meny obs apotek elkjøp jysk clas biltema byggmakker
media avis forlag trykk trykkeri print data system systemer software it teknologi solutions tech
museet museum teater kirke kirkelig menighet menighetsråd fellesråd prosjekt
vekst eiendom eiendommer bolig boligutleie brygge brygger vertshus kafe kafé restaurant catering mat bakeri
fysio fysioterapi fysiogym legesenter legekontor tannlege tannklinikk psykolog psykologtjenester klinikk
landbruk gård gårdsopplevelser opplevelser fisk fiskeri sjømat havbruk
kontroll kontrollutvalg regionråd interkommunale salten iua rkk brann beredskap
avd avdeling region regional nasjonal norsk norske nordland nordlands tromsø bodø fauske steigen
tolk tolketjeneste tolkenett tjenester tjeneste veiledning kommunikasjon
""".split()
ORG_SET = set(t.strip(',').lower() for t in ORG_TOKENS)
def is_org(name):
    if not isinstance(name, str): return True
    n = name.strip()
    low = n.lower()
    toks = re.findall(r"[a-zæøåäöüé0-9\.&\-]+", low)
    if any(ch.isdigit() for ch in n): return True
    if any(t.strip('.') in ORG_SET for t in toks): return True
    if any(s in low for s in ['&', '.no', '.com', 'a/s', '(', ')', 'v/', 'avd', 'kommun', 'fylke', 'senter', 'service', 'transport', 'bygg', 'regnskap', 'konsult', 'consult', 'invest', 'holding', 'utleie', 'handel', 'kraft', 'taxi', 'opplev', 'eiendom', 'gård']):
        return True
    return False
def is_person(name):
    if not isinstance(name, str): return False
    if is_org(name): return False
    toks = re.findall(r"[A-Za-zÆØÅæøåÄÖÜäöüÉé\-']+", name)
    return 2 <= len(toks) <= 5

EXTRA_ORG = """bilruter bensinstasjon familieetat friskole dyrlegen dyrlege veterinær lege legetjenester legevaktslege institutt folkehelseinstitutt visma scandic
landskapsarkitekt låneadministrasjon grendelag helselag snekkerverksted storkjøkken radio brødrene agentur konsulent skog folkeuniversitetet
leirskole vikingleirskole ikea design skogselskap lås sikkerhet maskindrift programvare rådgivningstjeneste lederutvikling villa lokalavisa teknikk
økonomi tools vannverk torget komplett språkverksted interiøras sykehuset veimerking endring veilys tidsskriftformidlingen camping råd gartner renhold
steigenskolen paintballklubb høyskolen kursinstitutt music events produksjon veilysforening ul foto aof reisen najonalforeningen nasjonalforeningen
birding brukerforeningen landsforeningen amedia ntnu first bokmakeri eurobib coaching boligtakst black box musikk riks tv power produkter kro nks
steigenbarnehagen frivillig sentraler elektriske nordic anlegg folkeakademiet røde kors shop psykologspesialist lyd kunstnernes logoped hovedorganisasjonen
rørlegger kapital brillehuset studentforeningen møbelringen jaktlag organisasjonen auto redd barna leger uten grenser gàvpi yogaskole helsetjenester camp
musikkfabrikk travel kurs brannteknikk scientific bruktbutikk litteratur førstehjelp livredningskurs productions ikas skogeierforbund båtforening
språknøkler studentsamskipnaden walley bøker sport filter jeger fiskerforbund clarion barnehagen il kystkulturforening ultimate dagsverk trafikk fjordcamp
kaker konfekt mimmis klarna alpint event sorte får fotball hagebruk vandrerhjem dagligvarer veilag asvo ord hjertet tale solidaritetsaksjon idrettsforening
massasje enk antikvariat bad skytterlag framtiden entreprenørskap forskningsråd electric vannanlegg venner unique plancisc smartsskill agentur
bell big tekstil helse-torget gjerdes skovmand storkjøkken sauar rabarbra telle opplysningsvesenets fond virke pokalforum lese bedre glade bygdelag
operasjon oppvekst lensmannsetaten etaten gàvpi away vinjeproduksjoner wittusen frisør optiker klinikk tannhelse fysioterapeut terapi tolk språk kompetanse akademi forlag bok bokhandel papir kontor maling""".split()
ORG_SET.update(t.lower() for t in EXTRA_ORG)
_is_person_base = is_person
def is_person(name):
    if isinstance(name, str) and 'dødsbo' in name.lower(): return True
    return _is_person_base(name)

# ---------------- Bygg datagrunnlag ----------------
if True:

    raw = pd.read_excel(ARGS.xlsm, sheet_name='Grunn_data', engine='openpyxl')
    n_raw = len(raw)
    stray = raw[raw['Konto'].isna()]
    df = raw.dropna(subset=['Konto']).copy()
    for c in ['Bilagsnr','Periode','Konto','Ansv','År','Resk.nr']:
        df[c] = df[c].astype('int64')
    k = df['Konto']
    df['inv'] = (k < 10000).astype(int)
    df['art'] = np.where(k >= 10000, (k % 10000)//10, k//10)

    # ---- exclusions: income arts (600-999) are not expenditures
    inc = df[df['art'] >= 600]
    exp = df[df['art'] < 600].copy()

    # ---- bilag series
    def series(b):
        s = str(b)
        if len(s) == 8 and s[0] == '9': return 0
        if len(s) == 7 and s.startswith('82'): return 1
        return 2
    exp['ser'] = exp['Bilagsnr'].map(series)

    # ---- tjenesteområder (KOSTRA-funksjon -> område -> sektor)
    SEKTOR = [
     ('S1','Administrasjon og fellesutgifter'),
     ('S2','Oppvekst'),
     ('S3','Helse og omsorg'),
     ('S4','Sosial og barnevern'),
     ('S5','Teknisk sektor og samferdsel'),
     ('S6','Kultur, idrett og kirke'),
     ('S7','Næring og landbruk'),
     ('S8','Finans og interne transaksjoner'),
    ]
    TO = [
     ('T01','Politisk styring og kontroll','S1',[100,110]),
     ('T02','Administrasjon','S1',[120,121,130]),
     ('T03','Fellesutgifter og pensjon','S1',[170,171,172,173,180,190,290]),
     ('T18','Tjenester utenfor ordinært ansvarsområde','S1',[285]),
     ('T04','Barnehage','S2',[201,211,221]),
     ('T05','Grunnskole og voksenopplæring','S2',[202,213,215,222,223]),
     ('T06','Kommunehelse','S3',[232,233,241,255,256]),
     ('T07','Pleie og omsorg','S3',[234,253,254,257,258,261]),
     ('T08','Sosiale tjenester','S4',[242,243,273,275,276,281,283]),
     ('T09','Barnevern','S4',[244,251,252]),
     ('T10','Kommunale boliger','S5',[265,315]),
     ('T11','Plan, byggesak og miljø','S5',[301,302,303,304,305,360]),
     ('T12','Samferdsel','S5',[330,332]),
     ('T13','Brann og ulykkesvern','S5',[338,339]),
     ('T14','Vann, avløp og renovasjon','S5',[340,345,350,353,354,355,357]),
     ('T15','Næring og landbruk','S7',[320,321,322,325,329]),
     ('T16','Kultur og idrett','S6',[231,335,365,370,373,375,377,380,381,383,385,386]),
     ('T17','Kirke og livssyn','S6',[390,392,393]),
     ('T19','Finans og interne transaksjoner','S8',list(range(800,900))),
    ]
    f2to = {}
    for i,(tid,tn,sid,fl) in enumerate(TO):
        for f in fl: f2to[f] = i
    assert set(exp['Ansv'].unique()) <= set(f2to), set(exp['Ansv'].unique()) - set(f2to)

    # ---- art groups
    AG = [
     ('A1','Lønn og sosiale utgifter','010–099'),
     ('A2','Kjøp av varer og tjenester (egenproduksjon)','100–285'),
     ('A3','Kjøp som erstatter egenproduksjon','300–380'),
     ('A4','Overføringer','400–480 ekskl. 429'),
     ('A5','Merverdiavgift (kompensasjonsberettiget)','429'),
     ('A6','Finansutgifter (renter, avdrag, utlån)','500–599'),
    ]
    def agi(a):
        if a < 100: return 0
        if a < 300: return 1
        if a < 400: return 2
        if a == 429: return 4
        if a < 500: return 3
        return 5
    exp['ag'] = exp['art'].map(agi)

    # ---- dictionaries
    def enc(series):
        cats = sorted(series.unique().tolist(), key=lambda x: str(x))
        m = {c:i for i,c in enumerate(cats)}
        return cats, series.map(m).astype(int)

    # leverandør with anonymisation
    sup_names = sorted(exp['Leverandør'].unique().tolist())
    person = {s: is_person(s) for s in sup_names}
    n_person = sum(person.values())
    ANON = 'Privatpersoner (anonymisert)'
    exp['lev'] = exp['Leverandør'].map(lambda s: ANON if person[s] else s)
    lev_bransje = exp.groupby('lev')['Bransje hovedkategori'].agg(lambda s: s.value_counts().index[0])
    lev_bransje[ANON] = 'Privatpersoner'
    lev_cats, exp['li'] = enc(exp['lev'])
    bransje_cats = sorted(set(lev_bransje.values))
    bi = {b:i for i,b in enumerate(bransje_cats)}

    vtg_cats = sorted(exp['Vare-/tjenestegruppe'].unique().tolist())
    vi = {v:i for i,v in enumerate(vtg_cats)}
    mg_cats = sorted(exp['Mottakergruppe'].unique().tolist())
    mi = {v:i for i,v in enumerate(mg_cats)}

    konto_tbl = exp.groupby('Konto').agg(n=('Varer','first'), art=('art','first'), inv=('inv','first'), ag=('ag','first'), vtg=('Vare-/tjenestegruppe','first')).reset_index()
    konto_tbl = konto_tbl.sort_values('Konto').reset_index(drop=True)
    ki = {k:i for i,k in enumerate(konto_tbl['Konto'])}
    func_tbl = exp.groupby('Ansv').agg(n=('Kunde','first'), mg=('Mottakergruppe','first')).reset_index().sort_values('Ansv').reset_index(drop=True)
    fi = {f:i for i,f in enumerate(func_tbl['Ansv'])}

    exp = exp.sort_values(['Periode','Bilagsnr']).reset_index(drop=True)

    def clean_name(s):
        s = str(s).replace('  ',' ').strip()
        s = s.replace('INV - ','').replace('INV- ','')
        return s

    data = {}
    data['meta'] = {
      'generated': datetime.date.today().isoformat(),
      'file': 'Ready2.xlsm (ark «Grunn_data»)',
      'rows_raw': int(n_raw),
      'rows_stray': int(len(stray)), 'stray_sum': round(float(stray['Beløp'].sum()),2),
      'rows_income': int(len(inc)), 'income_sum': round(float(inc['Beløp'].sum()),2),
      'rows_exp': int(len(exp)),
      'persons': int(n_person),
      'suppliers': int(len(sup_names)),
    }
    data['income_by_art'] = [
      {'art': int(a), 'n': clean_name(g['Varer'].iloc[0]), 'sum': {str(int(y)): round(float(v),2) for y,v in g.groupby('År')['Beløp'].sum().items()}}
      for a,g in inc.groupby('art')]
    data['sektor'] = [{'id':s,'n':n} for s,n in SEKTOR]
    sidx = {s:i for i,(s,_) in enumerate(SEKTOR)}
    data['to'] = [{'id':t,'n':n,'s':sidx[s],'f':fl if t!='T19' else '800–899'} for t,n,s,fl in TO]
    data['ag'] = [{'id':a,'n':n,'art':r} for a,n,r in AG]
    data['konto'] = [{'k':int(r.Konto),'n':clean_name(r.n),'art':int(r.art),'inv':int(r.inv),'ag':int(r.ag),'v':vi[r.vtg]} for r in konto_tbl.itertuples()]
    data['func'] = [{'f':int(r.Ansv),'n':str(r.n).replace('4t','t') if 'investeringsregnskape4t' in str(r.n) else str(r.n),'to':f2to[int(r.Ansv)],'mg':mi[r.mg]} for r in func_tbl.itertuples()]
    data['vtg'] = vtg_cats
    data['mg'] = mg_cats
    data['bransje'] = bransje_cats
    data['lev'] = [{'n':l,'b':bi[lev_bransje[l]]} for l in lev_cats]
    data['tx'] = {
      'p': exp['Periode'].tolist(),
      'k': exp['Konto'].map(ki).tolist(),
      'f': exp['Ansv'].map(fi).tolist(),
      'l': exp['li'].tolist(),
      'a': [round(float(x),2) for x in exp['Beløp']],
      's': exp['ser'].tolist(),
      'b': exp['Bilagsnr'].tolist(),
    }

    # ---- KPI and population (SSB)
    kpi_df, _, _ = load(fetch('03014', {'Konsumgrp':'TOTAL','ContentsCode':'KpiAar','Tid':','.join(str(y) for y in range(2015,2026))}))
    data['kpi'] = {'base':2025, 'table':'SSB tabell 03014 (KPI, årsgjennomsnitt, 2015=100)', 'idx': {r.Tid: float(r.value) for r in kpi_df.itertuples()}}
    pop_df, _, _ = load(fetch('07459', {'Region':'1848','ContentsCode':'Personer1','Tid':','.join(str(y) for y in range(2016,2027))}))
    pop1jan = {int(r.Tid): int(r.value) for r in pop_df.itertuples()}
    data['pop'] = {'table':'SSB tabell 07459 (folkemengde 1. januar)', 'jan1': {str(y):pop1jan[y] for y in range(2016,2027)},
                   'dec31': {str(y):pop1jan[y+1] for y in range(2016,2026)}}

    # ---- KOSTRA
    YRS = ','.join(str(y) for y in range(2016,2026))
    k62, lab62, d62 = load(fetch('12362', {'KOKkommuneregion0000':'1848,EKG06,EKA18,EAKUO','KOKfunksjon0000':'*','KOKart0000':'AGD10,AGD2,AG16,AGI5,AGD4','ContentsCode':'KOSbelop0000,KOSbelopinnbygge0000','Tid':YRS}))
    k67, lab67, d67 = load(fetch('12367', {'KOKkommuneregion0000':'1848','KOKregnskapsomfa0000':'B','KOKfunksjon0000':'*','KOKart0000':'*','ContentsCode':'KOSbelop0000','Tid':YRS}))
    years = [str(y) for y in range(2016,2026)]
    # Steigen functions (konsern) beløp 1000 kr
    s = k62[(k62.KOKkommuneregion0000=='1848') & (k62.ContentsCode=='KOSbelop0000') & k62.KOKfunksjon0000.str[:3].str.isdigit()]
    fun = {}
    for (f,a),g in s.groupby(['KOKfunksjon0000','KOKart0000']):
        vals = {r.Tid: (None if r.value is None or (isinstance(r.value,float) and math.isnan(r.value)) else r.value) for r in g.itertuples()}
        if all(v in (None,0) for v in vals.values()): continue
        fun.setdefault(f, {'n': lab62['KOKfunksjon0000'][f], 'to': f2to.get(int(f))})[a] = [vals.get(y) for y in years]
    data['kostra_func'] = fun
    # FGK per innbygger comparisons
    cmp = {}
    for (r,f,a,c),g in k62[k62.KOKfunksjon0000.str.startswith('FGK')].groupby(['KOKkommuneregion0000','KOKfunksjon0000','KOKart0000','ContentsCode']):
        if a not in ('AGD10','AGD2'): continue
        vals = {x.Tid: x.value for x in g.itertuples()}
        cmp.setdefault(f, {'n': lab62['KOKfunksjon0000'][f], 'r': {}})['r'].setdefault(r, {}).setdefault(c, {})[a] = [None if vals.get(y) is None or (isinstance(vals.get(y),float) and math.isnan(vals.get(y))) else vals.get(y) for y in years]
    data['kostra_fgk'] = cmp
    # totals per region: sum of 3-digit functions (beløp + per innbygger)
    tot = {}
    for (r,a,c),g in k62[k62.KOKfunksjon0000.str[:3].str.isdigit()].groupby(['KOKkommuneregion0000','KOKart0000','ContentsCode']):
        gg = g.groupby('Tid')['value'].sum(min_count=1)
        tot.setdefault(r, {}).setdefault(c, {})[a] = [None if pd.isna(gg.get(y)) else round(float(gg.get(y)),1) for y in years]
    data['kostra_tot'] = tot
    data['regions'] = {'1848':'Steigen','EKG06':'KOSTRA-gruppe 6','EKA18':'Nordland','EAKUO':'Landet uten Oslo'}
    # Steigen art decomposition (kasse B)
    f3 = k67[k67.KOKfunksjon0000.str[:3].str.isdigit()]
    art = {}
    for a,g in f3.groupby('KOKart0000'):
        gg = g.groupby('Tid')['value'].sum(min_count=1)
        art[a] = {'n': lab67['KOKart0000'][a], 'v':[None if pd.isna(gg.get(y)) else round(float(gg.get(y)),1) for y in years]}
    data['kostra_art'] = art
    # Art by function (kasse) for coverage per tjenesteområde: AGD50+AGD51+AG34 per function
    cov = {}
    for (f,a),g in f3[f3.KOKart0000.isin(['AGD50','AGD51','AG34','AGD10'])].groupby(['KOKfunksjon0000','KOKart0000']):
        vals = dict(zip(g.Tid, g.value))
        cov.setdefault(f, {})[a] = [None if pd.isna(vals.get(y)) else vals.get(y) for y in years]
    data['kostra_func_kasse'] = cov
    data['kostra_meta'] = {'updated': d62.get('updated'), 'years': years,
       't12362':'SSB tabell 12362: Utgifter til tjenesteområdene, kommunekonsern, etter funksjon og art (K)',
       't12367':'SSB tabell 12367: Detaljerte regnskapstall driftsregnskapet, kommunekasse, etter funksjon og art (K)',
       'group':'EKG06 (KOSTRA-gruppe 6, gruppering 2020– iht. SSB Klass 112)'}

    js_out = 'window.STEIGEN_DATA=' + json.dumps(data, ensure_ascii=False, separators=(',',':')) + ';'
    open(ARGS.out,'w',encoding='utf-8').write(js_out)
    print(ARGS.out, round(len(js_out)/1e6,2), 'MB')
    print(json.dumps(data['meta'], ensure_ascii=False))
    # sanity
    print(exp.groupby('År')['Beløp'].sum().round(0).to_dict())
    print(exp[exp.ag!=4].groupby('År')['Beløp'].sum().round(0).to_dict())
