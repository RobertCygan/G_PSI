#!/usr/bin/env python3
"""
Lager et fiktivt datasett for G-PSI Eiendomsskatt-kartet («Fjordvik kommune»).

Alt er syntetisk: kystlinje, øyer, fjorder, grunnkretser, navn, skattetall og
byggdata. Skattemodellen følger reglene som gjaldt i perioden, slik at tallene
henger sammen:

* alminnelig taksering 2009 (gjelder 2010–2018) og ny taksering 2019
* obligatorisk reduksjonsfaktor 30 % for bolig/fritid fra 2020
* promille bolig/fritid 7 ‰ → 5 ‰ (2019–2020) → 4 ‰ (fra 2021); næring/verk 7 ‰
* kontorjustering +10 % for boliger i 2023
* kraftverkstakst som varierer år for år

Bare kategorinavnene i byggdata (nasjonale bygningstyper og -statuser) hentes
fra et ekte datasett (--labels), og kontrollen mot ekte stedsnavn bruker det
samme datasettet. Ingen tall gjenbrukes.

    python tools/lag_demo_eiendomsskatt.py --labels Eiendomsskatt_simulasjon_2010_2026/data.js \
        --out demo-eiendomsskatt/data.js
"""
import argparse
import json
import math
import random
import re
import sys

import numpy as np
import shapely
from shapely.geometry import MultiPoint, Point, box, mapping
from shapely.ops import unary_union

SEED = 7319
YEARS = list(range(2010, 2027))
KNR = '9999'                       # fiktivt kommunenummer
LON0, LAT0 = 11.60, 66.15          # kartets nedre venstre hjørne (åpent hav, ingen bakgrunnskart)
W, H, RES = 200.0, 140.0, 0.6      # km, km, km per rute
CX, CY = 104.0, 70.0               # kommunens midtpunkt i km

rng = random.Random(SEED)
nrng = np.random.default_rng(SEED)


# ---------------------------------------------------------------- geografi
def value_noise(nx, ny, cells):
    g = nrng.random((cells + 1, cells + 1))
    xs = np.linspace(0, cells, nx, endpoint=False)
    ys = np.linspace(0, cells, ny, endpoint=False)
    xi, yi = xs.astype(int), ys.astype(int)
    xf, yf = (xs - xi)[None, :], (ys - yi)[:, None]
    xf, yf = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    a = g[yi][:, xi]; b = g[yi][:, xi + 1]; c = g[yi + 1][:, xi]; d = g[yi + 1][:, xi + 1]
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf


def fractal(nx, ny):
    out = np.zeros((ny, nx))
    for cells, amp in ((3, 0.8), (6, 0.7), (12, 0.5), (24, 0.32), (48, 0.17), (96, 0.08)):
        out += amp * (value_noise(nx, ny, cells) - 0.5)
    return out


def fjord(start, end, w0, w1, amp):
    """Fjord som smalner av innover, med bukter i flere frekvenser."""
    (x0, y0), (x1, y1) = start, end
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy)
    px, py = -dy / L, dx / L
    ph = [rng.random() * 6 for _ in range(3)]
    pts = []
    n = 60
    for i in range(n + 1):
        t = i / n
        off = amp * (math.sin(t * 7.0 + ph[0]) + 0.5 * math.sin(t * 17 + ph[1]) + 0.25 * math.sin(t * 37 + ph[2]))
        pts.append((x0 + dx * t + px * off, y0 + dy * t + py * off, w0 + (w1 - w0) * t ** 0.8))
    segs = [shapely.LineString([pts[i][:2], pts[i + 1][:2]]).buffer((pts[i][2] + pts[i + 1][2]) / 2) for i in range(n)]
    return unary_union(segs), shapely.LineString([q[:2] for q in pts])


