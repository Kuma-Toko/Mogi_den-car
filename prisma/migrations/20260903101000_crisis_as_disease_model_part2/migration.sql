-- Cleanup: prisma/migrate-crisis-to-disease-model.ts has already populated targetTemplateId for
-- every existing TemplateCrisisScenario row and cloned rescue actions into the new
-- CrisisRescueActionRow.rescueConfigId-parented rows. Now finalize the schema.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- RedefineTable: TemplateCrisisScenario drops name/windowMinutes/crisisVitals/postRescueSeverity,
-- targetTemplateId becomes NOT NULL with a proper FK.
CREATE TABLE "new_TemplateCrisisScenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "targetTemplateId" TEXT NOT NULL,
    "sustainMinutes" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TemplateCrisisScenario_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiseaseTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TemplateCrisisScenario_targetTemplateId_fkey" FOREIGN KEY ("targetTemplateId") REFERENCES "DiseaseTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TemplateCrisisScenario" ("id", "templateId", "targetTemplateId", "sustainMinutes", "sortOrder")
SELECT "id", "templateId", "targetTemplateId", "sustainMinutes", "sortOrder" FROM "TemplateCrisisScenario";
DROP TABLE "TemplateCrisisScenario";
ALTER TABLE "new_TemplateCrisisScenario" RENAME TO "TemplateCrisisScenario";

-- RedefineTable: CrisisRescueActionRow drops the old scenarioId column (and the rows it belonged to,
-- now superseded by rows parented via rescueConfigId), rescueConfigId becomes NOT NULL with a proper FK.
CREATE TABLE "new_CrisisRescueActionRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rescueConfigId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "drugCategories" TEXT NOT NULL,
    "procedureKeywords" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CrisisRescueActionRow_rescueConfigId_fkey" FOREIGN KEY ("rescueConfigId") REFERENCES "CrisisRescueConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CrisisRescueActionRow" ("id", "rescueConfigId", "label", "drugCategories", "procedureKeywords", "sortOrder")
SELECT "id", "rescueConfigId", "label", "drugCategories", "procedureKeywords", "sortOrder" FROM "CrisisRescueActionRow" WHERE "rescueConfigId" IS NOT NULL;
DROP TABLE "CrisisRescueActionRow";
ALTER TABLE "new_CrisisRescueActionRow" RENAME TO "CrisisRescueActionRow";

-- RedefineTable: Case drops crisisConditionSince (superseded by CaseCrisisTriggerProgress).
CREATE TABLE "new_Case" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "timeProgressMode" TEXT NOT NULL,
    "sharingMode" TEXT NOT NULL DEFAULT 'SOLO',
    "resultTiming" TEXT NOT NULL DEFAULT 'IMMEDIATE',
    "simNowAt" DATETIME,
    "patientName" TEXT NOT NULL,
    "patientAge" INTEGER NOT NULL,
    "patientGender" TEXT NOT NULL,
    "ward" TEXT,
    "bed" TEXT,
    "visibilityScope" TEXT,
    "crisisMode" TEXT NOT NULL DEFAULT 'LETHAL',
    "crisisState" TEXT NOT NULL DEFAULT 'STABLE',
    "crisisStartedAt" DATETIME,
    "historyScript" TEXT,
    "examScript" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    CONSTRAINT "Case_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Case" ("id", "caseCode", "title", "caseType", "status", "timeProgressMode", "sharingMode", "resultTiming", "simNowAt", "patientName", "patientAge", "patientGender", "ward", "bed", "visibilityScope", "crisisMode", "crisisState", "crisisStartedAt", "historyScript", "examScript", "createdByUserId", "createdAt", "updatedAt", "publishedAt")
SELECT "id", "caseCode", "title", "caseType", "status", "timeProgressMode", "sharingMode", "resultTiming", "simNowAt", "patientName", "patientAge", "patientGender", "ward", "bed", "visibilityScope", "crisisMode", "crisisState", "crisisStartedAt", "historyScript", "examScript", "createdByUserId", "createdAt", "updatedAt", "publishedAt"
FROM "Case";
DROP TABLE "Case";
ALTER TABLE "new_Case" RENAME TO "Case";
CREATE UNIQUE INDEX "Case_caseCode_key" ON "Case"("caseCode");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
