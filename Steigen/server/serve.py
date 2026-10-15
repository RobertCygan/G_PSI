#!/usr/bin/env python3
"""Lokal HTTP-server med et begrenset, lesebasert API. Kun Python-standardbibliotek."""
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, unquote
import argparse, json, sqlite3, mimetypes
from contextlib import closing
ROOT=Path(__file__).resolve().parents[1]
MAX_STATIC=40*1024*1024
class Handler(BaseHTTPRequestHandler):
 protocol_version='HTTP/1.0'
 def log_message(self,*args):pass
 def respond(self,status,body,mime='application/json; charset=utf-8',head=False):
  self.send_response(status);self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)));self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');self.send_header('X-Frame-Options','DENY');self.send_header('Permissions-Policy','camera=(), microphone=(), geolocation=()');self.send_header('Cache-Control','no-store' if mime.startswith('application/json') else 'no-cache')
  self.send_header('Content-Security-Policy',"frame-ancestors 'none'")
  self.end_headers()
  if not head:self.wfile.write(body)
 def error_json(self,status,message,head=False):self.respond(status,json.dumps({'feil':message},ensure_ascii=False).encode(),head=head)
 def do_HEAD(self):self.serve(True)
 def do_GET(self):self.serve(False)
 def do_POST(self):self.error_json(405,'Bare lesing er tillatt.')
 do_PUT=do_POST;do_DELETE=do_POST;do_PATCH=do_POST
 def serve(self,head):
  if len(self.path)>4096:return self.error_json(414,'Forespørselen er for lang.',head)
  # Reject foreign Host headers to protect the local service against DNS rebinding.
  host=self.headers.get('Host','')
  if host not in {f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}:return self.error_json(403,'Ugyldig vert.',head)
  origin=self.headers.get('Origin')
  if origin and origin not in {f'http://127.0.0.1:{self.server.server_port}',f'http://localhost:{self.server.server_port}'}:return self.error_json(403,'Ugyldig opprinnelse.',head)
  url=urlsplit(self.path);path=unquote(url.path)
  if path.startswith('/api/'):return self.api(path,url.query,head)
  path='index.html' if path=='/' else path.lstrip('/')
  # Explicit public directories; never serve SQL, databases, scripts, docs or dotfiles.
  parts=Path(path).parts
  if path!='index.html' and (not parts or parts[0] not in {'css','js','assets'}):return self.error_json(404,'Filen finnes ikke.',head)
  if any(p.startswith('.') or p=='..' for p in parts):return self.error_json(404,'Filen finnes ikke.',head)
  target=(ROOT/path).resolve()
  if not target.is_relative_to(ROOT) or not target.is_file() or target.stat().st_size>MAX_STATIC:return self.error_json(404,'Filen finnes ikke.',head)
  mime=mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
  if mime.startswith('text/') or mime in ['application/javascript']:mime+='; charset=utf-8'
  return self.respond(200,target.read_bytes(),mime,head)
 def api(self,path,query,head):
  routes={'/api/status':set(),'/api/utgifter':{'aar'},'/api/eiendomsskatt':{'aar','grunnkrets'}}
  if path not in routes:return self.error_json(404,'Ukjent endepunkt.',head)
  try:
   params=parse_qs(query,strict_parsing=True) if query else {}
   if set(params)-routes[path] or any(len(v)!=1 for v in params.values()):raise ValueError()
   year=None
   if 'aar' in params:
    value=params['aar'][0]
    if len(value)!=4 or not value.isascii() or not value.isdigit():raise ValueError()
    year=int(value)
    if not 1900<=year<=2200:raise ValueError()
   district=params.get('grunnkrets',[None])[0]
   if district is not None and district!='UK' and (len(district)!=8 or not district.isascii() or not district.isdigit()):raise ValueError()
  except ValueError:return self.error_json(400,'Ugyldige parametere.',head)
  try:
   with closing(sqlite3.connect(self.server.database.resolve().as_uri()+'?mode=ro',uri=True)) as db:
    db.row_factory=sqlite3.Row
    if path=='/api/status':
     result={'skjemaversjon':db.execute('SELECT max(versjon) FROM skjemaversjon').fetchone()[0],'transaksjoner':db.execute('SELECT count(*) FROM transaksjon').fetchone()[0],'skatteaggregater':db.execute('SELECT count(*) FROM eiendomsskatt').fetchone()[0]}
    elif path=='/api/utgifter':result=[dict(r) for r in db.execute('SELECT * FROM v_utgifter_per_aar WHERE (? IS NULL OR aar=?) ORDER BY aar',(year,year))]
    else:
     if district and not db.execute('SELECT 1 FROM grunnkrets WHERE nummer=?',(district,)).fetchone():return self.error_json(400,'Ukjent grunnkrets.',head)
     result=[dict(r) for r in db.execute('SELECT * FROM v_skatt_per_grunnkrets WHERE (? IS NULL OR aar=?) AND (? IS NULL OR nummer=?) ORDER BY aar,nummer',(year,year,district,district))]
    return self.respond(200,json.dumps(result,ensure_ascii=False,allow_nan=False).encode(),head=head)
  except sqlite3.Error:return self.error_json(503,'Databasen er midlertidig utilgjengelig.',head)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--port',type=int,default=8080);p.add_argument('--database',type=Path,default=ROOT/'database/steigen.sqlite3');a=p.parse_args()
 if not a.database.is_file():p.error('Databasefilen finnes ikke.')
 server=ThreadingHTTPServer(('127.0.0.1',a.port),Handler);server.database=a.database;server.daemon_threads=True
 print('Steigen kjører på http://127.0.0.1:'+str(a.port),flush=True)
 try:server.serve_forever()
 except KeyboardInterrupt:pass
 finally:server.server_close()
