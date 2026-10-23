#!/usr/bin/env python3
"""
Lager et anonymisert demodatasett for G-PSI Utgiftsanalyse.

Leser datagrunnlaget fra et ekte kundeoppsett (js/data.js) og skriver et
fiktivt datasett for «Fjordvik kommune» (demo-utgiftsanalyse/js/data.js):

* Kommunenavn, kommunenummer, steds- og regionnavn byttes ut.
* Alle leverandørnavn erstattes med fiktive navn (samme bransje).
* Folketall og alle KOSTRA-beløp skaleres og får støy per år og post.
* Fakturalinjene syntetiseres: hele bilag trekkes tilfeldig (med tilbakelegging)
  fra nærliggende år, beløpene skaleres og får støy, og hvert år kalibreres
  til 90–96 % dekning mot KOSTRA-kjøpene. Bilagsnumrene genereres på nytt.

Ingen koblingsnøkkel mellom ekte og fiktive navn lagres.

    python tools/lag_demodata.py --src steigen-utgiftsanalyse/js/data.js \
                                 --out demo-utgiftsanalyse/js/data.js
"""
import argparse
import collections
import json
import math
import random
import re
import sys

SEED = 20261023
YEARS = list(range(2016, 2026))

CLIENT = {
    'id': 'DEMO', 'name': 'Fjordvik kommune', 'short': 'Fjordvik', 'slug': 'fjordvik',
    'region': 'Nordkyst', 'fylke': 'Nordfylket', 'demo': True,
}
# 1. januar 2016–2026
POP_JAN1 = [3418, 3402, 3391, 3420, 3445, 3431, 3437, 3496, 3502, 3489, 3511]

# Stedsnavn i tekster (konto, funksjon, mottakergruppe, inntektsarter)
TEXT_REPL = [
    ('Steigentunet', 'Fjordvikheimen'), ('Steigen Allhus', 'Fjordvik kulturhus'),
    ('STEIGEN', 'FJORDVIK'), ('Steigen', 'Fjordvik'), ('Salten', 'Nordkyst'),
    ('Nordland', 'Nordfylket'), ('Bodø', 'Havnås'), ('Fauske', 'Kvitnes'),
    ('Leinesfjord', 'Storbotn'), ('Nordfold', 'Holmvåg'), ('Engeløy', 'Skarvøy'),
]
# Ord som ikke skal finnes i resultatet (kontrolleres til slutt)
BANNED = ['steigen', 'salten', 'nordland', 'bodø', 'fauske', 'leinesfjord', 'nordfold',
          'engeløy', 'hamarøy', 'sørfold', 'ready2', '1848', 'fauskebygg', 'allhus']

SURN = ('Hansen Johansen Olsen Larsen Andersen Pedersen Nilsen Kristiansen Jensen Karlsen Johnsen '
        'Pettersen Eriksen Berg Haugen Hagen Johannessen Andreassen Jacobsen Dahl Jørgensen Halvorsen '
        'Henriksen Lund Sørensen Jakobsen Moen Gundersen Iversen Strand Solberg Svendsen Eide Knutsen '
        'Martinsen Paulsen Bakken Kristoffersen Mathisen Lie Amundsen Rasmussen Lunde Solheim Berge '
        'Moe Nygård Bakke Kristensen Fredriksen Holm Lien Hauge Christensen Andresen Nielsen Knudsen '
        'Evensen Sæther Aas Myhre Hanssen Haugland Thomassen Sivertsen Simonsen Danielsen Berntsen '
        'Sandvik Rønning Arnesen Antonsen Næss Vik Haug Ellingsen Thorsen Edvardsen Birkeland Isaksen '
        'Ruud Aasen Strøm Tangen Ødegaard Eliassen Bøe Aune Mikkelsen Tveit Brekke Abrahamsen Madsen '
        'Engen Fossum Hovland Nordby Sunde Wold Lyngstad Hoff Skog Bjørnstad Rød Ulriksen Grønli').split()
PLACE = ('Fjordvik Kvitnes Havnås Lysvika Storbotn Sølvhamn Skarvholm Måkeøy Tindvik Brattnes Granlia '
         'Furuvik Holmvåg Sandbukta Ospedal Kvalnes Ramvik Skjellbotn Bjørkvika Tjeldnes Rognlia '
         'Stokkvik Laksvåg Mjeldvik Kobbvåg Ørnes Grunnfjord Straumbu Nesvik Langøya').split()
