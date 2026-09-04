-- Fix-up: CrisisRescueActionRow.scenarioId must become nullable so the data migration script can
-- insert new rows (parented by the new rescueConfigId column) before scenarioId is dropped entirely
-- in the follow-up cleanup migration.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CrisisRescueActionRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT,
    "rescueConfigId" TEXT,
    "label" TEXT NOT NULL,
    "drugCategories" TEXT NOT NULL,
    "procedureKeywords" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CrisisRescueActionRow_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "TemplateCrisisScenario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CrisisRescueActionRow" ("id", "scenarioId", "rescueConfigId", "label", "drugCategories", "procedureKeywords", "sortOrder")
SELECT "id", "scenarioId", "rescueConfigId", "label", "drugCategories", "procedureKeywords", "sortOrder" FROM "CrisisRescueActionRow";
DROP TABLE "CrisisRescueActionRow";
ALTER TABLE "new_CrisisRescueActionRow" RENAME TO "CrisisRescueActionRow";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
