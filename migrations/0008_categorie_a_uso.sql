-- Categorie "a utilizzo" (salse, spezie...): i prodotti si contano in usi/porzioni.
ALTER TABLE categories ADD COLUMN by_use INTEGER NOT NULL DEFAULT 0;
