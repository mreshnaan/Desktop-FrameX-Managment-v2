-- method becomes nullable -- a session starts with no payment method chosen
-- (shown as "Select payment" in the UI) instead of defaulting to Cash.
-- SQLite has no ALTER COLUMN, so relaxing the NOT NULL CHECK requires
-- rebuilding the table.
CREATE TABLE sessions_new (
  id           TEXT PRIMARY KEY,
  station_id   TEXT NOT NULL REFERENCES stations(id),
  date         TEXT NOT NULL,
  start        TEXT NOT NULL DEFAULT '',
  "end"        TEXT NOT NULL DEFAULT '',
  amount       INTEGER NOT NULL DEFAULT 0,
  method       TEXT CHECK (method IS NULL OR method IN ('Cash', 'Card', 'Credit')),
  customer_id  TEXT REFERENCES customers(id),
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT,
  created_by   TEXT,
  updated_by   TEXT,
  metadata     TEXT
);

INSERT INTO sessions_new (id, station_id, date, start, "end", amount, method, customer_id, updated_at, deleted_at, created_by, updated_by, metadata)
SELECT id, station_id, date, start, "end", amount, method, customer_id, updated_at, deleted_at, created_by, updated_by, metadata
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_date ON sessions(date);
CREATE INDEX idx_sessions_station_id ON sessions(station_id);
CREATE INDEX idx_sessions_customer_id ON sessions(customer_id);
