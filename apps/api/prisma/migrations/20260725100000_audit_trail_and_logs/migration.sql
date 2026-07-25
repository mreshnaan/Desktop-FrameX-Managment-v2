-- Audit trail (createdBy/updatedBy on every mutable table, FK'd to User
-- with ON DELETE SET NULL -- there's no delete-user path today, but a
-- future one shouldn't be blocked by, or wipe, historical audit data) plus
-- two server-only, never-synced log tables: ActivityLog (one row per
-- create/update/delete) and SyncLog (one row per push/pull cycle).

ALTER TABLE "Role" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Role" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "Role" ADD CONSTRAINT "Role_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Role" ADD CONSTRAINT "Role_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Category" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Category" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "Category" ADD CONSTRAINT "Category_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Category" ADD CONSTRAINT "Category_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Station" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Station" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "Station" ADD CONSTRAINT "Station_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Station" ADD CONSTRAINT "Station_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Session" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Session" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "Session" ADD CONSTRAINT "Session_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Expense" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Expense" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Customer" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Customer" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CreditEntry" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "CreditEntry" ADD CONSTRAINT "CreditEntry_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Rate" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Rate" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "Rate" ADD CONSTRAINT "Rate_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Rate" ADD CONSTRAINT "Rate_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductCategory" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "ProductCategory" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Product" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Product" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "Product" ADD CONSTRAINT "Product_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StockMovement" ADD COLUMN "createdBy" TEXT;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ActivityLog" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT,
  "userName"  TEXT,
  "action"    TEXT NOT NULL,
  "tableName" TEXT NOT NULL,
  "entityId"  TEXT NOT NULL,
  "summary"   TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");
CREATE INDEX "ActivityLog_tableName_entityId_idx" ON "ActivityLog"("tableName", "entityId");
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SyncLog" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT,
  "userName"     TEXT,
  "direction"    TEXT NOT NULL,
  "entryCount"   INTEGER NOT NULL,
  "failedCount"  INTEGER NOT NULL DEFAULT 0,
  "errorSummary" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SyncLog_createdAt_idx" ON "SyncLog"("createdAt");
CREATE INDEX "SyncLog_userId_idx" ON "SyncLog"("userId");
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
