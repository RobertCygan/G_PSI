# Steigen · G-PSI Analytics

En samlet analyseportal på norsk bokmål. Den grafiske rammen bygger på `steigen-utgiftsanalyse`. Kalkulatoren og eiendomsanalysen er integrert i samme dokument, meny og tema.

## Start

- Åpne `index.html` for mappestrukturen. Behold undermappene sammen med filen.
- Åpne den separate `Steigen.html` for en selvstendig versjon med innebygde skrifter, bilder, video, biblioteker og data.
- Tillegg `#nointro` hopper over introduksjonen. En direkte lenke kan være `#kalkulator`, `#eiendomsskatt` eller `#database`.
- For lokal HTTP og SQL-API: kjør `python server/serve.py`, og åpne `http://127.0.0.1:8080`.

Python 3.10 eller nyere er nødvendig bare for server og vedlikeholdsverktøy. Selve nettsiden trenger ingen installasjon. Kartet bruker WebGL; tabell og grafer er fortsatt tilgjengelige dersom nettleseren mangler WebGL. Nettleseren må støtte moderne JavaScript.

## Innhold

`index.html` – felles struktur, ni menypunkter, introduksjon og bunntekst.  
`css/` – opprinnelig design og avgrensede stiler for de integrerte modulene.  
`js/` – analysefunksjoner og databaseeksporter; `vendor/` inneholder lokale biblioteker.  
`assets/` – lokale fonter, opprinnelige logoer og bearbeidet introduksjonsvideo.  
`database/steigen.sqlite3` – ferdig SQL-database med data.  
`database/schema.sql` – tabeller, relasjoner, indekser og rapportvisninger.  
`database/steigen.sql` – komplett SQL-eksport som gjenskaper databasen.  
`database/examples.sql` – eksempler på rapportspørringer.  
`tools/export_data.py` – oppdaterer nettsidens datasett fra SQL.  
`tools/build_single.py` – bygger en ny selvstendig HTML-fil og oppdaterer CSP.  
`server/serve.py` – lokal server med et begrenset, lesebasert API.  
`docs/` – databasebeskrivelse, sikkerhet, video og kontrollresultater.

## SQL og oppdatering

Åpne `database/steigen.sqlite3` med SQLite, DB Browser for SQLite eller et annet SQL-verktøy. Beløp i transaksjons- og skattetabellene lagres som heltall i øre. Rapportvisningene viser kroner. Aktiver `PRAGMA foreign_keys=ON` ved hver skriveforbindelse. Ta sikkerhetskopi før endringer.

Etter endringer i SQL:

```sh
python tools/export_data.py
python tools/export_sql.py
python tools/build_single.py --out ../Steigen.html
```

Eksporten gjenskaper de eksisterende datastrukturene fra SQL-tabellene. Vanlige dataendringer i navn, beløp, kretsdata, byggantall og beregningsparametere følger dermed med. Det opprinnelige analyseverktøyet har perioden 2016–2025 som fast avgrensning; en utvidelse av perioden krever en kodeendring. Behold sammenhengende nullbaserte ID-er i dimensjonstabellene; eksportverktøyet kontrollerer dette.

Gjenskap en database fra SQL med SQLite CLI:

```sh
sqlite3 ny-steigen.sqlite3 < database/steigen.sql
```

Eller med standardbiblioteket i Python:

```python
import sqlite3
from pathlib import Path
with sqlite3.connect('ny-steigen.sqlite3') as db:
    db.executescript(Path('database/steigen.sql').read_text(encoding='utf-8'))
```

## Beregningsgrunnlag

Kalkulatoren beholder de leverte reglene: taksering 2019, revidert 17.02.2020, med de leverte parameterne for 2026. Sats 4 ‰ og bunnfradrag 0 kr er ikke kontrollert mot et nytt kommunestyrevedtak. Dette er derfor et veiledende overslag. Feltet `beregningsregel.verifisert` er satt til 0. Ingen årsserie er konstruert for byggdata.

## Lokal behandling og kart

Alle biblioteker og kjernefunksjoner er lokale. Portalen har ingen sporing eller ekstern skriftlasting. Bare temavalget lagres lokalt. Kalkulatoropplysninger sendes ikke til API-et. Eksternt bakgrunnskart er valgfritt og lastes først etter et aktivt valg; nettleseren kontakter da OpenFreeMap. Kommunens geometri er innebygd og fungerer uten bakgrunnstjenesten.

## Publisering

Dette er en lokal leveranse. Den medfølgende serveren lytter bare på `127.0.0.1` og er beregnet for lokal bruk. For en offentlig bedriftsside: publiser bare `index.html`, `css/`, `js/` og `assets/` fra en egen offentlig katalog. Hold `database/`, `tools/`, `server/` og sikkerhetskopier utenfor denne katalogen. Se `docs/SIKKERHET.md` for krav til produksjonsintegrasjon. Selskapets kontakt- og organisasjonsopplysninger er ikke oppdiktet; disse kan legges til når de foreligger.
