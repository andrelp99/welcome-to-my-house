-- F4: planner settimanale (sincronizzato) + notifiche push (solo server).

CREATE TABLE meal_plan (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  meal TEXT NOT NULL DEFAULT 'cena',
  recipe_id TEXT,
  servings REAL NOT NULL DEFAULT 1,
  note TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_meal_plan_rev ON meal_plan(rev);
CREATE INDEX idx_meal_plan_date ON meal_plan(date);

-- Un record per dispositivo iscritto alle notifiche. Non passa dal sync.
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device TEXT,
  prefs TEXT,
  created_at INTEGER NOT NULL,
  last_ok INTEGER,
  fails INTEGER NOT NULL DEFAULT 0
);

-- Stato interno del server: chiavi VAPID generate al primo uso, ultimo invio per tipo.
CREATE TABLE server_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
