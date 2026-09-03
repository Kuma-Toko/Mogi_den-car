-- CreateTable
CREATE TABLE "BasePhysiologyModel" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "temperature" REAL NOT NULL DEFAULT 36.5,
    "systolicBp" INTEGER NOT NULL DEFAULT 120,
    "diastolicBp" INTEGER NOT NULL DEFAULT 70,
    "pulse" INTEGER NOT NULL DEFAULT 75,
    "spo2" INTEGER NOT NULL DEFAULT 98,
    "respRate" INTEGER NOT NULL DEFAULT 16,
    "updatedAt" DATETIME NOT NULL,

    CONSTRAINT "BasePhysiologyModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseDiseaseLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "physiologyParams" TEXT NOT NULL,
    "severityBaselineAt" DATETIME NOT NULL,
    "aiSeverityRatePerHour" REAL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CaseDiseaseLink_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CaseDiseaseLink_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiseaseTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseDiseaseLink_caseId_templateId_key" ON "CaseDiseaseLink"("caseId", "templateId");

-- Seed the singleton base physiology row
INSERT INTO "BasePhysiologyModel" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP);

-- Data migration: existing single Case.diseaseTemplateId becomes the primary CaseDiseaseLink,
-- carrying over its physiologyParams/severityBaselineAt/aiSeverityRatePerHour. Must run before
-- those columns are dropped from Case below.
INSERT INTO "CaseDiseaseLink" ("id", "caseId", "templateId", "isPrimary", "physiologyParams", "severityBaselineAt", "aiSeverityRatePerHour", "sortOrder")
SELECT lower(hex(randomblob(16))), "id", "diseaseTemplateId", true,
       COALESCE("physiologyParams", '{"initialTempSlider":50,"improvementSpeedSlider":50,"initialSpo2Slider":50,"severitySlider":50}'),
       "severityBaselineAt", "aiSeverityRatePerHour", 0
FROM "Case"
WHERE "diseaseTemplateId" IS NOT NULL;

-- AlterTable
ALTER TABLE "Case" ADD COLUMN "crisisConditionSince" DATETIME;

-- AlterTable
ALTER TABLE "TemplateCrisisScenario" ADD COLUMN "sustainMinutes" INTEGER NOT NULL DEFAULT 0;

-- RedefineTables: drop diseaseTemplateId/physiologyParams/severityBaselineAt/aiSeverityRatePerHour from Case
-- (now that they have been copied into CaseDiseaseLink above)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "crisisConditionSince" DATETIME,
    "historyScript" TEXT,
    "examScript" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    CONSTRAINT "Case_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Case" ("id", "caseCode", "title", "caseType", "status", "timeProgressMode", "sharingMode", "resultTiming", "simNowAt", "patientName", "patientAge", "patientGender", "ward", "bed", "visibilityScope", "crisisMode", "crisisState", "crisisStartedAt", "crisisConditionSince", "historyScript", "examScript", "createdByUserId", "createdAt", "updatedAt", "publishedAt")
SELECT "id", "caseCode", "title", "caseType", "status", "timeProgressMode", "sharingMode", "resultTiming", "simNowAt", "patientName", "patientAge", "patientGender", "ward", "bed", "visibilityScope", "crisisMode", "crisisState", "crisisStartedAt", "crisisConditionSince", "historyScript", "examScript", "createdByUserId", "createdAt", "updatedAt", "publishedAt"
FROM "Case";
DROP TABLE "Case";
ALTER TABLE "new_Case" RENAME TO "Case";
CREATE UNIQUE INDEX "Case_caseCode_key" ON "Case"("caseCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
