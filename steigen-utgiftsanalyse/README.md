# Utgiftsanalyse – Steigen kommune 2016–2025

Interaktivt dashboard utviklet av **G-PSI GovTech Solutions**.

## Åpne
Dobbeltklikk `index.html` (fungerer lokalt uten internett). Introvideoen spilles først; trykk «Hopp over», Esc eller Enter for å gå rett til dashboardet.
Legg til `#nointro` i adressen for å hoppe over introen (f.eks. `index.html#nointro`), eller `#kostra`, `#kategorier` osv. for å åpne en bestemt side.

## Struktur
```
index.html              Sideoppsett, intro og sider
css/style.css           Design (mørkt/lyst tema, G-PSI-farger)
js/app.js               Beregninger, filtre, grafer, tabeller
js/data.js              Datagrunnlag (generert fra Ready2.xlsm + SSB)
js/vendor/echarts.min.js  Apache ECharts 5.5.1
assets/fonts/           Rajdhani og Inter (woff2)
assets/img/             G-PSI- og Steigen-logoer
assets/video/           intro.mp4 (+ intro.webm som reserve)
tools/oppdater_data.py  Regenererer js/data.js fra Ready2.xlsm + SSB-API
```

## Oppdatere data
```
pip install pandas openpyxl
python tools/oppdater_data.py --xlsm Ready2.xlsm --out js/data.js
```
Skriptet henter KOSTRA, KPI og folkemengde direkte fra data.ssb.no.

## Sider
- **Oversikt** – nøkkeltall, tjenesteområder (drift/investering), artsfordeling, vare-/tjenestegrupper, utvikling.
- **Kategorier** – første/siste år, nominell og reell endring, CAGR, andel, varmekart og bidrag til endring (KOSTRA eller fakturagrunnlag).
- **Leverandører** – topp 15, konsentrasjon (Pareto), bransjer, søkbart register.
- **KOSTRA** – brutto/netto driftsutgifter, art, per innbygger mot KOSTRA-gruppe 6, Nordland og landet uten Oslo, investeringer.
- **Transaksjoner** – søk, sortering og CSV-eksport av fakturalinjene.
- **Datakvalitet** – dekningsgrad, bilagsserier, hendelser og brudd, metode og kilder.

## Kilder
Ready2.xlsm (fakturagrunnlag) · SSB 12362 og 12367 (KOSTRA) · SSB 03014 (KPI) · SSB 07459 (folkemengde) · SSB Klass 112 (KOSTRA-grupper).