def make_geography():
    nx, ny = int(W / RES), int(H / RES)
    xs = (np.arange(nx) + 0.5) * RES
    ys = (np.arange(ny) + 0.5) * RES
    X, Y = np.meshgrid(xs, ys)
    coast = CX - 12 + 9 * np.sin(Y / 23 + 0.7) + 5 * np.sin(Y / 7.5)
    f = (X - coast) / 11 + 2.6 * fractal(nx, ny)
    mask = f > 0
    rows = []
    for j in range(ny):  # rader med sammenhengende land → færre bokser
        i = 0
        while i < nx:
            if mask[j, i]:
                k = i
                while k < nx and mask[j, k]:
                    k += 1
                rows.append(box(xs[i] - RES / 2, ys[j] - RES / 2, xs[k - 1] + RES / 2, ys[j] + RES / 2))
                i = k
            else:
                i += 1
    land = unary_union(rows)
    specs = [((CX - 34, CY + 14), (CX + 20, CY + 10), 1.5, 0.3, 2.4), ((CX - 36, CY - 6), (CX + 6, CY - 1), 1.2, 0.25, 2.0),
             ((CX - 30, CY - 24), (CX - 4, CY - 17), 0.9, 0.2, 1.4), ((CX - 26, CY + 30), (CX + 2, CY + 27), 0.8, 0.2, 1.2)]
    cuts, lines = [], []
    for st, en, w0, w1, amp in specs:
        c, l = fjord(st, en, w0, w1, amp)
        cuts.append(c); lines.append(l)
    land = land.difference(unary_union(cuts))
    # øyer og holmer i havet vest for kysten
    def island(cx, cy, R):
        th = np.linspace(0, 2 * math.pi, 72, endpoint=False)
        ph = [rng.random() * 6 for _ in range(4)]
        r = R * (1 + 0.28 * np.sin(2 * th + ph[0]) + 0.16 * np.sin(3 * th + ph[1]) + 0.09 * np.sin(7 * th + ph[2]) + 0.05 * np.sin(13 * th + ph[3]))
        return shapely.Polygon(np.column_stack([cx + r * np.cos(th) * rng.uniform(1.0, 1.7), cy + r * np.sin(th)]))
    isl = []
    for cx, cy, R in ((CX - 30, CY + 6, 4.2), (CX - 36, CY - 15, 3.4), (CX - 24, CY - 30, 2.6), (CX - 40, CY + 22, 2.2)):
        isl.append(island(cx, cy, R))
    for _ in range(26):
        isl.append(island(CX - rng.uniform(20, 50), CY + rng.uniform(-32, 32), rng.uniform(0.35, 1.1)))
    sea_isl = unary_union(isl).difference(land.buffer(1.2))
    land = unary_union([land, sea_isl])
    land = land.buffer(0.6).buffer(-1.0).buffer(0.4).simplify(0.1)
    land = unary_union([p for p in getattr(land, 'geoms', [land]) if p.area > 0.2])
    # kommunegrense: uregelmessig blob, resten av landet er nabokommuner (kontekst)
    ang = np.linspace(0, 2 * math.pi, 120, endpoint=False)
    rad = 1 + 0.10 * np.sin(3 * ang + 1.1) + 0.06 * np.sin(5 * ang + 0.4) + 0.03 * np.sin(11 * ang)
    blob = shapely.Polygon([(CX - 6 + 46 * r * math.cos(a), CY + 32 * r * math.sin(a)) for a, r in zip(ang, rad)])
    kommune = land.intersection(blob)
    kommune = unary_union([p for p in getattr(kommune, 'geoms', [kommune]) if p.area > 0.3])
    context = land.difference(blob.buffer(0.2))
    context = unary_union([p for p in getattr(context, 'geoms', [context]) if p.area > 0.4])
    return kommune, context, lines


def parts_of(g):
    return list(getattr(g, 'geoms', [g]))


def place_seeds(kommune, fjords):
    # sentrum ved fjordbunnen i hovedfjorden
    head = Point(fjords[0].coords[-1])
    main = max(parts_of(kommune), key=lambda p: p.area)
    sentrum = shapely.ops.nearest_points(main.buffer(-2.2), head)[0]
    seeds = [(sentrum, 'sentrum')]
    for a in (0.3, 2.4, 4.3):
        p = Point(sentrum.x + 4.2 * math.cos(a), sentrum.y + 4.2 * math.sin(a))
        if not kommune.contains(p):
            p = shapely.ops.nearest_points(main.buffer(-0.5), p)[0]
        seeds.append((p, 'tettsted'))
    # én krets per større øy
    others = [p for p in parts_of(kommune) if not p.equals(main)]
    islands = sorted([p for p in others if p.area > 6], key=lambda p: -p.area)
    for isl in islands[:4]:
        seeds.append((isl.representative_point(), 'hytte'))
    # liten øy med svært få eiendommer
    small = [p for p in others if 0.6 < p.area <= 6]
    if small:
        far = max(small, key=lambda p: p.centroid.distance(sentrum))
        seeds.append((far.representative_point(), 'tiny'))
    minx, miny, maxx, maxy = main.bounds
    tries, dmin = 0, 8.5
    while len(seeds) < 26:
        p = Point(rng.uniform(minx, maxx), rng.uniform(miny, maxy))
        tries += 1
        if tries % 4000 == 0:
            dmin *= 0.92
        if not main.buffer(-0.6).contains(p):
            continue
        if min(p.distance(s) for s, _ in seeds) < dmin or p.distance(sentrum) < 9:
            continue
        seeds.append((p, 'spredt'))
    return seeds


