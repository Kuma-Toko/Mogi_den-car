-- AlterTable
ALTER TABLE "DiseaseTemplate" ADD COLUMN "aiEvaluationGuideline" TEXT;

-- CreateTable
CREATE TABLE "TreatmentEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ordersSnapshotHash" TEXT NOT NULL,
    "orderIdsSnapshot" TEXT NOT NULL,
    "appropriatenessScore" INTEGER,
    "resetSeverity" INTEGER,
    "rationale" TEXT,
    "rawResponse" TEXT,
    "errorMessage" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "TreatmentEvaluation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TreatmentEvaluation_caseId_ordersSnapshotHash_idx" ON "TreatmentEvaluation"("caseId", "ordersSnapshotHash");
