-- Durate per luogo (dispensa / frigo; freezer = freezer_max_months gia' esistente), usi per confezione, portata ricetta.
-- Vuoto = il prodotto non ci va (se almeno una durata e' impostata). Nessun dato toccato.
ALTER TABLE products ADD COLUMN pantry_days INTEGER;
ALTER TABLE products ADD COLUMN fridge_days INTEGER;
ALTER TABLE products ADD COLUMN uses_per_pack REAL;
ALTER TABLE recipes ADD COLUMN course TEXT;