# ---------------------------------------------------------------- navn
NAMES_ISLAND = ['Skarvøy', 'Måkeøy', 'Langøya', 'Tjeldøy', 'Kobbøy', 'Lundholmen']
NAMES = ['Kvitnes', 'Storbotn', 'Holmvåg', 'Sølvhamn', 'Tindvik', 'Brattnes', 'Granlia', 'Furuvik', 'Sandbukta',
         'Ospedal', 'Kvalnes', 'Ramvik', 'Skjellbotn', 'Bjørkvika', 'Tjeldnes', 'Rognlia', 'Stokkvik', 'Mjeldvik',
         'Kobbvåg', 'Grunnfjord', 'Straumbu', 'Nesvik', 'Lysvika', 'Havøyvær', 'Elvebakken', 'Moheia', 'Svartlia',
         'Breivoll', 'Sjøgata', 'Kirkenes']  # «Kirkenes» brukes ikke (ekte by) – filtreres bort under
NAMES = [n for n in NAMES if n != 'Kirkenes']
SENTRUM_NAMES = ['Fjordvik sentrum', 'Fjordvik nord', 'Kirkebakken', 'Havnebyen']


def partition(kommune, pts):
    """Deler kommunen i kretser: Voronoi innen hver landdel, øyer uten senter går til nærmeste krets."""
    comps = parts_of(kommune)
    owner = [min(range(len(comps)), key=lambda c: comps[c].distance(p)) for p in pts]
    pieces = [[] for _ in pts]
    for c, comp in enumerate(comps):
        idx = [i for i, o in enumerate(owner) if o == c]
        if not idx:
            near = min(range(len(pts)), key=lambda i: comp.distance(pts[i]))
            pieces[near].append(comp)
        elif len(idx) == 1:
            pieces[idx[0]].append(comp)
        else:
            vor = shapely.voronoi_polygons(MultiPoint([pts[i] for i in idx]), extend_to=box(-50, -50, W + 50, H + 50))
            for i in idx:
                cell = next(v for v in vor.geoms if v.intersects(pts[i]))
                pieces[i].append(cell.intersection(comp))
    out = []
    for i, ps in enumerate(pieces):
        g = unary_union(ps).buffer(0)
        # små løsrevne biter i andre deler av kommunen henger igjen; behold dem (holmer)
        out.append(g)
    return out


def spread_labels(geoms, min_d=4.5, step=0.25):
    """Etikettpunkt per krets (polylabel), skjøvet fra hverandre innenfor egen krets."""
    mains = [max(parts_of(g), key=lambda q: q.area) for g in geoms]
    inner = [m.buffer(-0.35) if not m.buffer(-0.35).is_empty else m for m in mains]
    pts = [shapely.ops.polylabel(m, tolerance=0.05) for m in mains]
    for _ in range(80):
        moved = False
        for a in range(len(pts)):
            for b in range(a + 1, len(pts)):
                d = pts[a].distance(pts[b])
                if d >= min_d:
                    continue
                dx, dy = (pts[a].x - pts[b].x) / (d or 1), (pts[a].y - pts[b].y) / (d or 1)
                for i, sgn in ((a, 1), (b, -1)):
                    q = Point(pts[i].x + sgn * dx * step, pts[i].y + sgn * dy * step)
                    if inner[i].contains(q):
                        pts[i] = q; moved = True
        if not moved:
            break
    return pts


def assign_names(seeds, geoms):
    pool = NAMES[:]
    rng.shuffle(pool)
    isl = NAMES_ISLAND[:]
    out = []
    si = 0
    for (p, typ), g in zip(seeds, geoms):
        if typ in ('sentrum',) or (typ == 'tettsted' and si < 4):
            out.append(SENTRUM_NAMES[si]); si += 1
        elif typ in ('hytte', 'tiny') and isl:
            out.append(isl.pop(0))
        else:
            left = sum(1 for (_, t) in seeds[len(out) + 1:] if t not in ('hytte', 'tiny', 'sentrum', 'tettsted'))
            a = pool.pop()
            out.append(a + '-' + pool.pop() if len(pool) - 1 >= left and rng.random() < 0.45 else a)
    return out


