-- Welcome to My House — schema iniziale (F0/F1)
-- Ogni tabella sincronizzabile ha: id TEXT (UUID), updated_at (ms epoch), deleted (0/1).

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL CHECK (area IN ('cibo','casa')),
  icon TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  expiry_warn_days INTEGER NOT NULL DEFAULT 7,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL CHECK (area IN ('cibo','casa')),
  icon TEXT,
  default_stock REAL NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  chain TEXT NOT NULL,
  branch TEXT,
  city TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  area TEXT NOT NULL CHECK (area IN ('cibo','casa')),
  category_id TEXT REFERENCES categories(id),
  default_unit TEXT NOT NULL DEFAULT 'pz',
  default_location_id TEXT REFERENCES locations(id),
  favorite INTEGER NOT NULL DEFAULT 0,
  essential INTEGER NOT NULL DEFAULT 0,
  min_stock REAL,
  open_shelf_days INTEGER,
  freezer_max_months INTEGER,
  diet_tags TEXT,
  alternatives TEXT,
  notes TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_products_name ON products(name);

CREATE TABLE receipts (
  id TEXT PRIMARY KEY,
  store_id TEXT REFERENCES stores(id),
  date TEXT NOT NULL,
  total_paid REAL,
  total_discount REAL,
  photo_key TEXT,
  notes TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE purchase_lines (
  id TEXT PRIMARY KEY,
  receipt_id TEXT REFERENCES receipts(id),
  product_id TEXT REFERENCES products(id),
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'pz',
  price_paid REAL,
  price_full REAL,
  discount REAL,
  offer_type TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE stock_lots (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pz',
  location_id TEXT REFERENCES locations(id),
  expiry_date TEXT,
  opened_at TEXT,
  frozen_at TEXT,
  purchase_line_id TEXT REFERENCES purchase_lines(id),
  is_leftover INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_lots_product ON stock_lots(product_id);
CREATE INDEX idx_lots_expiry ON stock_lots(expiry_date);

CREATE TABLE shopping_items (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id),
  free_text TEXT,
  qty REAL,
  unit TEXT,
  origin TEXT NOT NULL DEFAULT 'manuale',
  checked INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE extra_expenses (
  id TEXT PRIMARY KEY,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  area TEXT NOT NULL CHECK (area IN ('cibo','casa','altro')),
  category TEXT,
  note TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE budgets (
  id TEXT PRIMARY KEY,
  month TEXT NOT NULL,
  area TEXT NOT NULL CHECK (area IN ('cibo','casa')),
  amount REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE change_log (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  device TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX idx_change_log_at ON change_log(at);

-- ── Dati iniziali ──────────────────────────────────────────────
INSERT INTO locations (id, name, area, icon, sort, expiry_warn_days, updated_at) VALUES
 ('loc-frigo',     'Frigo',              'cibo', 'refrigerator', 1, 3,  0),
 ('loc-freezer',   'Freezer',            'cibo', 'snowflake',    2, 14, 0),
 ('loc-dispensa',  'Dispensa cibo',      'cibo', 'archive',      3, 7,  0),
 ('loc-bagno',     'Dispensa bagno',     'casa', 'bath',         4, 7,  0),
 ('loc-soggiorno', 'Dispensa soggiorno', 'casa', 'sofa',         5, 7,  0),
 ('loc-farmacia',  'Farmacia',           'casa', 'pill',         6, 30, 0),
 ('loc-altro',     'Altro',              'casa', 'box',          7, 7,  0);

INSERT INTO categories (id, name, area, default_stock, sort, updated_at) VALUES
 ('cat-pasta',      'Pasta e riso',             'cibo', 3, 1,  0),
 ('cat-pane',       'Pane, cereali e farine',   'cibo', 1, 2,  0),
 ('cat-latte',      'Latte e latticini',        'cibo', 1, 3,  0),
 ('cat-formaggi',   'Formaggi',                 'cibo', 1, 4,  0),
 ('cat-carne',      'Carne',                    'cibo', 0, 5,  0),
 ('cat-pesce',      'Pesce',                    'cibo', 0, 6,  0),
 ('cat-salumi',     'Salumi',                   'cibo', 0, 7,  0),
 ('cat-uova',       'Uova',                     'cibo', 1, 8,  0),
 ('cat-frutta',     'Frutta',                   'cibo', 0, 9,  0),
 ('cat-verdura',    'Verdura',                  'cibo', 0, 10, 0),
 ('cat-surgelati',  'Surgelati',                'cibo', 1, 11, 0),
 ('cat-conserve',   'Conserve, sughi e legumi', 'cibo', 2, 12, 0),
 ('cat-condimenti', 'Olio, aceto e condimenti', 'cibo', 1, 13, 0),
 ('cat-spezie',     'Sale e spezie',            'cibo', 1, 14, 0),
 ('cat-colazione',  'Colazione, dolci e snack', 'cibo', 1, 15, 0),
 ('cat-caffe',      'Caffè e tè',               'cibo', 1, 16, 0),
 ('cat-bevande',    'Bevande e acqua',          'cibo', 6, 17, 0),
 ('cat-pulizia',    'Pulizia casa',             'casa', 1, 20, 0),
 ('cat-lavanderia', 'Lavanderia',               'casa', 1, 21, 0),
 ('cat-igiene',     'Bagno e igiene personale', 'casa', 1, 22, 0),
 ('cat-carta',      'Carta (igienica, cucina, fazzoletti)', 'casa', 4, 23, 0),
 ('cat-cucina',     'Cucina non-cibo',          'casa', 1, 24, 0),
 ('cat-spazzatura', 'Spazzatura e sacchi',      'casa', 1, 25, 0),
 ('cat-manutenz',   'Manutenzione (lampadine, pile, filtri)', 'casa', 1, 26, 0),
 ('cat-farmacia',   'Farmacia e primo soccorso', 'casa', 1, 27, 0),
 ('cat-cancelleria','Cancelleria',              'casa', 0, 28, 0),
 ('cat-piante',     'Piante',                   'casa', 0, 29, 0);

INSERT INTO stores (id, chain, updated_at) VALUES
 ('store-tigros',    'Tigros',    0),
 ('store-iperal',    'Iperal',    0),
 ('store-esselunga', 'Esselunga', 0);
