-- CreateTable
CREATE TABLE "PhysiologyBaselineBand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "minAge" INTEGER NOT NULL,
    "maxAge" INTEGER NOT NULL,
    "gender" TEXT NOT NULL,
    "temperature" REAL NOT NULL,
    "systolicBp" INTEGER NOT NULL,
    "diastolicBp" INTEGER NOT NULL,
    "pulse" INTEGER NOT NULL,
    "spo2" INTEGER NOT NULL,
    "respRate" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

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
    CONSTRAINT "CaseDiseaseLink_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CaseDiseaseLink_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiseaseTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CaseDiseaseLink" ("aiSeverityRatePerHour", "caseId", "id", "isPrimary", "physiologyParams", "severityBaselineAt", "sortOrder", "templateId") SELECT "aiSeverityRatePerHour", "caseId", "id", "isPrimary", "physiologyParams", "severityBaselineAt", "sortOrder", "templateId" FROM "CaseDiseaseLink";
DROP TABLE "CaseDiseaseLink";
ALTER TABLE "new_CaseDiseaseLink" RENAME TO "CaseDiseaseLink";
CREATE UNIQUE INDEX "CaseDiseaseLink_caseId_templateId_key" ON "CaseDiseaseLink"("caseId", "templateId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