# ---------------------------------------------------------------- skattemodell
def takst_bolig(y):
    if y < 2019:
        return 1 + 0.004 * (y - 2010)
    return 2.05 * (1 + 0.006 * (y - 2019)) * (1.10 if y >= 2023 else 1.0)


def takst_naering(y):
    return 1 + 0.003 * (y - 2010) if y < 2019 else 1.72 * (1 + 0.004 * (y - 2019))


def red_bolig(y):
    return 0.70 if y >= 2020 else 1.0


def prom_bolig(y):
    return 7.0 if y < 2019 else 5.0 if y < 2021 else 4.0


PROM_N = 7.0
TYPE = {  # n0, vekst, boligtakst 2010, næringsandel, næringstakst, areal bolig, arealdekning
    'sentrum':  (340, 0.012, 520e3, 0.08, 2.6e6, 150, 0.74),
    'tettsted': (215, 0.008, 410e3, 0.05, 1.6e6, 140, 0.71),
    'hytte':    (150, 0.014, 280e3, 0.01, 0.9e6, 72, 0.62),
    'spredt':   (112, -0.002, 245e3, 0.02, 0.8e6, 158, 0.66),
    'kraft':    (75, 0.002, 230e3, 0.03, 1.1e6, 150, 0.64),
    'tiny':     (4, 0.0, 300e3, 0.0, 0.0, 80, 0.75),
}


def build_cells(kretser, types):
    cells = []
    kraft_t = 95e6
    kraft = {}
    for y in YEARS:
        kraft[y] = kraft_t
        kraft_t *= rng.gauss(1.025, 0.05)
    events = {}
    for k, typ in zip(kretser, types):
        n0, gr, tb, ns, tn, area, cov = TYPE[typ]
        jit = lambda s: rng.gauss(1, s)  # noqa: E731
        p = {'n0': n0 * jit(0.22) if typ != 'tiny' else n0, 'gr': gr + rng.gauss(0, 0.003), 'tb': tb * jit(0.12),
             'ns': ns, 'tn': tn * jit(0.2), 'area': area * jit(0.08), 'cov': min(0.8, cov * jit(0.05)),
             'e': rng.uniform(0.06, 0.11) if typ != 'tiny' else 0.0}
        events[k['nr']] = p
    for y in YEARS:
        for k, typ in zip(kretser, types):
            p = events[k['nr']]
            n = p['n0'] * (1 + p['gr']) ** (y - 2010) * (0.97 if y >= 2019 else 1.0)
            n = max(1, round(n * rng.gauss(1, 0.006))) if typ != 'tiny' else (4 if y < 2017 else 3)
            ne = round(n * p['e'])
            nn = round((n - ne) * p['ns'])
            nb = n - ne - nn
            tb = p['tb'] * takst_bolig(y)
            t_b = nb * tb * rng.gauss(1, 0.01)
            t_n = nn * p['tn'] * takst_naering(y)
            verk = 0.0
            if typ == 'kraft':
                verk = kraft[y]
            if k.get('industri'):
                verk += 18e6 * takst_naering(y)
            t0 = t_b + t_n + verk
            g0 = t_b * red_bolig(y) + t_n + verk
            s0 = t_b * red_bolig(y) * prom_bolig(y) / 1000 + (t_n + verk) * PROM_N / 1000
            na0 = round((nb + nn) * p['cov'])
            a0 = na0 * p['area'] * (1 + 0.6 * p['ns'])
            sa0 = (s0 - verk * PROM_N / 1000) * na0 / max(1, nb + nn) * rng.uniform(0.94, 1.06)
            cells.append([y, k['nr'], 0, round(s0), n - ne, round(t0, -3), round(g0, -3),
                          round(a0, 1), na0, round(sa0)])
            if ne:
                t1 = ne * tb * 1.1
                g1 = t1 * red_bolig(y)
                s1 = g1 * prom_bolig(y) / 1000 * 0.2
                na1 = round(ne * p['cov'])
                cells.append([y, k['nr'], 1, round(s1), ne, round(t1, -3), round(g1, -3),
                              round(na1 * p['area'], 1), na1, round(s1 * na1 / ne)])
        # uten krets: nett/linjeanlegg og sjøanlegg
        nuk = 12 if y < 2019 else 13
        tuk = 31e6 * takst_naering(y)
        cells.append([y, 'UK', 0, round(tuk * PROM_N / 1000), nuk, round(tuk, -3), round(tuk, -3), 0, 0, 0])
    return cells


