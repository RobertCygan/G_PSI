# SQL-datamodell

Databasen bruker SQLite 3, fremmednøkler, kontrollbetingelser, indekser og visninger. Den åpnes direkte i SQL-verktøy, uten nettsiden. Pengebeløp lagres i øre for eksakt summering. Statistikkserier bevarer SSB-enhetene i de leverte datasettene: blant annet tusen kroner og kroner per innbygger.

| Tabell | Innhold |
|---|---|
| datakilde | Navn, dokumentert opprinnelse, dato og SHA-256 av importert datagrunnlag |
| datasett | Metadata og strukturen rundt de numeriske statistikkseriene |
| sektor, tjenesteomraade, funksjon | Kommunale tjenestedimensjoner |
| artsgruppe, konto, varegruppe | Regnskapsdimensjoner |
| mottakergruppe, bransje, leverandoer | Mottakere og leverandørregister |
| transaksjon | 46 683 leverte utgiftslinjer, beløp, periode og bilag |
| grunnkrets | Kretsnummer, navn, etikettposisjon og GeoJSON-geometri |
| eiendomsskatt | 775 aggregater etter år, krets og fritakklasse |
| byggkategori, byggantall | 78 bygningstyper og 13 bygningsstatuser; registrert tilstand |
| statistikkserie | KOSTRA, KPI og befolkning med år og serieidentitet |
| beregningsregel | Kalkulatorens JSON-parametere og verifikasjonsstatus |

`v_utgifter_per_aar`, `v_utgifter_per_leverandoer`, `v_skatt_per_aar` og `v_skatt_per_grunnkrets` er rapportvisninger. De summerer de lagrede dataene; regnskapsvisningene bruker alle fakturalinjer uten interaktive skjermfiltre, inkludert mva. Se eksempelspørringer i `database/examples.sql`.

Fritakklasse 0 = ingen registrert fritakskode, 1 = §-fritak, 2 = ikke oppgitt i kilden. År uten koder må ikke tolkes som dokumentert fravær av fritak. Krets `UK` betyr «Uten krets».

13 fakturalinjer har måned 00 i kilden. Verdiene bevares i SQL. Det opprinnelige dashboardet behandler disse som januar ved måned- og kvartalsvisning. Årssummene påvirkes ikke.

Kildenes historiske antall i metadata er importinformasjon. Hvis grunnlaget erstattes, oppdateres også metadata, kildebeskrivelse og kontrollsummer som del av importen. `datakilde.sha256` er kontrollsum av det importerte datagrunnlaget, ikke av den løpende databasefilen.

Byggantall er registreringer. De to kategorigruppene beskriver de samme 6 900 registreringene og skal ikke summeres sammen til 13 800 bygg. Kilden oppgir 6 418 unike bygningsnumre; unike bygg kan ikke beregnes på nytt fra de leverte aggregatene.

## API

Start `python server/serve.py`. Alle endepunkter bruker GET og returnerer JSON:

| Endepunkt | Resultat |
|---|---|
| `/api/status` | Skjemaversjon og antall poster |
| `/api/utgifter` | Årssummer |
| `/api/utgifter?aar=2025` | Årssum for valgt år |
| `/api/eiendomsskatt?aar=2026` | Skatt per grunnkrets |
| `/api/eiendomsskatt?aar=2026&grunnkrets=18480208` | Valgt krets og år |

API-et har faste spørringer med bundne parametere og åpner databasen skrivebeskyttet. Det finnes ikke et HTTP-endepunkt for vilkårlig SQL eller endringer. Integrasjon mot PostgreSQL eller SQL Server krever en eksplisitt migrasjon, tilpassede datatyper og en autentisert servertjeneste. Det leveres ingen ekstern databaseforbindelse eller konto.
