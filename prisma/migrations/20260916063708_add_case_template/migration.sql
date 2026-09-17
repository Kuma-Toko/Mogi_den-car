-- RedefineTables
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
    "historyScript" TEXT,
    "examScript" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "publishedAt" DATETIME,
    "isTemplate" BOOLEAN NOT NULL DEFAULT false,
    "templateSourceId" TEXT,
    CONSTRAINT "Case_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Case_templateSourceId_fkey" FOREIGN KEY ("templateSourceId") REFERENCES "Case" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Case" ("bed", "caseCode", "caseType", "createdAt", "createdByUserId", "crisisMode", "crisisStartedAt", "crisisState", "examScript", "historyScript", "id", "patientAge", "patientGender", "patientName", "publishedAt", "resultTiming", "sharingMode", "simNowAt", "status", "timeProgressMode", "title", "updatedAt", "visibilityScope", "ward") SELECT "bed", "caseCode", "caseType", "createdAt", "createdByUserId", "crisisMode", "crisisStartedAt", "crisisState", "examScript", "historyScript", "id", "patientAge", "patientGender", "patientName", "publishedAt", "resultTiming", "sharingMode", "simNowAt", "status", "timeProgressMode", "title", "updatedAt", "visibilityScope", "ward" FROM "Case";
DROP TABLE "Case";
ALTER TABLE "new_Case" RENAME TO "Case";
CREATE UNIQUE INDEX "Case_caseCode_key" ON "Case"("caseCode");
CREATE INDEX "Case_createdByUserId_idx" ON "Case"("createdByUserId");
CREATE INDEX "Case_status_idx" ON "Case"("status");
CREATE INDEX "Case_isTemplate_idx" ON "Case"("isTemplate");
CREATE INDEX "Case_templateSourceId_idx" ON "Case"("templateSourceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