# ---------------------------------------------------------------- byggdata
def build_buildings(labels, kretser, types, cells):
    n26 = {c[1]: 0 for c in cells}
    for c in cells:
        if c[0] == 2026:
            n26[c[1]] += c[4]
    tl = labels['bygningstype']
    sl = labels['bygningsstatus']
    base_t = np.array([x[1] for x in tl], float) + 0.4
    base_t /= base_t.sum()

    def boost(label, typ):
        L = label.lower()
        f = 1.0
        if typ == 'hytte' and ('fritid' in L or 'naust' in L or 'camping' in L):
            f = 3.0
        if typ in ('sentrum', 'tettsted') and any(w in L for w in ('enebolig', 'tomannsbolig', 'butikk', 'kontor', 'lager', 'rekkehus', 'skole', 'barnehage', 'verksted')):
            f = 2.2
        if typ in ('sentrum', 'tettsted') and any(w in L for w in ('dyr', 'landbr', 'våningsh', 'skogs')):
            f = 0.3
        if typ == 'spredt' and any(w in L for w in ('dyr', 'landbr', 'våningsh')):
            f = 1.8
        return f
    base_s = np.array([x[1] for x in sl], float) + 0.5
    base_s /= base_s.sum()
    tcounts = [dict() for _ in tl]
    scounts = [dict() for _ in sl]
    keys = [k['nr'] for k in kretser] + ['UK']
    ttypes = types + ['uk']
    for nr, typ in zip(keys, ttypes):
        total = int(round((n26.get(nr, 0) if nr != 'UK' else 30) * rng.uniform(1.75, 2.15)))
        if typ == 'tiny':
            total = 9
        w = base_t * np.array([boost(x[0], typ) for x in tl])
        w /= w.sum()
        ct = nrng.multinomial(total, w)
        ws = base_s * nrng.uniform(0.7, 1.3, len(base_s))
        cs = nrng.multinomial(total, ws / ws.sum())
        for i, v in enumerate(ct):
            tcounts[i][nr] = int(v)
        for i, v in enumerate(cs):
            scounts[i][nr] = int(v)

    def group(sheet, lbls, counts):
        cats = [{'id': str(i), 'label': lbls[i][0], 'counts': counts[i]} for i in range(len(lbls))]
        totals = {nr: sum(c['counts'][nr] for c in cats) for nr in keys}
        return {'sheet': sheet, 'categories': cats, 'totals': totals}
    g1 = group('Bygningstype', tl, tcounts)
    g2 = group('Bygningsstatus', sl, scounts)
    rows = sum(g1['totals'].values())
    assert rows == sum(g2['totals'].values())
    return {'source': 'Byggestatus_demo.xlsx', 'period': 'Tilstand i kildefilen (uten årsserie)',
            'groups': {'bygningstype': g1, 'bygningsstatus': g2},
            'rowCount': rows, 'uniqueBuildingNumbers': int(rows * 0.93)}


# ---------------------------------------------------------------- hovedprogram
def to_lonlat(geom):
    kx = 1 / (111.32 * math.cos(math.radians(LAT0 + H / 2 / 110.57)))
    ky = 1 / 110.57
    return shapely.transform(geom, lambda c: np.column_stack([LON0 + c[:, 0] * kx, LAT0 + c[:, 1] * ky]))


def rounded(gj):
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]
    gj = dict(gj)
    gj['coordinates'] = r(gj['coordinates'])
    return gj


