-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DrugMaster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "defaultDose" TEXT,
    "unit" TEXT,
    "route" TEXT,
    "isInjectable" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_DrugMaster" ("category", "defaultDose", "hotCode", "id", "name", "route", "unit") SELECT "category", "defaultDose", "hotCode", "id", "name", "route", "unit" FROM "DrugMaster";
DROP TABLE "DrugMaster";
ALTER TABLE "new_DrugMaster" RENAME TO "DrugMaster";
CREATE UNIQUE INDEX "DrugMaster_hotCode_key" ON "DrugMaster"("hotCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
