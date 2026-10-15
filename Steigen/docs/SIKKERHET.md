# Sikkerhet og produksjon

Portalen er utformet for lokal bruk uten eksterne skript eller databehandling. Den har ingen innebygde hemmeligheter, påloggingsopplysninger, analyseverktøy eller skriveendepunkter.

- Content Security Policy begrenser skript til lokale ressurser og SHA-256-godkjente skript i enkeltfilen. `eval` er ikke tillatt. Inline stiler er nødvendige for de eksisterende grafbibliotekene. Bilder, fonter og video kan være innebygd. Blob-workers er nødvendige for det lokale kartbiblioteket.
- Tekst fra søk og datagrunnlag escapes før HTML-presentasjon. Tallfelt validerer format og avviser negative eller ikke-endelige arealer. CSV-eksport beskytter tekstfelt mot regnearkformler.
- Modulenes CSS og hendelser er avgrenset slik at kalkulatoren ikke endrer kartets kontroller eller skjuler andre sider.
- Den lokale serveren har en offentlig fil-allowliste og sperrer database, SQL, verktøy, serverkode, punktfiler, stitraversering og lenker utenfor prosjektet. Databasen åpnes med `mode=ro`.
- API-parametere valideres og bindes til faste SQL-spørringer. Serveren godtar bare lokale Host/Origin-verdier, sender ikke CORS-tillatelser og tillater ingen endringer via HTTP.
- Serveren sender `nosniff`, `no-referrer`, `X-Frame-Options: DENY`, `frame-ancestors 'none'` og avslag på kamera, mikrofon og posisjon.

Før offentlig drift må en ansvarlig eier avklare hvilke regnskapslinjer og leverandørdata som skal publiseres. Data innebygd i statisk HTML og JavaScript er tilgjengelige for alle som mottar filene. Privatpersoner er anonymisert slik de er i det leverte grunnlaget; det er ikke gjennomført en ny personvernrevisjon av alle leverandørnavn.

Bruk HTTPS, en separat offentlig rotkatalog og driftet webserver. Hold database og sikkerhetskopier privat, med begrensede filrettigheter. Eventuell administrasjon krever autentisering, rollebasert tilgang, CSRF-beskyttelse ved informasjonskapsler, revisjonslogg, trafikkbegrensning og sikkerhetskopier med testet gjenoppretting. Disse funksjonene skal ligge på serveren; hemmeligheter skal aldri lagres i nettleserkoden.

Den medfølgende Python-serveren er en lokal utviklingstjeneste. Den er ikke en ferdig internettjeneste med flerbrukertilgang. Ved egne endringer, kjør eksport, bygg enkeltfilen på nytt for oppdaterte skripthasher, og kontroller aktuelle bibliotekversjoner og sikkerhetsoppdateringer før publisering.