def load_js(path):
    s = open(path, encoding='utf-8').read()
    out = {}
    for name in ('DATA', 'GEO', 'BUILDINGS'):
        m = re.search(r'const ' + name + r'\s*=\s*', s)
        dec = json.JSONDecoder()
        out[name], _ = dec.raw_decode(s[m.end():])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--labels', required=True, help='ekte data.js (bare kategorinavn og navnekontroll brukes)')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    src = load_js(a.labels)
    labels = {}
    for gid, g in src['BUILDINGS']['groups'].items():
        labels[gid] = [(c['label'], sum(c['counts'].values())) for c in g['categories']]
    real_tokens = {w.lower() for k in src['DATA']['kretser'] for w in re.split(r'[-\s]+', k['navn'])}

    kommune, context, fjords = make_geography()
    seeds = place_seeds(kommune, fjords)
    cells_geo = partition(kommune, [p for p, _ in seeds])
    # kraftkrets: krets lengst øst; industri: tettsted nærmest munningen av sørfjorden
    types = [t for _, t in seeds]
    east = max((i for i, t in enumerate(types) if t == 'spredt'), key=lambda i: seeds[i][0].x)
    types[east] = 'kraft'
    names = assign_names([(p, t) for (p, _), t in zip(seeds, types)], cells_geo)
    order = sorted(range(len(seeds)), key=lambda i: (-seeds[i][0].y // 20, seeds[i][0].x))
    kretser, feats, tlist = [], [], []
    labels_km = spread_labels(cells_geo)
    for j, i in enumerate(order):
        nr = KNR + ('01' if j < 13 else '02') + '%02d' % (j % 13 + 1)
        g = to_lonlat(cells_geo[i])
        lab = to_lonlat(labels_km[i])
        k = {'nr': nr, 'navn': names[i], 'lab': [round(lab.x, 5), round(lab.y, 5)]}
        if types[i] == 'tettsted' and not any(x.get('industri') for x in kretser) and names[i] == 'Havnebyen':
            k['industri'] = True
        kretser.append(k)
        tlist.append(types[i])
        feats.append({'type': 'Feature', 'id': int(nr), 'properties': {'nr': nr, 'navn': names[i]},
                      'geometry': rounded(mapping(g.simplify(0.0012)))})
    cells = build_cells(kretser, tlist)
    for k in kretser:
        k.pop('industri', None)
    buildings = build_buildings(labels, kretser, tlist, cells)
    ctx = to_lonlat(context).simplify(0.0015)
    land_all = to_lonlat(unary_union([kommune, context]))
    minx, miny, maxx, maxy = to_lonlat(kommune).bounds
    data = {
        'client': {'name': 'Fjordvik kommune', 'short': 'Fjordvik', 'knr': KNR, 'demo': True},
        'years': YEARS, 'kretser': kretser, 'cells': cells, 'minCount': 5,
        'rows': sum(c[4] for c in cells), 'fritakUnknownYears': [], 'fritakNoneCodedYears': [],
        'source': 'Eiendomsskatteliste_demo.xlsx',
        'bounds': [[round(minx - 0.05, 3), round(miny - 0.02, 3)], [round(maxx + 0.05, 3), round(maxy + 0.02, 3)]],
        'events': [{'year': 2019, 'label': 'Ny taksering 2019'}, {'year': 2023, 'label': 'Kontorjustering +10 %'}],
        'rules': {'reduksjonsfaktorFra': 2020, 'promilleBolig': {str(y): prom_bolig(y) for y in YEARS}, 'promilleNaering': PROM_N},
        'context': {'type': 'Feature', 'properties': {}, 'geometry': rounded(mapping(ctx))},
        'landArea': round(land_all.area, 6),
    }
    geo = {'type': 'FeatureCollection', 'features': feats}
    js = ('/* Fiktive demodata (Fjordvik kommune). Aggregater år × krets × fritak og syntetisk kart. */\n'
          'const DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
          'const GEO = ' + json.dumps(geo, ensure_ascii=False, separators=(',', ':')) + ';\n'
          'const BUILDINGS = ' + json.dumps(buildings, ensure_ascii=False, separators=(',', ':')) + ';\n')
    ours = {w.lower() for k in kretser for w in re.split(r'[-\s]+', k['navn'])}
    bad = sorted(ours & real_tokens) + [w for w in ('steigen', 'nordland', 'salten', 'openfreemap') if w in js.lower()]
    if bad:
        sys.exit('ekte navn i resultatet: ' + ', '.join(bad))
    open(a.out, 'w', encoding='utf-8').write(js)
    tot = {}
    for c in cells:
        t = tot.setdefault(c[0], [0, 0])
        t[0] += c[3]; t[1] += c[4]
    print('kretser', len(kretser), 'bytes', len(js.encode()))
    print(' '.join(f"{y}:{v[1]}/{v[0]/1e6:.1f}M" for y, v in tot.items()))
    print([k['navn'] for k in kretser])
    print(sorted(set(tlist)), {t: tlist.count(t) for t in set(tlist)})


if __name__ == '__main__':
    main()
