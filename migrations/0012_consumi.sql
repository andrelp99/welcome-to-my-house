-- 0.14: scarico ingredienti per pasto + storico consumi.
-- events: a quale pasto (piatto del planner) e a quale lotto si riferisce un consumo (per rimetterlo in dispensa).
ALTER TABLE events ADD COLUMN plan_id TEXT;
ALTER TABLE events ADD COLUMN lot_id TEXT;
CREATE INDEX IF NOT EXISTS idx_events_plan ON events(plan_id);
-- lotti: costo unitario (avanzi = costo della porzione cucinata) e piatto che li ha creati
ALTER TABLE stock_lots ADD COLUMN unit_cost REAL;
ALTER TABLE stock_lots ADD COLUMN plan_id TEXT;
-- piatti: porzioni cucinate (le mangiate restano in servings) e dispensa gia' scalata
ALTER TABLE meal_plan ADD COLUMN cooked REAL;
ALTER TABLE meal_plan ADD COLUMN scaled INTEGER NOT NULL DEFAULT 0;
