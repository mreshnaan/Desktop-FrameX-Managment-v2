-- Relational local schema for the Cue Room desktop app. Mirrors apps/api's
-- Postgres schema in spirit (real foreign keys) but is not identical column
-- for column -- see docs/superpowers/specs/2026-07-24-desktop-app-design.md.

CREATE TABLE categories (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  billing_type  TEXT NOT NULL CHECK (billing_type IN ('time', 'frame'))
);

CREATE TABLE stations (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL REFERENCES categories(id),
  name         TEXT NOT NULL
);
CREATE INDEX idx_stations_category_id ON stations(category_id);

CREATE TABLE rates (
  id           TEXT PRIMARY KEY,
  category_id  TEXT NOT NULL UNIQUE REFERENCES categories(id),
  hour_rate    INTEGER,
  half_rate    INTEGER,
  frame_rate   INTEGER,
  updated_at   TEXT NOT NULL
);

CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  station_id   TEXT NOT NULL REFERENCES stations(id),
  date         TEXT NOT NULL,
  start        TEXT NOT NULL DEFAULT '',
  "end"        TEXT NOT NULL DEFAULT '',
  amount       INTEGER NOT NULL DEFAULT 0,
  method       TEXT NOT NULL CHECK (method IN ('Cash', 'Card', 'Credit')),
  customer_id  TEXT REFERENCES customers(id),
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX idx_sessions_date ON sessions(date);
CREATE INDEX idx_sessions_station_id ON sessions(station_id);
CREATE INDEX idx_sessions_customer_id ON sessions(customer_id);

CREATE TABLE expenses (
  id           TEXT PRIMARY KEY,
  date         TEXT NOT NULL,
  description  TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  method       TEXT NOT NULL CHECK (method IN ('Cash', 'Card')),
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX idx_expenses_date ON expenses(date);

CREATE TABLE credit_entries (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT NOT NULL REFERENCES customers(id),
  date         TEXT NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('CREDIT_GIVEN', 'PAYMENT_RECEIVED')),
  amount       INTEGER NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_credit_entries_customer_id ON credit_entries(customer_id);

CREATE TABLE outbox (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name         TEXT NOT NULL,
  op                 TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
  entity_id          TEXT NOT NULL,
  payload_json       TEXT NOT NULL,
  client_updated_at  TEXT NOT NULL
);

CREATE TABLE sync_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
