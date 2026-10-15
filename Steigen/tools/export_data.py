#!/usr/bin/env python3
"""Eksporter nettsidens datasett fra SQLite. Ingen eksterne avhengigheter."""
from pathlib import Path
import argparse, json, sqlite3, collections, tempfile, os
ROOT=Path(__file__).resolve().parents[1]
def loads(s):return json.loads(s)
def js(value):return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
def read_data(path):
 c=sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True);c.row_factory=sqlite3.Row
 try:
  if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or c.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Databasen besto ikke integritetskontrollen.')
  get=lambda name:loads(c.execute('SELECT metadata FROM datasett WHERE navn=?',(name,)).fetchone()[0])
  D=get('regnskap');P=get('eiendom');B=get('bygg')
  for key,table in [('sektor','sektor'),('to','tjenesteomraade'),('ag','artsgruppe')]:
   D[key]=[]
   for r in c.execute('SELECT * FROM '+table+' ORDER BY id'):
    o=loads(r['egenskaper']);o['n']=r['navn']
    if key=='to':o['s']=r['sektor_id']
    D[key].append(o)
  for key,table in [('vtg','varegruppe'),('mg','mottakergruppe'),('bransje','bransje')]:D[key]=[r['navn'] for r in c.execute('SELECT * FROM '+table+' ORDER BY id')]
  D['lev']=[{'n':r['navn'],'b':r['bransje_id']} for r in c.execute('SELECT * FROM leverandoer ORDER BY id')]
  D['konto']=[dict(zip(['k','n','art','inv','ag','v'],tuple(r)[1:])) for r in c.execute('SELECT * FROM konto ORDER BY id')]
  D['func']=[dict(zip(['f','n','to','mg'],tuple(r)[1:])) for r in c.execute('SELECT * FROM funksjon ORDER BY id')]
  # Array indices in the retained analytical engine are zero-based database IDs.
  for table in ['sektor','tjenesteomraade','artsgruppe','varegruppe','mottakergruppe','bransje','leverandoer','konto','funksjon']:
   ids=[r[0] for r in c.execute('SELECT id FROM '+table+' ORDER BY id')]
   if ids!=list(range(len(ids))):raise ValueError('ID-serien må være sammenhengende fra 0 i '+table)
  D['tx']={k:[] for k in ['p','k','f','l','a','s','b']}
  for r in c.execute('SELECT periode,konto_id,funksjon_id,leverandoer_id,belop_oere,serie,bilag FROM transaksjon ORDER BY id'):
   for i,k in enumerate(D['tx']):D['tx'][k].append(r[i]/100 if k=='a' else r[i])
  years=list(map(int,D['kostra_meta']['years']))
  for r in c.execute('SELECT * FROM statistikkserie ORDER BY datasett,sti,aar'):
   ds=r['datasett'];year=r['aar'];value=r['verdi']
   if ds=='kpi':D['kpi']['idx'][str(year)]=value;continue
   if ds.startswith('pop_'):D['pop'][ds[4:]][str(year)]=value;continue
   target=D[ds];path=loads(r['sti'])
   for k in path:target=target[k]
   target[years.index(year)]=value
  rows=c.execute('SELECT * FROM grunnkrets WHERE nummer<>? ORDER BY nummer',('UK',)).fetchall()
  P['kretser']=[{'nr':r['nummer'],'navn':r['navn'],'lab':[r['lengdegrad'],r['breddegrad']]} for r in rows]
  G={'type':'FeatureCollection','features':[]}
  for r in rows:
   f=loads(r['geometri']);f['properties']['navn']=r['navn'];G['features'].append(f)
  P['cells']=[[r['aar'],r['grunnkrets_nr'],r['fritakklasse'],r['skatt_oere']/100,r['antall'],r['takst_oere']/100,r['grunnlag_oere']/100,r['areal_m2'],r['antall_med_areal'],r['skatt_med_areal_oere']/100] for r in c.execute('SELECT * FROM eiendomsskatt ORDER BY aar,grunnkrets_nr,fritakklasse')]
  for group,data in B['groups'].items():
   data['categories']=[];totals=collections.Counter()
   for r in c.execute('SELECT * FROM byggkategori WHERE gruppe=? ORDER BY sortering',(group,)):
    counts={r2['grunnkrets_nr']:r2['antall'] for r2 in c.execute('SELECT * FROM byggantall WHERE gruppe=? AND kategori_id=? ORDER BY grunnkrets_nr',(group,r['id']))}
    totals.update(counts);data['categories'].append({'id':r['id'],'label':r['navn'],'counts':counts})
   data['totals']=dict(totals)
  C=loads(c.execute('SELECT parametere FROM beregningsregel WHERE id=1').fetchone()[0])
  if not 0<=C['skattesatsPromille']<=7 or C['bunnfradrag']<0 or not 0<=C['reduksjonsfaktor']<=1:raise ValueError('Ugyldige beregningsparametere.')
  return D,P,G,B,C
 finally:c.close()
def export(db,out):
 D,P,G,B,C=read_data(db);out.mkdir(parents=True,exist_ok=True)
 files={'data.js':'window.STEIGEN_DATA='+js(D)+';\n','property-data.js':'const DATA='+js(P)+';\nconst GEO='+js(G)+';\nconst BUILDINGS='+js(B)+';\n','calculator-config.js':'window.STEIGEN_CALCULATOR_CONFIG='+js(C)+';\n'}
 for name,content in files.items():
  fd,temp=tempfile.mkstemp(dir=out,prefix='.eksport-',suffix='.tmp')
  try:
   with os.fdopen(fd,'w',encoding='utf-8') as f:f.write(content)
   os.replace(temp,out/name)
  finally:
   if os.path.exists(temp):os.unlink(temp)
 print('Eksportert regnskap, eiendom, bygg og beregningsparametere fra SQLite.')
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--database',type=Path,default=ROOT/'database/steigen.sqlite3');p.add_argument('--out',type=Path,default=ROOT/'js');a=p.parse_args();export(a.database,a.out)
