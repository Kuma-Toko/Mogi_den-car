-- AlterTable
ALTER TABLE "Case" ADD COLUMN "aiSeverityRatePerHour" REAL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TreatmentEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ordersSnapshotHash" TEXT NOT NULL,
    "orderIdsSnapshot" TEXT NOT NULL,
    "appropriatenessScore" INTEGER,
    "contraindicated" BOOLEAN NOT NULL DEFAULT false,
    "severityRatePerHour" REAL,
    "resetSeverity" INTEGER,
    "rationale" TEXT,
    "rawResponse" TEXT,
    "errorMessage" TEXT,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "TreatmentEvaluation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TreatmentEvaluation" ("appropriatenessScore", "caseId", "completedAt", "errorMessage", "id", "orderIdsSnapshot", "ordersSnapshotHash", "rationale", "rawResponse", "requestedAt", "resetSeverity", "status") SELECT "appropriatenessScore", "caseId", "completedAt", "errorMessage", "id", "orderIdsSnapshot", "ordersSnapshotHash", "rationale", "rawResponse", "requestedAt", "resetSeverity", "status" FROM "TreatmentEvaluation";
DROP TABLE "TreatmentEvaluation";
ALTER TABLE "new_TreatmentEvaluation" RENAME TO "TreatmentEvaluation";
CREATE INDEX "TreatmentEvaluation_caseId_ordersSnapshotHash_idx" ON "TreatmentEvaluation"("caseId", "ordersSnapshotHash");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
