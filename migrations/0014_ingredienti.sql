-- 0.16: ingredienti "sempre in casa" (verdi, mai scalati, mai in lista) e "sempre non necessari" (superflui in ogni ricetta)
ALTER TABLE products ADD COLUMN always_have INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN always_optional INTEGER NOT NULL DEFAULT 0;
