"""Refresh building counts from the two supplied summary sheets.

Usage: python prep_buildings.py /path/to/Byggestatus.xlsm
Requires openpyxl. Only aggregate counts are embedded in data.js.
Run build_single.py afterwards to refresh the single-file HTML.
"""
import argparse
import json
import re
from pathlib import Path
from collections import Counter
import openpyxl


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('workbook', type=Path)
    parser.add_argument('--data', type=Path, default=Path(__file__).with_name('data.js'))
    args = parser.parse_args()
    text = args.data.read_text(encoding='utf-8')
    data = json.loads(re.search(r'const DATA = (.*);', text).group(1))
    krets = {k['navn']: k['nr'] for k in data['kretser']}
    workbook = openpyxl.load_workbook(args.workbook, read_only=True, data_only=True)
    buildings = {'source': args.workbook.name, 'period': 'Tilstand i kildefilen (uten årsserie)', 'groups': {}}
    for key, name in [('bygningstype', 'Byggningstype'), ('bygningsstatus', 'Byggningsstatus')]:
        sheet = next(s for s in workbook if s.title.strip() == name)
        rows = iter(sheet.values)
        headers = list(next(rows))
        assert set(krets) <= set(headers), 'Missing grunnkrets columns'
        unknown = set(headers[1:]) - set(krets)
        assert unknown <= {'Andre', 'INGEN'}, f'Unknown area names: {unknown}'
        categories, totals = [], Counter()
        for row in rows:
            if not row[0]:
                continue
            counts = Counter({nr: 0 for nr in [*krets.values(), 'UK']})
            for area, value in zip(headers[1:], row[1:]):
                value = value or 0
                assert isinstance(value, (int, float)) and value >= 0 and int(value) == value
                counts[krets.get(area, 'UK')] += int(value)
            categories.append({'id': str(len(categories)), 'label': str(row[0]), 'counts': dict(counts)})
            totals.update(counts)
        buildings['groups'][key] = {'sheet': sheet.title, 'categories': categories, 'totals': dict(totals)}
    groups = buildings['groups']
    assert groups['bygningstype']['totals'] == groups['bygningsstatus']['totals']
    # Reconcile summaries with the source row counts by area. The workbook can
    # contain multiple entries for one building number; do not call these unique buildings.
    source_counts = Counter()
    ids = set()
    for row in workbook['Status'].iter_rows(min_row=3, max_col=12, values_only=True):
        if row[1] is not None:
            source_counts[krets.get(str(row[11]).strip(), 'UK')] += 1
            ids.add(row[1])
    assert source_counts == Counter(groups['bygningstype']['totals'])
    buildings['rowCount'] = sum(source_counts.values())
    buildings['uniqueBuildingNumbers'] = len(ids)
    payload = '\n/* Building-register snapshot: aggregate counts from Byggestatus.xlsm. */\nconst BUILDINGS = ' + json.dumps(buildings, ensure_ascii=False, separators=(',', ':')) + ';\n'
    text = text.split('\n/* Building-register snapshot:')[0].rstrip() + '\n'
    args.data.write_text(text + payload, encoding='utf-8')
    print(json.dumps({'rows': buildings['rowCount'], 'uniqueBuildingNumbers': len(ids), 'outsideMap': source_counts['UK'], 'categories': {k: len(v['categories']) for k, v in groups.items()}}, ensure_ascii=False))


if __name__ == '__main__':
    main()
