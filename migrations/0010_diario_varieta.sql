-- 0.12: diario pasti (piatti a mano, avanzi, proposte automatiche), pasti (luogo, costo), gradimento/frequenza ricette,
-- impostazioni sincronizzate (obiettivi varieta', pesi proposte), acquisti "da lista".
ALTER TABLE meal_plan ADD COLUMN dish_course TEXT;
ALTER TABLE meal_plan ADD COLUMN dish_main TEXT;
ALTER TABLE meal_plan ADD COLUMN dish_second TEXT;
ALTER TABLE meal_plan ADD COLUMN dish_features TEXT;
ALTER TABLE meal_plan ADD COLUMN dish_ings TEXT;
ALTER TABLE meal_plan ADD COLUMN leftover_of TEXT;
ALTER TABLE meal_plan ADD COLUMN used_expiring INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meal_plan ADD COLUMN auto INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meal_plan ADD COLUMN done_at TEXT;

ALTER TABLE recipes ADD COLUMN rating INTEGER;
ALTER TABLE recipes ADD COLUMN want_freq INTEGER;

ALTER TABLE purchase_lines ADD COLUMN from_list INTEGER;

-- Un pasto (data + pasto): luogo e costo. id = "ml-AAAA-MM-GG-pasto" (uguale su tutti i dispositivi).
CREATE TABLE meals (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  meal TEXT NOT NULL,
  place TEXT NOT NULL DEFAULT 'casa',
  cost REAL,
  expense_id TEXT,
  note TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_meals_rev ON meals(rev);
CREATE INDEX idx_meals_date ON meals(date);

-- Impostazioni condivise tra dispositivi (JSON in value): goals, weights, planner.
CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_settings_rev ON settings(rev);
