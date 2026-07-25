-- Who created/last edited each row. No local `users` table exists (users
-- and roles are pure server-side admin data, never pulled down -- see
-- sync.rs's TABLES list), so these are plain nullable text columns holding
-- a server user id, not a local foreign key. Mirrors apps/api's
-- createdBy/updatedBy columns; the outbox carries these through on push so
-- the server can either trust them or re-stamp them from the actual
-- authenticated pusher (it re-stamps -- see sync.service.ts).

ALTER TABLE categories ADD COLUMN created_by TEXT;
ALTER TABLE categories ADD COLUMN updated_by TEXT;

ALTER TABLE stations ADD COLUMN created_by TEXT;
ALTER TABLE stations ADD COLUMN updated_by TEXT;

ALTER TABLE rates ADD COLUMN created_by TEXT;
ALTER TABLE rates ADD COLUMN updated_by TEXT;

ALTER TABLE customers ADD COLUMN created_by TEXT;
ALTER TABLE customers ADD COLUMN updated_by TEXT;

ALTER TABLE sessions ADD COLUMN created_by TEXT;
ALTER TABLE sessions ADD COLUMN updated_by TEXT;

ALTER TABLE expenses ADD COLUMN created_by TEXT;
ALTER TABLE expenses ADD COLUMN updated_by TEXT;

-- Append-only ledger -- no update path, so no updated_by.
ALTER TABLE credit_entries ADD COLUMN created_by TEXT;

ALTER TABLE product_categories ADD COLUMN created_by TEXT;
ALTER TABLE product_categories ADD COLUMN updated_by TEXT;

ALTER TABLE products ADD COLUMN created_by TEXT;
ALTER TABLE products ADD COLUMN updated_by TEXT;

-- Append-only (a checked-out order is never edited) -- no updated_by.
ALTER TABLE orders ADD COLUMN created_by TEXT;

-- Append-only ledger -- no updated_by.
ALTER TABLE stock_movements ADD COLUMN created_by TEXT;

-- current_actor: a single-row table holding the id of whoever is currently
-- logged in on this device, set by AuthContext right after login/refresh
-- and cleared on logout. Every create/update command reads this to stamp
-- created_by/updated_by -- see commands/current_actor.rs. (Not named
-- current_user -- SQLite doesn't reserve that word, but several SQL
-- dialects treat CURRENT_USER as a builtin function, not worth the risk.)
CREATE TABLE current_actor (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL
);
