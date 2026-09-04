/*
  Warnings:

  - You are about to drop the column `labItemCode` on the `DrugEffectRule` table. All the data in the column will be lost.
  - You are about to drop the column `vitalField` on the `DrugEffectRule` table. All the data in the column will be lost.
  - Added the required column `target` to the `DrugEffectRule` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DrugEffectRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "categoryId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "shiftValue" REAL,
    "effectText" TEXT,
    "onsetDelayHours" REAL NOT NULL DEFAULT 0,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DrugEffectRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DrugCategoryMaster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DrugEffectRule" ("categoryId", "createdAt", "effectText", "id", "note", "onsetDelayHours", "shiftValue", "sortOrder", "targetType") SELECT "categoryId", "createdAt", "effectText", "id", "note", "onsetDelayHours", "shiftValue", "sortOrder", "targetType" FROM "DrugEffectRule";
DROP TABLE "DrugEffectRule";
ALTER TABLE "new_DrugEffectRule" RENAME TO "DrugEffectRule";
CREATE UNIQUE INDEX "DrugEffectRule_categoryId_targetType_target_key" ON "DrugEffectRule"("categoryId", "targetType", "target");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
