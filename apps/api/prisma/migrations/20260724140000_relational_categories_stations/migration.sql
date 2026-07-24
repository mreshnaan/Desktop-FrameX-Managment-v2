-- Category/Station tables introduced to replace Session's flat category/resource
-- strings and Rate's string-keyed category with real foreign keys.
-- Verified before writing this migration: Session, Expense, Customer,
-- CreditEntry, Rate, and User all have 0 rows in the live database, so no
-- data-preserving transform is needed.

CREATE TABLE "Category" (
  "id"          TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "billingType" TEXT NOT NULL,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

CREATE TABLE "Station" (
  "id"         TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Station_categoryId_idx" ON "Station"("categoryId");
ALTER TABLE "Station" ADD CONSTRAINT "Station_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Session: replace category/resource strings with a stationId FK
ALTER TABLE "Session" DROP COLUMN "category";
ALTER TABLE "Session" DROP COLUMN "resource";
ALTER TABLE "Session" ADD COLUMN "stationId" TEXT NOT NULL;
CREATE INDEX "Session_stationId_idx" ON "Session"("stationId");
ALTER TABLE "Session" ADD CONSTRAINT "Session_stationId_fkey"
  FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rate: replace the string-keyed "category" primary key with a generated id
-- plus a categoryId foreign key.
ALTER TABLE "Rate" DROP CONSTRAINT "Rate_pkey";
ALTER TABLE "Rate" RENAME COLUMN "category" TO "categoryId";
ALTER TABLE "Rate" ADD COLUMN "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "Rate" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "Rate" ADD CONSTRAINT "Rate_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "Rate_categoryId_key" ON "Rate"("categoryId");
ALTER TABLE "Rate" ADD CONSTRAINT "Rate_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