REGION, FYLKE, BYEN = 'Nordkyst', 'Nordfylket', 'Havnås'

# Navnemaler per bransje (indeks = bransje-id i datasettet). {S}=etternavn, {P}=sted, {R}=region
TPL = {
    'Andre leverandører': ['{S} Service AS', '{P} Handel AS', '{S} & Sønn AS', '{P} Dyreklinikk', '{S} Konsult ENK', '{P} Diverse ANS', '{S} Tjenester AS'],
    'Arbeidsinkludering og tjenester': ['Fjordvik Vekst AS', '{R} Arbeidssenter AS'],
    'Avfall, vann og miljø': ['{R} Avfall IKS', '{P} Renovasjon AS', '{S} Gjenvinning AS', '{P} Slamtømming AS', '{P} Miljøservice AS'],
    'Bank, finans og forsikring': ['Statlig Boligbank', 'Norsk Kommuneforsikring AS', '{P} Sparebank', '{S} Finans AS', 'Kystleasing AS', 'Kommunal Pensjonskasse', '{R} Inkasso AS', 'Utstyrsfinans Norge AS', '{S} Forsikringsmegling AS'],
    'Bemanning og vikar': ['Helsevikar {R} AS', '{P} Bemanning AS', '{S} Rekruttering AS', 'Sykepleiervikar Norge AS', '{R} Personell AS'],
    'Bygg og håndverk': ['{S} Bygg AS', '{P} Bygg AS', '{S} Snekkerverksted', '{P} Tak og Fasade AS', '{S} Byggservice AS', '{S} Mur og Betong AS', '{P} Maler AS', '{S} Entreprenør AS', '{P} Byggmesterforretning AS', '{S} Glass og Ramme', '{S} Gulv og Flis AS', 'Tømrer {S}'],
    'Byggevarer og trelast': ['{P} Trelast AS', '{P} Byggevare AS', '{S} Byggsenter AS'],
    'Eiendom og utleie': ['{P} Eiendom AS', '{S} Utleie AS', '{P} Boligutleie AS', '{S} Eiendomsforvaltning AS', '{P} Næringsbygg AS'],
    'Elektro': ['{S} Elektro AS', '{P} Elektro AS', 'Elinstallatør {S} AS', '{R} Elektroservice AS'],
    'Energi og kraft': ['{R} Kraft AS', 'Kystnettet AS', '{P} Energi AS', 'Nordlys Strøm AS', '{S} Varme AS', '{R} Fjernvarme AS'],
    'Helse og medisinsk': ['Apotek {P}', 'MedEngros {R} AS', 'Kystsykehuset HF', '{P} Legesenter', '{S} Fysioterapi', '{P} Tannklinikk', '{P} Dyrlegekontor', '{S} Medisinsk AS', 'Hjelpemiddelpartner AS', '{R} Laboratorium AS', '{S} Psykologtjenester'],
    'Hotell og servering': ['{P} Hotell AS', '{P} Gjestegård', '{S} Kro og Catering', 'Fjordvik Vertshus', '{P} Kafé', '{BY} Fjordhotell AS'],
    'IT og teknologi': ['{R} IKT AS', 'Kommunesystemer AS', '{P} Data AS', '{S} IT AS', 'Datasky Norge AS', '{S} Digital AS', 'Saksbehandling Norge AS', 'Skoleplattform AS', '{R} Nettverk AS', 'Lisenspartner AS', '{P} PC-service'],
    'Industri, verksted og teknisk handel': ['Teknisk Engros {R} AS', '{P} Mekaniske Verksted AS', '{S} Verktøy AS', '{S} Industri AS', '{P} Sveis og Stål'],
    'Kirke og tros-/livssyn': ['Fjordvik kirkelige fellesråd', '{P} menighetsråd', '{P} kirkelige fellesråd'],
    'Kjøretøy og drivstoff': ['{BY} Bilutleie AS', '{P} Bensinstasjon', '{P} Auto AS', '{S} Bilverksted', 'Dekkservice {P}', '{S} Bil AS', '{R} Drivstoff AS'],
    'Kontor, møbler og inventar': ['{S} Kontorutstyr AS', '{P} Møbler AS', '{P} Interiør', 'Kontorpartner {R} AS', '{S} Inventar AS', 'Stillingsportalen AS', '{P} Museum', 'Kontormaskiner Nord AS', '{S} Gardiner og Tekstil'],
    'Kultur, idrett og fritid': ['{P} Kulturhus', '{S} Lyd og Lys AS', 'Bokformidling {R} AS', '{P} Idrettslag', 'Visit {R}', '{P} Musikkforening', 'Kulturarv {R} AS'],
    'Landbruk, fiskeri og natur': ['{S} Skog', '{P} Skogselskap', '{S} Gårdsdrift', '{P} Fisk AS', '{R} Fiskeritidende', '{S} Planteskole'],
    'Maskin og anlegg': ['{S} Maskin AS', '{P} Maskinsentral AS', '{S} Bygg og Anlegg AS', '{P} Asfalt AS', '{S} Graving og Transport AS', '{P} Pukk og Grus AS', '{S} Brøyting'],
    'Mat og dagligvarer': ['{S} Engros AS', 'Kystmat Engros AS', 'Nærbutikken {P}', '{P} Bakeri', '{P} Dagligvare AS', '{R} Storhusholdning AS', '{S} Fisk og Delikatesse'],
    'Media, trykk og kommunikasjon': ['{P}posten', 'Radio {R}', '{S} Trykkeri AS', '{R} Avis AS', '{S} Kommunikasjon', '{P} Reklame AS'],
    'Offentlig sektor': ['{BY} kommune', 'Fjordvik kommune (internfakturering)', '{FY} fylkeskommune', '{P} kommune', 'Statens innkrevingsetat', 'Statens kartetat', 'Statsforvalteren i {FY}', 'Helsefellesskap {R}', 'Statlig vegetat', 'NAV Fjordvik'],
    'Organisasjoner og medlemskap': ['{R} Brann og Redning IKS', '{R} Regionråd', 'Stiftelsen {P}', '{P} Grendelag', '{P} Velforening', '{P} Pensjonistforening', 'Kommunenes Fellesorganisasjon', '{P} Bygdekvinnelag', '{R} Friluftsråd', '{P} Frivilligsentral', '{P} Sanitetsforening', '{P} Ungdomslag'],
    'Privatpersoner': ['Privatpersoner (anonymisert)'],
    'Regnskap, revisjon og juridisk': ['{R} kommunerevisjon IKS', 'Advokatfirma {S} AS', '{S} Regnskap AS', 'Advokatfirmaet {S} & {S2} DA', '{P} Regnskapskontor', 'Advokat {S}'],
    'Renhold og hygiene': ['{P} Renhold AS', '{S} Hygiene AS', 'Rentservice {R} AS'],
    'Rådgivning og konsulent': ['{S} Rådgivning AS', '{P} Consult AS', 'Kystplan AS', '{S} & Partnere AS', 'Ingeniørfirma {S} AS', '{R} Arkitekter AS', '{S} Prosjektledelse AS', 'Analysehuset {R} AS'],
    'Sikkerhet og beredskap': ['{P} Lås og Sikkerhet AS', '{S} Brannservice AS', '{R} Vakt AS', 'Beredskapspartner AS'],
    'Telekom': ['Nordnett Telekom AS', 'Kystlink Mobil AS', '{P} Fiber AS', 'Telepartner AS', '{R} Bredbånd AS'],
    'Transport': ['{S} Transport AS', '{P} Bilruter AS', '{P} Taxi', 'Reisebyrå {R} AS', '{S} Båtservice', '{R} Ferjeselskap AS', '{P} Skyss AS', '{S} Budservice'],
    'Utdanning og kurs': ['{P} Friskole', 'Kompetansesenter {R}', '{S} Kurs og Kompetanse AS', '{P} Folkehøgskole', 'Lederutvikling {R} AS', '{P} Kurssenter', 'Fagskolen {R}'],
    'Utdanning og læremidler': ['Læremiddelforlaget AS', '{S} Forlag AS', 'Skolemateriell {R} AS', '{P} Bokhandel', 'Lek og Lær AS', 'Digitale Læremidler AS', '{S} Pedagogisk AS'],
    'VVS': ['{P} VVS AS', 'Rørlegger {S}', '{S} Rør AS', '{R} Varme og Sanitær AS'],
}


