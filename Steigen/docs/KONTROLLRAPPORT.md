# Kontrollrapport · 15. oktober 2026

## Funksjon og visning

Kontrollert i Chromium på 1600 × 1000 og 390 × 844 piksler via lokal HTTP:

- Alle ni menypunkter åpner riktig side. De to opprinnelige analysemodulene og kalkulatoren deler ramme, tema og bunntekst.
- Begge leveranser, mappe og selvstendig HTML, fungerer med eksterne nettverksforespørsler blokkert. Ingen eksterne forespørsler ble gjort under kjernebruken.
- Eiendomskartet tegnes med WebGL, viser 25 tabellrader inkludert «Uten krets» og fungerer med årvalg, kretsvalg, byggkategorier og nullstilling.
- Kalkulatorens 144 kombinasjoner ga samme beregningsobjekt som den leverte originalen: bolig/fritid, alder, standard, soner, gårdsbruk, etasjer og fritak for små tilleggsbygg.
- En håndkontrollert bolig på 100 m², tomt på 1 000 m², første sone og nyeste aldersgruppe ga 2 940 kr per år med de leverte parameterne.
- Nullstilling, hjelpetekster etter nullstilling, ugyldige tall, tastaturvalg av krets, personverndialog, lyst/mørkt tema og mobilvisning ble kontrollert.
- Ingen uventet horisontal siderulling på mobil. Brede tabeller ruller i sin egen beholder.
- Introduksjonsvideoen ble avspilt; Escape hopper over introduksjonen. Redusert bevegelse hopper over automatisk. Det ble ikke registrert JavaScript- eller CSP-feil.

Direkte `file://`-navigasjon er blokkert av administrasjonspolicyen i kontrollmiljøets Chromium. Dobbeltklikkstart kunne derfor ikke verifiseres der. Enkeltfilens ressurser er innebygd og krever ingen tilhørende filer. Andre nettlesermotorer er ikke testet.

## Data og SQL

- SQL-eksporten ble gjenopprettet i en ny tom SQLite-database.
- `PRAGMA integrity_check` ga `ok`, og `PRAGMA foreign_key_check` returnerte ingen feil.
- Databaseeksporten ga nøyaktig samme regnskaps-, skatte-, bygg- og parameterverdier som de leverte datasettene.
- Regnskapsdatabasen inneholder 46 683 fakturalinjer. Ufiltrert totalsum er 436 721 031,99 kr. Skjermens standardvisning utelater mva og er derfor lavere.
- Skattedatabasen inneholder 775 aggregater. Bygningsregisteret beskriver 6 900 registreringer, 78 typer og 13 statuser.
- 13 perioder med måned 00 er bevart og dokumentert.

## Sikkerhetskontroll

- GET-endepunktene for status, årsutgifter og eiendomsskatt returnerte forventede data.
- Database, SQL-eksport, serverkode og eksportverktøy var utilgjengelige gjennom webserveren.
- Stitraversering, gjentatte parametere, SQL-lignende input, ukjente parametere, fremmede Host/Origin-verdier og POST ble avvist.
- Skriptsyntaks og Python-kode ble kontrollert. Enkeltfilen ble kontrollert for lokale ressursreferanser, unike element-ID-er og riktige CSP-hasher.

Dette er kontroll av leveransen, ikke en uavhengig penetrasjonstest eller godkjenning for offentlig drift. Produksjonskrav og datagrunnlagets avgrensninger er beskrevet i de øvrige dokumentene.
