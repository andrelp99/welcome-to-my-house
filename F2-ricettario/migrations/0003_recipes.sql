-- F2: ricettario, sostituti, eventi (cucinato/consumo/buttato), foto.
-- Stesse regole di sync delle altre tabelle: id UUID, updated_at, deleted, rev.

CREATE TABLE recipes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  servings REAL NOT NULL DEFAULT 1,
  prep_min INTEGER,
  cook_min INTEGER,
  rest_min INTEGER,
  difficulty TEXT,
  tags TEXT,
  diet_tags TEXT,
  photo_key TEXT,
  source_url TEXT,
  notes TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  cooked_count INTEGER NOT NULL DEFAULT 0,
  last_cooked_at TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_recipes_rev ON recipes(rev);

CREATE TABLE recipe_ingredients (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  product_id TEXT,
  text TEXT NOT NULL,
  qty REAL,
  unit TEXT,
  optional INTEGER NOT NULL DEFAULT 0,
  grp TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_recipe_ingredients_rev ON recipe_ingredients(rev);
CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);

CREATE TABLE recipe_steps (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  text TEXT NOT NULL,
  timer_min REAL,
  photo_key TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_recipe_steps_rev ON recipe_steps(rev);
CREATE INDEX idx_recipe_steps_recipe ON recipe_steps(recipe_id);

-- 1 prodotto = ratio x sostituto (es. 1 burro = 0.8 olio)
CREATE TABLE substitutions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  substitute_id TEXT NOT NULL,
  ratio REAL NOT NULL DEFAULT 1,
  note TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_substitutions_rev ON substitutions(rev);

-- Consumi, sprechi, piatti cucinati (base per F5)
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  product_id TEXT,
  recipe_id TEXT,
  qty REAL,
  unit TEXT,
  value REAL,
  date TEXT NOT NULL,
  note TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_events_rev ON events(rev);

-- Foto (ricette, passaggi; in F3 scontrini). Immutabili, non passano dal sync: GET/PUT /api/files/:id
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

-- Categoria per gli avanzi di "Ho cucinato"
INSERT INTO categories (id, name, area, default_stock, sort, updated_at, rev) VALUES
 ('cat-avanzi', 'Avanzi e piatti pronti', 'cibo', 0, 18, 1, (SELECT v + 1 FROM sync_meta WHERE k = 'rev'));

-- Sostituti comuni (modificabili)
INSERT INTO substitutions (id, product_id, substitute_id, ratio, note, updated_at, rev) VALUES
 ('sub-burro-olio',   'p-burro',               'p-olio-extravergine',   0.8, NULL, 1, (SELECT v + 1 FROM sync_meta WHERE k = 'rev')),
 ('sub-parm-grana',   'p-parmigiano-reggiano', 'p-grana-padano',        1,   NULL, 1, (SELECT v + 1 FROM sync_meta WHERE k = 'rev')),
 ('sub-grana-parm',   'p-grana-padano',        'p-parmigiano-reggiano', 1,   NULL, 1, (SELECT v + 1 FROM sync_meta WHERE k = 'rev')),
 ('sub-latte-uht',    'p-latte',               'p-latte-uht',           1,   NULL, 1, (SELECT v + 1 FROM sync_meta WHERE k = 'rev')),
 ('sub-uht-latte',    'p-latte-uht',           'p-latte',               1,   NULL, 1, (SELECT v + 1 FROM sync_meta WHERE k = 'rev')),
 ('sub-crudo-speck',  'p-prosciutto-crudo',    'p-speck',               1,   NULL, 1, (SELECT v + 1 FROM sync_meta WHERE k = 'rev')),
 ('sub-panna-latte',  'p-panna-da-cucina',     'p-latte',               1,   'con una noce di burro', 1, (SELECT v + 1 FROM sync_meta WHERE k = 'rev')),
 ('sub-spag-penne',   'p-spaghetti',           'p-penne',               1,   NULL, 1, (SELECT v + 1 FROM sync_meta WHERE k = 'rev')),
 ('sub-penne-fusilli','p-penne',               'p-fusilli',             1,   NULL, 1, (SELECT v + 1 FROM sync_meta WHERE k = 'rev'));

UPDATE sync_meta SET v = v + 1 WHERE k = 'rev';
