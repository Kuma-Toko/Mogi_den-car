-- AlterTable
ALTER TABLE "Order" ADD COLUMN "preliminaryResultReadyAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CaseDiseaseLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "physiologyParams" TEXT NOT NULL,
    "severityBaselineAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiSeverityRatePerHour" REAL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "pathogenId" TEXT,
    CONSTRAINT "CaseDiseaseLink_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CaseDiseaseLink_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiseaseTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CaseDiseaseLink_pathogenId_fkey" FOREIGN KEY ("pathogenId") REFERENCES "PathogenMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CaseDiseaseLink" ("aiSeverityRatePerHour", "caseId", "id", "isPrimary", "physiologyParams", "severityBaselineAt", "sortOrder", "templateId") SELECT "aiSeverityRatePerHour", "caseId", "id", "isPrimary", "physiologyParams", "severityBaselineAt", "sortOrder", "templateId" FROM "CaseDiseaseLink";
DROP TABLE "CaseDiseaseLink";
ALTER TABLE "new_CaseDiseaseLink" RENAME TO "CaseDiseaseLink";
CREATE UNIQUE INDEX "CaseDiseaseLink_caseId_templateId_key" ON "CaseDiseaseLink"("caseId", "templateId");
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
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiseaseTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DiseaseTemplate" ("aiEvaluationGuideline", "createdAt", "createdByUserId", "defaultParams", "description", "id", "isCommon", "key", "name", "treatmentConfig", "vitalsConfig") SELECT "aiEvaluationGuideline", "createdAt", "createdByUserId", "defaultParams", "description", "id", "isCommon", "key", "name", "treatmentConfig", "vitalsConfig" FROM "DiseaseTemplate";
DROP TABLE "DiseaseTemplate";
ALTER TABLE "new_DiseaseTemplate" RENAME TO "DiseaseTemplate";
CREATE UNIQUE INDEX "DiseaseTemplate_key_key" ON "DiseaseTemplate"("key");
CREATE TABLE "new_LabItemMaster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "unit" TEXT,
    "sampleResult" TEXT,
    "sampleValues" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isCulture" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_LabItemMaster" ("category", "code", "id", "name", "sampleResult", "sampleValues", "sortOrder", "subcategory", "unit") SELECT "category", "code", "id", "name", "sampleResult", "sampleValues", "sortOrder", "subcategory", "unit" FROM "LabItemMaster";
DROP TABLE "LabItemMaster";
ALTER TABLE "new_LabItemMaster" RENAME TO "LabItemMaster";
CREATE UNIQUE INDEX "LabItemMaster_code_key" ON "LabItemMaster"("code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
