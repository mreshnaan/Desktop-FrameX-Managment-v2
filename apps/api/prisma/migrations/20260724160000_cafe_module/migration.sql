-- Cafe module: standalone point-of-sale revenue stream, not tied to a table
-- Session (see schema.prisma's comment on the Order model for why).

CREATE TYPE "StockMovementReason" AS ENUM ('purchase', 'sale', 'waste', 'correction');

CREATE TABLE "ProductCategory" (
  "id"   TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductCategory_name_key" ON "ProductCategory"("name");

CREATE TABLE "Product" (
  "id"                TEXT NOT NULL,
  "categoryId"        TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "price"             INTEGER NOT NULL,
  "cost"              INTEGER,
  "stockQty"          INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
  "barcode"           TEXT,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"         TIMESTAMP(3),
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Order" (
  "id"         TEXT NOT NULL,
  "method"     "Method" NOT NULL,
  "total"      INTEGER NOT NULL,
  "customerId" TEXT,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"  TIMESTAMP(3),
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

CREATE TABLE "OrderItem" (
  "id"        TEXT NOT NULL,
  "orderId"   TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "qty"       INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "lineTotal" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "StockMovement" (
  "id"        TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "delta"     INTEGER NOT NULL,
  "reason"    "StockMovementReason" NOT NULL,
  "note"      TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockMovement_productId_idx" ON "StockMovement"("productId");
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