def load(path):
    s = open(path, encoding='utf-8').read()
    return json.loads(s[s.index('=') + 1:].rstrip().rstrip(';'))


def repl_text(s):
    for a, b in TEXT_REPL:
        s = s.replace(a, b)
    return s


def fake_names(d, tot, rng):
    """Ett nytt, unikt navn per leverandør; de største i hver bransje får de første malene."""
    used, out = set(), [None] * len(d['lev'])
    by_b = collections.defaultdict(list)
    for i, l in enumerate(d['lev']):
        by_b[l['b']].append(i)
    for b, idx in by_b.items():
        tpl = TPL[d['bransje'][b]]
        idx.sort(key=lambda i: -tot.get(i, 0))
        for rank, i in enumerate(idx):
            for attempt in range(400):
                t = tpl[rank] if (attempt == 0 and rank < len(tpl)) else rng.choice(tpl)
                s1, s2 = rng.sample(SURN, 2)
                n = t.format(S=s1, S2=s2, P=rng.choice(PLACE), R=REGION, FY=FYLKE, BY=BYEN)
                if attempt > 200:
                    n = n.replace(' AS', '') + ' ' + rng.choice(['AS', 'ANS', 'DA', 'Nord AS', 'Service AS'])
                if n not in used:
                    break
            else:
                sys.exit('fant ikke unikt navn for bransje ' + d['bransje'][b])
            used.add(n)
            out[i] = n
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    rng = random.Random(SEED)
    d = load(a.src)
    TX = d['tx']
    N0 = len(TX['a'])
    old_id = next(k for k in d['regions'] if not k.startswith('E'))
    old_dec = [d['pop']['dec31'][str(y)] for y in YEARS]
    new_dec = POP_JAN1[1:]
    # skalering per år: folketall × felles årsstøy
    F = [new_dec[j] / old_dec[j] * rng.gauss(1.0, 0.015) for j in range(10)]
    hcache = {}

    def h(key):  # fast støy per KOSTRA-post
        if key not in hcache:
            hcache[key] = max(0.8, min(1.2, rng.gauss(1.0, 0.06)))
        return hcache[key]

    def scale_arr(arr, key, j_noise=0.02):
        return [None if v is None else round(v * F[j] * h(key) * rng.gauss(1.0, j_noise)) for j, v in enumerate(arr)]

    out = {}
    out['client'] = CLIENT

    # --- KOSTRA ----------------------------------------------------------
    kf = {}
    for f, x in d['kostra_func'].items():
        y = {'n': repl_text(x['n']), 'to': x['to']}
        for k, v in x.items():
            if isinstance(v, list):
                y[k] = scale_arr(v, 'f' + f)
        kf[f] = y
    kfk = {}
    for f, x in d['kostra_func_kasse'].items():
        kfk[f] = {k: scale_arr(v, 'f' + f) if isinstance(v, list) else v for k, v in x.items()}
    ka = {}
    for k, x in d['kostra_art'].items():
        ka[k] = {'n': repl_text(x['n']), 'v': scale_arr(x['v'], 'a' + k)}

    def percap(tot1000):
        return {k: [None if v is None else round(v * 1000 / new_dec[j]) for j, v in enumerate(arr)] for k, arr in tot1000.items()}

    kt = {}
    for r, x in d['kostra_tot'].items():
        if r == old_id:
            bel = {k: scale_arr(v, 'tot' + k, 0.006) for k, v in x['KOSbelop0000'].items()}
            kt['DEMO'] = {'KOSbelop0000': bel, 'KOSbelopinnbygge0000': percap(bel)}
        else:
            kt[r] = x
    fgk = {}
    for g, x in d['kostra_fgk'].items():
        rr = {}
        for r, v in x['r'].items():
            if r == old_id:
                bel = {k: scale_arr(arr, 'fgk' + g + k, 0.015) for k, arr in v['KOSbelop0000'].items()}
                rr['DEMO'] = {'KOSbelop0000': bel, 'KOSbelopinnbygge0000': percap(bel)}
            else:
                rr[r] = v
        fgk[g] = {'n': x['n'], 'r': rr}

    # --- dimensjoner -----------------------------------------------------
    for k in ('sektor', 'to', 'ag'):
        out[k] = d[k]
    out['konto'] = [dict(c, n=repl_text(c['n'])) for c in d['konto']]
    out['func'] = [dict(c, n=repl_text(c['n'])) for c in d['func']]
    out['vtg'] = [repl_text(v) for v in d['vtg']]
    out['mg'] = [repl_text(v) for v in d['mg']]
    out['bransje'] = d['bransje']

    # --- leverandører ----------------------------------------------------
    tot = collections.Counter()
    for l, am in zip(TX['l'], TX['a']):
        tot[l] += am
    names = fake_names(d, tot, rng)
    order = sorted(range(len(names)), key=lambda i: names[i].lower())
    remap = {old: new for new, old in enumerate(order)}
    out['lev'] = [{'n': names[i], 'b': d['lev'][i]['b']} for i in order]
    anon = next(i for i, l in enumerate(out['lev']) if l['n'].startswith('Privatpersoner'))
    pension = next((remap[i] for i, l in enumerate(d['lev']) if 'Landspensjonskasse' in l['n']), None)
    if pension is None:
        sys.exit('fant ikke pensjonsleverandør')

    # --- fakturalinjer: bilagsgrupper -------------------------------------
    KPI = d['kpi']['idx']
    groups = collections.defaultdict(list)
    for i in range(N0):
        groups[TX['b'][i]].append(i)
    konto, func = d['konto'], d['func']
    fcode = {c['f']: j for j, c in enumerate(func)}

    def line_ok(i):
        k = konto[TX['k'][i]]
        return not (k['art'] < 100 and abs(TX['a'][i]) > 400000)  # holder engangs pensjonsposter utenfor
    pool = collections.defaultdict(lambda: {'d': [], 'i': []})
    for b, lines in groups.items():
        if not all(line_ok(i) for i in lines):
            continue
        y = TX['p'][lines[0]] // 100
        pool[y]['i' if any(konto[TX['k'][i]]['inv'] for i in lines) else 'd'].append(lines)

    cov_kos = [sum((ka[x]['v'][j] or 0) * 1000 for x in ('AGD50', 'AGD51', 'AG34')) for j in range(10)]
    agi5 = kt['DEMO']['KOSbelop0000']['AGI5']
    rows = []  # (p, k, f, l, a, groupkey)
    meta_cov = []
    for j, y in enumerate(YEARS):
        era = y >= 2024
        win = [t for t in range(y - 2, y + 3) if 2016 <= t <= 2025 and (t >= 2024) == era]

        def draw(kind):
            t = rng.choice(win)
            while not pool[t][kind]:
                t = rng.choice(win)
            return t, rng.choice(pool[t][kind])

        def emit(t, lines, gid, mult):
            res = []
            m = rng.gauss(1.0, 0.18)
            for i in lines:
                f = func[TX['f'][i]]['f']
                if y >= 2024 and f == 254:
                    f = rng.choice([257, 258])
                if y < 2024 and f in (257, 258):
                    f = 254
                mon = TX['p'][i] % 100 or 1
                am = TX['a'][i] * KPI[str(y)] / KPI[str(t)] * mult * max(0.4, m)
                res.append([y * 100 + mon, TX['k'][i], fcode[f], remap[TX['l'][i]], am, gid])
            return res
        # drift
        target_lines = int(6800 * new_dec[j] / 3420 * rng.gauss(1.0, 0.03))
        target_cov = cov_kos[j] * rng.uniform(0.90, 0.96)
        yr, n, gid = [], 0, 0
        while n < target_lines:
            t, g = draw('d')
            gid += 1
            r = emit(t, g, (y, gid), 1.0)
            yr += r
            n += len(r)
        cur = sum(r[4] for r in yr if cov_part_row(r, konto))
        fac = target_cov / cur
        for r in yr:
            r[4] *= fac
        # investering (ekskl. mva) ≈ 55–75 % av brutto investeringsutgifter / 1,25
        target_inv = agi5[j] * 1000 / 1.25 * rng.uniform(0.55, 0.75)
        s_inv = 0.0
        while s_inv < target_inv:
            t, g = draw('i')
            gid += 1
            r = emit(t, g, (y, gid), fac ** 0.5)
            s_inv += sum(x[4] for x in r if konto[x[1]]['inv'] and konto[x[1]]['art'] != 429)
            yr += r
        rows += yr
        meta_cov.append(round(target_cov / cov_kos[j], 3))

    # Premieavvik desember 2020 (engangspost, vises som «P» i trenden)
    k090 = next(j for j, c in enumerate(konto) if c['art'] == 90 and not c['inv'])
    prem = round(-5500124 * F[4] * rng.uniform(0.95, 1.05), 2)
    rows.append([202012, k090, fcode[170], pension, prem, (2020, 'prem')])

    # --- bilagsnummer og serier ------------------------------------------
    SWITCH = 202209
    gkeys = collections.OrderedDict()
    for r in rows:
        gkeys.setdefault(r[5], r[0])
    by_year = collections.defaultdict(list)
    for gk, p in gkeys.items():
        by_year[p // 100].append((p, rng.random(), gk))
    gnum = {}
    for y, lst in by_year.items():
        lst.sort()
        seq = {0: 0, 1: 0, 2: 0}
        for p, _, gk in lst:
            s = 2 if rng.random() < 0.025 else (1 if p >= SWITCH else 0)
            seq[s] += 1
            yy = y % 100
            num = {0: 10000000 + yy * 100000, 1: 60000000 + yy * 100000, 2: 7000000 + yy * 10000}[s] + seq[s]
            gnum[gk] = (num, s)
    rows.sort(key=lambda r: (r[0], gnum[r[5]][0]))
    tx = {'p': [], 'k': [], 'f': [], 'l': [], 'a': [], 's': [], 'b': []}
    for r in rows:
        num, s = gnum[r[5]]
        tx['p'].append(r[0]); tx['k'].append(r[1]); tx['f'].append(r[2]); tx['l'].append(r[3])
        tx['a'].append(round(r[4], 2)); tx['s'].append(s); tx['b'].append(num)

    # fjern leverandører uten linjer og renummerer
    used = sorted(set(tx['l']))
    lmap = {o: n for n, o in enumerate(used)}
    out['lev'] = [out['lev'][o] for o in used]
    tx['l'] = [lmap[x] for x in tx['l']]

    # --- inntekter, KPI, folketall, meta ---------------------------------
    inc = []
    for x in d['income_by_art']:
        inc.append({'art': x['art'], 'n': repl_text(x['n']),
                    'sum': {y: round(v * F[int(y) - 2016] * rng.gauss(1.0, 0.08), 2) for y, v in x['sum'].items()}})
    out['income_by_art'] = inc
    out['tx'] = tx
    out['kpi'] = d['kpi']
    out['pop'] = {'table': 'SSB tabell 07459 (folkemengde 1. januar) – fiktive tall',
                  'jan1': {str(2016 + j): v for j, v in enumerate(POP_JAN1)},
                  'dec31': {str(y): new_dec[j] for j, y in enumerate(YEARS)}}
    out['kostra_func'] = kf
    out['kostra_fgk'] = fgk
    out['kostra_tot'] = kt
    out['regions'] = {'DEMO': CLIENT['short'], 'EKG06': 'KOSTRA-gruppe 6', 'EKA18': 'Fylket', 'EAKUO': 'Landet uten Oslo'}
    out['kostra_art'] = ka
    out['kostra_func_kasse'] = kfk
    out['kostra_meta'] = d['kostra_meta']
    n_inc = int(len(tx['a']) * 0.011)
    persons = 312
    out['meta'] = {
        'generated': '2026-10-23', 'demo': True,
        'file': 'Fakturagrunnlag_2016-2025.xlsx', 'sheet': 'Fakturalinjer',
        'rows_raw': len(tx['a']) + n_inc + 1, 'rows_stray': 1, 'stray_sum': 0.0,
        'rows_income': n_inc, 'income_sum': round(sum(v for x in inc for v in x['sum'].values()), 2),
        'rows_exp': len(tx['a']), 'persons': persons, 'suppliers': len(out['lev']) - 1 + persons,
        'series': ['Serie 1xxxxxxx (2016 – aug. 2022)', 'Serie 6xxxxxxx (fra sep. 2022)', 'Andre bilagsserier (manuelle bilag)'],
        'system_change': {'p': SWITCH, 'label': 'Nytt økonomisystem'},
        'premie': {'p': 202012, 'a': prem},
    }

    js = 'window.GPSI_DATA=' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n'
    low = js.lower()
    pat = {w: re.compile(r'(?<![\d.])' + w + r'(?![\d.])' if w.isdigit() else re.escape(w)) for w in BANNED}
    bad = [w for w in BANNED if pat[w].search(low)]
    if bad:
        for w in bad:
            i = pat[w].search(low).start()
            print('FORBUDT:', w, js[max(0, i - 80):i + 40], file=sys.stderr)
        sys.exit(1)
    open(a.out, 'w', encoding='utf-8').write(js)
    print('linjer', len(tx['a']), 'leverandører', len(out['lev']), 'dekning', meta_cov, 'bytes', len(js.encode()))
    print('per år', sorted(collections.Counter(p // 100 for p in tx['p']).items()))


def cov_part_row(r, konto):
    k = konto[r[1]]
    return (not k['inv']) and 100 <= k['art'] < 500 and k['art'] != 429


if __name__ == '__main__':
    main()
