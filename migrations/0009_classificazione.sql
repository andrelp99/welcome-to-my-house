-- Classificazione ricette: alimento principale e secondario ("Gruppo" o "Gruppo|sotto"), caratteristiche (id separati da virgola).
ALTER TABLE recipes ADD COLUMN main_food TEXT;
ALTER TABLE recipes ADD COLUMN second_food TEXT;
ALTER TABLE recipes ADD COLUMN features TEXT;
