-- CreateTable
CREATE TABLE "DrugAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drugMasterId" TEXT NOT NULL,
    "aliasText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "aliasType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DrugAlias_drugMasterId_fkey" FOREIGN KEY ("drugMasterId") REFERENCES "DrugMaster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DrugMaster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL DEFAULT '',
    "category" TEXT,
    "defaultDose" TEXT,
    "unit" TEXT,
    "route" TEXT,
    "isInjectable" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_DrugMaster" ("category", "defaultDose", "hotCode", "id", "isInjectable", "name", "route", "unit") SELECT "category", "defaultDose", "hotCode", "id", "isInjectable", "name", "route", "unit" FROM "DrugMaster";
DROP TABLE "DrugMaster";
ALTER TABLE "new_DrugMaster" RENAME TO "DrugMaster";
CREATE UNIQUE INDEX "DrugMaster_hotCode_key" ON "DrugMaster"("hotCode");
CREATE INDEX "DrugMaster_normalizedName_idx" ON "DrugMaster"("normalizedName");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DrugAlias_normalizedText_idx" ON "DrugAlias"("normalizedText");

-- CreateIndex
CREATE UNIQUE INDEX "DrugAlias_drugMasterId_aliasText_key" ON "DrugAlias"("drugMasterId", "aliasText");
