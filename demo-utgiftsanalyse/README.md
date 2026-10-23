# Utgiftsanalyse – demo (Fjordvik kommune, fiktive data)

Interaktivt dashboard utviklet av **G-PSI GovTech Solutions**, her med et fullt anonymisert demodatasett.
«Fjordvik kommune» finnes ikke. Leverandørnavn, fakturalinjer, bilagsnummer, folketall og kommunens egne
KOSTRA-tall er syntetiske. KPI og sammenligningsseriene (KOSTRA-gruppe 6, fylket, landet uten Oslo) er SSB-tall.

## Åpne
Dobbeltklikk `index.html` (fungerer lokalt uten internett), eller send den selvstendige filen
`../Demo_utgiftsanalyse.html`. Introvideoen spilles først; trykk «Hopp over», Esc eller Enter for å gå rett til dashboardet.
Legg til `#nointro` i adressen for å hoppe over introen, eller `#kostra`, `#kategorier` osv. for å åpne en bestemt side.

## Struktur
```
index.html                Sideoppsett, intro og sider
css/style.css             Design (mørkt/lyst tema, G-PSI-farger)
js/app.js                 Beregninger, filtre, grafer, tabeller
js/data.js                Demodatasett (window.GPSI_DATA)
js/vendor/echarts.min.js  Apache ECharts 5.5.1
assets/fonts/             Rajdhani og Inter (woff2)
assets/img/               G-PSI-logoer
assets/video/             intro.mp4 (+ intro.webm som reserve)
```

## Kommune-mal
Kommunenavn, kildefil og kommune-ID leses fra `D.client` og `D.meta` i `js/data.js`. Banneret om datagrunnlaget,
nøkkelfunn, hendelser og markeringene i utviklingsgrafen beregnes fra dataene. Kommunevåpenet ligger som inline SVG
i `index.html` (`#clientLogo`). Med `client.demo = false` forsvinner DEMO-merket og demomerknadene.

## Lage demodataene på nytt
```
python tools/lag_demodata.py --src <kundemappe>/js/data.js --out demo-utgiftsanalyse/js/data.js
python tools/bygg_enkeltfil.py demo-utgiftsanalyse Demo_utgiftsanalyse.html
```
Kjøres fra rotmappen i repoet; `<kundemappe>` er dashboardet med ekte kundedata (ligger ikke i demomappen). Skriptet stopper hvis et ekte stedsnavn eller kildenavn finnes i resultatet.

## Sider
- **Oversikt** – nøkkeltall, nøkkelfunn, tjenesteområder (drift/investering), artsfordeling, vare-/tjenestegrupper, utvikling.
- **Kategorier** – første/siste år, nominell og reell endring, CAGR, andel, varmekart og bidrag til endring.
- **Leverandører** – topp 15, konsentrasjon (Pareto), bransjer, søkbart register.
- **KOSTRA** – brutto/netto driftsutgifter, art, per innbygger mot KOSTRA-gruppe 6, fylket og landet uten Oslo, investeringer.
- **Transaksjoner** – søk, sortering og CSV-eksport av fakturalinjene.
- **Datakvalitet** – dekningsgrad, bilagsserier, hendelser, metode og kilder.
