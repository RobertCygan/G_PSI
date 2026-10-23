# Eiendomsskatt per grunnkrets – demo (Fjordvik kommune, fiktive data)

3D-kart over eiendomsskatt per grunnkrets 2010–2026, utviklet av **G-PSI GovTech Solutions**.
«Fjordvik kommune» finnes ikke: kystlinje, øyer, grunnkretser, navn, skattetall og byggdata er syntetiske.
Tallene følger likevel reglene i perioden, så utviklingen henger sammen:

- alminnelig taksering 2009 (gjelder 2010–2018) og ny taksering 2019 (stort hopp)
- reduksjonsfaktor 30 % for bolig og fritid fra 2020
- promille bolig/fritid 7 ‰ → 5 ‰ (2019–2020) → 4 ‰ (fra 2021); næring og verk 7 ‰
- kontorjustering +10 % for boliger i 2023, kraftverkstakst som varierer år for år

## Åpne
Dobbeltklikk `index.html`, eller bruk den selvstendige filen `../Demo_eiendomsskatt.html` (alt i én fil).
Siden gjør **ingen eksterne forespørsler**: MapLibre GL 4.7.1, Chart.js 4.4.1 og skriftene (Manrope, IBM Plex)
ligger lokalt, og kartbakgrunnen (hav og nabokommuner) er innebygd. Nettleseren må støtte WebGL for kartet;
tabell og graf fungerer uten.

## Legge på egen nettside
Last opp mappen (eller `Demo_eiendomsskatt.html`) til nettstedet og bygg den inn med en iframe:

```html
<iframe src="/demo/eiendomsskatt/index.html"
        title="Eiendomsskatt per grunnkrets – demo"
        style="width:100%;height:860px;border:0;border-radius:12px"
        loading="lazy" allow="fullscreen"></iframe>
```

Siden fyller hele iframen. På smale skjermer legges kartet over panelet, og siden ruller.
Bruk minst 700 px høyde på store skjermer.

## Struktur
```
index.html            Sideoppsett
style.css             Design og lokale @font-face
app.js                Kart, filtre, graf, tabell
data.js               DATA (skatt + kart), GEO (grunnkretser), BUILDINGS (byggdata)
vendor/               MapLibre GL og Chart.js med lisenser
assets/               Kommunevåpen (SVG) og skrifter (SIL OFL 1.1)
```

## Lage dataene på nytt
Fra rotmappen i repoet:
```
python tools/lag_demo_eiendomsskatt.py --labels <kundemappe>/data.js --out demo-eiendomsskatt/data.js
python tools/bygg_enkeltfil.py demo-eiendomsskatt Demo_eiendomsskatt.html
```
Fra kundedataene brukes bare kategorinavnene for bygningstype og -status (nasjonale kodelister). Skriptet
stopper hvis et ekte grunnkretsnavn havner i resultatet. Krever Python med `shapely` og `numpy`.
