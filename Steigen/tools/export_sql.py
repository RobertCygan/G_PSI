#!/usr/bin/env python3
"""Lag en komplett, gjenopprettbar SQL-eksport av SQLite-databasen."""
from pathlib import Path
import sqlite3,argparse
ROOT=Path(__file__).resolve().parents[1]
def export(db,out):
 c=sqlite3.connect(db.resolve().as_uri()+'?mode=ro',uri=True)
 try:
  if c.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or c.execute('PRAGMA foreign_key_check').fetchall():raise ValueError('Ugyldig database')
  # SQLite iterdump sorts tables alphabetically. Suspend references during
  # restoration, then re-enable and check after every table has been loaded.
  with out.open('w',encoding='utf-8') as f:
   f.write('PRAGMA foreign_keys=OFF;\n');f.write('\n'.join(c.iterdump()));f.write('\nPRAGMA foreign_keys=ON;\nPRAGMA foreign_key_check;\n')
 finally:c.close()
 print('SQL-eksport oppdatert:',out.name)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--database',type=Path,default=ROOT/'database/steigen.sqlite3');p.add_argument('--out',type=Path,default=ROOT/'database/steigen.sql');a=p.parse_args();export(a.database,a.out)
