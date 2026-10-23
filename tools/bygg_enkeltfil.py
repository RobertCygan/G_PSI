#!/usr/bin/env python3
"""
Bygger én selvstendig HTML-fil av et dashboard-katalog (CSS, skrifter, bilder,
video og skript legges inn som data-URI/inline), slik at filen kan sendes og
åpnes uten de andre mappene.

    python tools/bygg_enkeltfil.py demo-utgiftsanalyse Demo_utgiftsanalyse.html
"""
import base64
import mimetypes
import re
import sys
from pathlib import Path

MIME = {'.woff2': 'font/woff2', '.png': 'image/png', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml'}


def data_uri(path):
    mime = MIME.get(path.suffix) or mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    return 'data:' + mime + ';base64,' + base64.b64encode(path.read_bytes()).decode('ascii')


def main():
    root, out = Path(sys.argv[1]), Path(sys.argv[2])
    html = (root / 'index.html').read_text(encoding='utf-8')

    def css_block(m):
        css_path = root / m.group(1)
        css = css_path.read_text(encoding='utf-8')
        css = re.sub(r'url\("([^"]+)"\)', lambda u: 'url("' + data_uri((css_path.parent / u.group(1)).resolve()) + '")', css)
        return '<style>\n' + css + '\n</style>'
    html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css_block, html)

    html = re.sub(r'(src|href)="(assets/[^"]+)"', lambda m: m.group(1) + '="' + data_uri(root / m.group(2)) + '"', html)
    no_scripts = re.sub(r'<script src="[^"]+"></script>', '', html)
    left = re.findall(r'(?:src|href)="(?!data:|https?:|#)([^"]+)"', no_scripts)
    if left:
        sys.exit('ikke innebygd: ' + ', '.join(left))

    def script(m):
        js = (root / m.group(1)).read_text(encoding='utf-8').replace('</script', '<\\/script')
        return '<script>\n' + js + '\n</script>'
    html = re.sub(r'<script src="([^"]+)"></script>', script, html)
    out.write_text(html, encoding='utf-8')
    print(out, round(out.stat().st_size / 1e6, 1), 'MB')


if __name__ == '__main__':
    main()
