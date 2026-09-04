-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DiseaseTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isCommon" BOOLEAN NOT NULL DEFAULT true,
    "defaultParams" TEXT NOT NULL,
    "treatmentConfig" TEXT,
    "vitalsConfig" TEXT,
    "aiEvaluationGuideline" TEXT,
    "isInfectious" BOOLEAN NOT NULL DEFAULT false,
    "isCrisisPathology" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiseaseTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DiseaseTemplate" ("aiEvaluationGuideline", "createdAt", "createdByUserId", "defaultParams", "description", "id", "isCommon", "isInfectious", "key", "name", "treatmentConfig", "vitalsConfig") SELECT "aiEvaluationGuideline", "createdAt", "createdByUserId", "defaultParams", "description", "id", "isCommon", "isInfectious", "key", "name", "treatmentConfig", "vitalsConfig" FROM "DiseaseTemplate";
DROP TABLE "DiseaseTemplate";
ALTER TABLE "new_DiseaseTemplate" RENAME TO "DiseaseTemplate";
CREATE UNIQUE INDEX "DiseaseTemplate_key_key" ON "DiseaseTemplate"("key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
