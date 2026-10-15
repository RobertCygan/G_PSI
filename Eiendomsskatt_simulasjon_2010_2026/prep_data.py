"""Data preparation for the Steigen eiendomsskatt dashboard.
Reads Basisdata.xlsm (table Data) + grunnkrets GeoJSON, writes compact aggregates.
No property-level rows, Gnr/Bnr/Fnr/Snr or personal data leave this script.
"""
import json, pandas as pd, numpy as np
from shapely.geometry import shape, mapping
from shapely.algorithms.polylabel import polylabel

UP = '/root/.claude/uploads/c2235b76-c2ac-5118-a8f9-421b4c31f347/'
S = '/tmp/claude-0/-home-claude/c2235b76-c2ac-5118-a8f9-421b4c31f347/scratchpad/'

df = pd.read_pickle(S + 'data.pkl')
df['Fritak'] = df['Fritak'].str.strip()
# Fritak class: 0 = Ingen (skattepliktig), 1 = §-fritak, 2 = ikke oppgitt i kilden
def fclass(v):
    if v == 'Ingen': return 0
    if v == 'Ikke oppgitt i kilden': return 2
    return 1
df['F'] = df['Fritak'].map(fclass)
df['Areal'] = pd.to_numeric(df['Areal'], errors='coerce').fillna(0)
df['hasA'] = (df['Areal'] > 0).astype(int)
df['skattA'] = df['Skatt (NOK)'] * df['hasA']
df['arealA'] = df['Areal'] * df['hasA']
df['K'] = df['Krets_nr'].where(df['Krets_nr'] != 'Uten krets', 'UK')

g = df.groupby(['År', 'K', 'F']).agg(
    skatt=('Skatt (NOK)', 'sum'), n=('Skatt (NOK)', 'size'),
    takst=('Takst (NOK)', 'sum'), grunnlag=('Grunnlag (NOK)', 'sum'),
    areal=('arealA', 'sum'), nAreal=('hasA', 'sum'), skattAreal=('skattA', 'sum')
).reset_index()

cells = [[int(r.År), r.K, int(r.F), int(r.skatt), int(r.n), int(r.takst), int(r.grunnlag),
          round(float(r.areal), 1), int(r.nAreal), int(r.skattAreal)] for r in g.itertuples()]

years = sorted(int(y) for y in df['År'].unique())

# Kretser: names from Basisdata sheet + GeoJSON
geo = json.load(open(UP + 'feee874c-Steigen_skatt_wgs84.geojson'))
kretser = []
feats = []
for f in sorted(geo['features'], key=lambda f: f['properties']['grunnkretsnummer']):
    p = f['properties']
    poly = shape(f['geometry'])
    simp = poly.simplify(0.00005, preserve_topology=True)
    lab = polylabel(simp, tolerance=0.0005)
    nr, navn = p['grunnkretsnummer'], p['grunnkretsnavn']
    kretser.append({'nr': nr, 'navn': navn, 'lab': [round(lab.x, 5), round(lab.y, 5)]})
    geom = mapping(simp)
    def rnd(c):
        return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]
    geom = {'type': geom['type'], 'coordinates': rnd([list(r) for r in geom['coordinates']])}
    feats.append({'type': 'Feature', 'id': int(nr), 'properties': {'nr': nr, 'navn': navn}, 'geometry': geom})
geo_out = {'type': 'FeatureCollection', 'features': feats}

# Sanity: all krets codes in data are in GeoJSON
codes_geo = {k['nr'] for k in kretser}
codes_data = set(df['K'].unique()) - {'UK'}
assert codes_data == codes_geo, (codes_data ^ codes_geo)

# Reconciliation
src = df.groupby('År')['Skatt (NOK)'].sum()
agg = pd.DataFrame(cells, columns=['y','k','f','s','n','t','g','a','na','sa']).groupby('y')['s'].sum()
recon = {int(y): {'kilde': int(src[y]), 'aggregat': int(agg[y]), 'ok': bool(src[y] == agg[y])} for y in years}
print('Reconciliation:', all(v['ok'] for v in recon.values()))
for y in (2019, 2026):
    print(y, recon[y])
print('rows:', len(df), 'cells:', len(cells))
uk = df[df['K']=='UK'].groupby('År').agg(n=('Skatt (NOK)','size'), s=('Skatt (NOK)','sum'))
print('Uten krets 2026:', uk.loc[2026].to_dict())
print('Fritak-class rows per year:'); print(df.groupby(['År','F']).size().unstack(fill_value=0))
print('Duplicate (Gnr/Bnr/Fnr/Snr/År) rows:', int(df.duplicated(['Gnr','Bnr','Fnr','Snr','År']).sum()))
print('Areal>0 share:', round(float(df['hasA'].mean()), 3))

meta = {
    'years': years,
    'kretser': kretser,
    'cells': cells,
    'minCount': 5,
    'rows': int(len(df)),
    'fritakUnknownYears': sorted(int(y) for y in df[df['F']==2]['År'].unique()),
    'fritakNoneCodedYears': sorted(int(y) for y in years if (df[(df['År']==y)]['F']==1).sum()==0 and y not in set(df[df['F']==2]['År'])),
}
json.dump(meta, open(S + 'agg.json', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(geo_out, open(S + 'geo.json', 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump(recon, open(S + 'recon.json', 'w'))
import os
print('agg.json', os.path.getsize(S+'agg.json'), 'geo.json', os.path.getsize(S+'geo.json'))
print('fritakUnknownYears', meta['fritakUnknownYears'], 'fritakNoneCodedYears', meta['fritakNoneCodedYears'])
