#!/usr/bin/env python3
"""Bygg selvstendig HTML og oppdater innholdssikkerhetspolicy."""
from pathlib import Path
import base64,hashlib,mimetypes,re,argparse
ROOT=Path(__file__).resolve().parents[1]
def data_uri(path):
 p=path.resolve()
 if not p.is_relative_to(ROOT):raise ValueError('Ressurs utenfor prosjektet')
 mime=mimetypes.guess_type(p.name)[0] or 'application/octet-stream'
 return 'data:'+mime+';base64,'+base64.b64encode(p.read_bytes()).decode()
def policy(html):
 html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>\n?','',html)
 hashes=[]
 for s in re.findall(r'<script(?:\s[^>]*)?>([\s\S]*?)</script>',html):
  if s.strip():hashes.append("'sha256-"+base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()+"'")
 csp="default-src 'none'; script-src 'self' "+' '.join(hashes)+"; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https://tiles.openfreemap.org; object-src 'none'; base-uri 'none'; form-action 'none'"
 return html.replace('<meta charset="utf-8">','<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="'+csp+'">')
def build(out):
 original=policy((ROOT/'index.html').read_text());(ROOT/'index.html').write_text(original)
 def css_link(m):
  p=ROOT/m[1];css=p.read_text()
  css=re.sub(r'url\([\"\']?([^\)\"\']+)[\"\']?\)',lambda x:'url("'+(x[1] if x[1].startswith(('data:','#')) else data_uri(p.parent/x[1]))+'")',css)
  return '<style>\n'+css.replace('</style','<\\/style')+'\n</style>'
 html=re.sub(r'<link rel="stylesheet" href="([^"]+)">',css_link,original)
 def script(m):
  s=(ROOT/m[1]).read_text();s=re.sub(r'//# sourceMappingURL=.*','',s)
  return '<script>\n'+re.sub('</script',r'<\\/script',s,flags=re.I)+'\n</script>'
 html=re.sub(r'<script src="([^"]+)"></script>',script,html)
 html=re.sub(r'\b(src|poster|href)="(assets/[^"]+)"',lambda m:m[1]+'="'+data_uri(ROOT/m[2])+'"',html)
 html=policy(html);out.parent.mkdir(parents=True,exist_ok=True);out.write_text(html)
 print('Selvstendig HTML:',out.name,'('+str(out.stat().st_size)+' byte)')
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',type=Path,default=ROOT.parent/'Steigen.html');a=p.parse_args();build(a.out)
