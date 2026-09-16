/*
  Warnings:

  - You are about to drop the column `appropriatenessScore` on the `TreatmentEvaluation` table. All the data in the column will be lost.
  - You are about to drop the column `contraindicated` on the `TreatmentEvaluation` table. All the data in the column will be lost.
  - You are about to drop the column `rationale` on the `TreatmentEvaluation` table. All the data in the column will be lost.
  - You are about to drop the column `resetSeverity` on the `TreatmentEvaluation` table. All the data in the column will be lost.
  - You are about to drop the column `severityRatePerHour` on the `TreatmentEvaluation` table. All the data in the column will be lost.

*/
-- CreateTable
CREATE TABLE "TreatmentEvaluationDiseaseResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "evaluationId" TEXT NOT NULL,
    "diseaseLinkId" TEXT NOT NULL,
    "appropriatenessScore" INTEGER NOT NULL,
    "contraindicated" BOOLEAN NOT NULL DEFAULT false,
    "severityRatePerHour" REAL,
    "resetSeverity" INTEGER,
    "rationale" TEXT,
    CONSTRAINT "TreatmentEvaluationDiseaseResult_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "TreatmentEvaluation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TreatmentEvaluationDiseaseResult_diseaseLinkId_fkey" FOREIGN KEY ("diseaseLinkId") REFERENCES "CaseDiseaseLink" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentEvaluationDiseaseResult_evaluationId_diseaseLinkId_key" ON "TreatmentEvaluationDiseaseResult"("evaluationId", "diseaseLinkId");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TreatmentEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ordersSnapshotHash" TEXT NOT NULL,
    "orderIdsSnapshot" TEXT NOT NULL,
    "rawResponse" TEXT,
    "errorMessage" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "TreatmentEvaluation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TreatmentEvaluation" ("caseId", "completedAt", "errorMessage", "id", "orderIdsSnapshot", "ordersSnapshotHash", "rawResponse", "requestedAt", "status") SELECT "caseId", "completedAt", "errorMessage", "id", "orderIdsSnapshot", "ordersSnapshotHash", "rawResponse", "requestedAt", "status" FROM "TreatmentEvaluation";
DROP TABLE "TreatmentEvaluation";
ALTER TABLE "new_TreatmentEvaluation" RENAME TO "TreatmentEvaluation";
CREATE INDEX "TreatmentEvaluation_caseId_ordersSnapshotHash_idx" ON "TreatmentEvaluation"("caseId", "ordersSnapshotHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
