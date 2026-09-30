-- 0.13: "Preferite" = ricette con 5 stelle. Le vecchie preferite senza voto diventano ★5.
UPDATE recipes
SET rating = 5,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000,
    rev = (SELECT v + 1 FROM sync_meta WHERE k = 'rev')
WHERE favorite = 1 AND rating IS NULL AND deleted = 0;

UPDATE sync_meta SET v = v + 1 WHERE k = 'rev';
