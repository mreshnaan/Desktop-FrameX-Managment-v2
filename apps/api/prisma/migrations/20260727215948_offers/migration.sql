-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "discountAmount" INTEGER,
ADD COLUMN     "offerId" TEXT;

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "appliesToAllCategories" BOOLEAN NOT NULL DEFAULT false,
    "categoryIds" TEXT,
    "days" TEXT,
    "startTime" TEXT,
    "endTime" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "minDurationMinutes" INTEGER,
    "minGameCount" INTEGER,
    "effectType" TEXT NOT NULL,
    "effectValue" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedBy" TEXT,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
