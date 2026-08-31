/*
  Warnings:

  - You are about to drop the column `batchId` on the `Order` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "orderedByUserId" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "detail" TEXT,
    "labItemId" TEXT,
    "drugId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ORDERED',
    "orderedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resultReadyAt" DATETIME,
    "resultText" TEXT,
    "resultValues" TEXT,
    CONSTRAINT "Order_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Order_orderedByUserId_fkey" FOREIGN KEY ("orderedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_labItemId_fkey" FOREIGN KEY ("labItemId") REFERENCES "LabItemMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "DrugMaster" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("caseId", "detail", "drugId", "id", "labItemId", "label", "orderType", "orderedAt", "orderedByUserId", "resultReadyAt", "resultText", "resultValues", "status") SELECT "caseId", "detail", "drugId", "id", "labItemId", "label", "orderType", "orderedAt", "orderedByUserId", "resultReadyAt", "resultText", "resultValues", "status" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
