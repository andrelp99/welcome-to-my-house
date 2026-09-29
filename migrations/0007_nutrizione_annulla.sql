-- Valori nutrizionali per porzione (JSON) e cronologia raggruppata per operazione (annulla da qualsiasi dispositivo).
ALTER TABLE recipes ADD COLUMN nutrition TEXT;
ALTER TABLE change_log ADD COLUMN op_id TEXT;
ALTER TABLE change_log ADD COLUMN label TEXT;
ALTER TABLE change_log ADD COLUMN undone INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_change_log_op ON change_log(op_id);
