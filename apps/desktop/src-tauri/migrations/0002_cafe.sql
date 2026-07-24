-- Cafe module: standalone point-of-sale revenue stream. See
-- apps/api/prisma/schema.prisma's comment on the Order model for why this
-- is not tied to a table session the way FrameX ties cafe orders to a tab.

CREATE TABLE product_categories (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE products (
  id                  TEXT PRIMARY KEY,
  category_id         TEXT NOT NULL REFERENCES product_categories(id),
  name                TEXT NOT NULL,
  price               INTEGER NOT NULL,
  cost                INTEGER,
  stock_qty           INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 0,
  barcode             TEXT,
  active              INTEGER NOT NULL DEFAULT 1,
  updated_at          TEXT NOT NULL,
  deleted_at          TEXT
);
CREATE INDEX idx_products_category_id ON products(category_id);

CREATE TABLE orders (
  id          TEXT PRIMARY KEY,
  method      TEXT NOT NULL CHECK (method IN ('Cash', 'Card', 'Credit')),
  total       INTEGER NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX idx_orders_customer_id ON orders(customer_id);

CREATE TABLE order_items (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  line_total INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);
CREATE INDEX idx_order_items_product_id ON order_items(product_id);

CREATE TABLE stock_movements (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN ('purchase', 'sale', 'waste', 'correction')),
  note       TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_stock_movements_product_id ON stock_movements(product_id);
