-- Årlige utgifter i løpende kroner (inkluderer alle lagrede fakturalinjer).
SELECT * FROM v_utgifter_per_aar ORDER BY aar;
-- Topp ti leverandører i 2025.
SELECT navn, sum_belop_kr FROM v_utgifter_per_leverandoer WHERE aar=2025 ORDER BY sum_belop_kr DESC LIMIT 10;
-- Skatt per grunnkrets, valgt år.
SELECT * FROM v_skatt_per_grunnkrets WHERE aar=2026 ORDER BY sum_skatt_kr DESC;
-- Registrerte bygg per type, ikke antall unike bygg.
SELECT k.navn,SUM(a.antall) AS registreringer FROM byggkategori k JOIN byggantall a ON a.gruppe=k.gruppe AND a.kategori_id=k.id WHERE k.gruppe='bygningstype' GROUP BY k.gruppe,k.id,k.navn ORDER BY registreringer DESC;
-- Kontroller manglende måned (00 beholdes fra kilden).
SELECT periode,COUNT(*) FROM transaksjon WHERE periode%100=0 GROUP BY periode;
-- Parametere er JSON; verifisert=0 betyr at årets vedtak ikke er bekreftet.
SELECT json_extract(parametere,'$.skattesatsPromille') AS promille,verifisert,merknad FROM beregningsregel;
