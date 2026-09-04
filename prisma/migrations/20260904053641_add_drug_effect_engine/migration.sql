-- AlterTable
ALTER TABLE "Order" ADD COLUMN "discontinuedAt" DATETIME;

-- CreateTable
CREATE TABLE "DrugEffectRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "labItemCode" TEXT,
    "vitalField" TEXT,
    "shiftValue" REAL,
    "effectText" TEXT,
    "onsetDelayHours" REAL NOT NULL DEFAULT 0,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DrugEffectRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DrugCategoryMaster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
