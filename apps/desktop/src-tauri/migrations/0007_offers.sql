-- A named, togglable promotional rule. No soft-delete -- retiring an offer
-- means switching active off (see Product's active-toggle precedent; unlike
-- Product this table has no unused deleted_at column, since no delete path
-- ever exists for offers).
CREATE TABLE offers (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  active                 INTEGER NOT NULL DEFAULT 1,
  applies_to_all_categories INTEGER NOT NULL DEFAULT 0,
  category_ids           TEXT,
  days                   TEXT,
  start_time             TEXT,
  end_time               TEXT,
  start_date             TEXT,
  end_date               TEXT,
  min_duration_minutes   INTEGER,
  min_game_count         INTEGER,
  effect_type            TEXT NOT NULL CHECK (effect_type IN ('extraTime', 'percentOff', 'flatOff')),
  effect_value           INTEGER NOT NULL,
  updated_at             TEXT NOT NULL,
  created_by             TEXT,
  updated_by             TEXT
);
