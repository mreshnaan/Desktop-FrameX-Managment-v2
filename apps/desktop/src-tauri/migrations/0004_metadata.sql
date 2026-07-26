-- Nullable JSON-as-text snapshot of the pricing context (rate or product
-- price) that produced amount/unit_price, captured at write time for
-- reference only -- never read back by any query or UI.
ALTER TABLE sessions ADD COLUMN metadata TEXT;
ALTER TABLE order_items ADD COLUMN metadata TEXT;
