"""Build the distributable single-file dashboard from the adjacent source files."""
from pathlib import Path
import base64

root = Path(__file__).resolve().parent
html = (root / 'index.html').read_text(encoding='utf-8')
logo = base64.b64encode((root / 'steigen-logo.png').read_bytes()).decode('ascii')
html = html.replace('src="steigen-logo.png"', 'src="data:image/png;base64,' + logo + '"')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + (root / 'style.css').read_text(encoding='utf-8') + '\n</style>')
for name in ['data.js', 'app.js']:
    html = html.replace(f'<script src="{name}"></script>', '<script>\n' + (root / name).read_text(encoding='utf-8').replace('</script', '<\\/script') + '\n</script>')
(root / 'eiendomsskatt-steigen.html').write_text(html, encoding='utf-8')
