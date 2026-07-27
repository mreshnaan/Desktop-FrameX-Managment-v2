-- Nullable timestamp for when a session's payment was actually settled.
-- Purely additive (no rebuild needed, unlike 0005 -- adding a nullable
-- column needs no constraint change). No code sets this automatically and
-- no UI exposes it yet -- it exists so a later feature can use it without
-- another migration.
ALTER TABLE sessions ADD COLUMN paid_at TEXT;
