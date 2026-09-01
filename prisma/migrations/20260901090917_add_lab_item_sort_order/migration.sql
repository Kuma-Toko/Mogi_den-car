-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LabItemMaster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "unit" TEXT,
    "sampleResult" TEXT,
    "sampleValues" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_LabItemMaster" ("category", "code", "id", "name", "sampleResult", "sampleValues", "subcategory", "unit") SELECT "category", "code", "id", "name", "sampleResult", "sampleValues", "subcategory", "unit" FROM "LabItemMaster";
DROP TABLE "LabItemMaster";
ALTER TABLE "new_LabItemMaster" RENAME TO "LabItemMaster";
CREATE UNIQUE INDEX "LabItemMaster_code_key" ON "LabItemMaster"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
