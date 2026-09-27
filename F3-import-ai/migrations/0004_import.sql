-- F3: memoria scontrino -> prodotto (la volta dopo la riga viene riconosciuta da sola) + foto scontrino.

CREATE TABLE receipt_aliases (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  product_id TEXT NOT NULL,
  store_chain TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_receipt_aliases_rev ON receipt_aliases(rev);
