-- AlterTable
ALTER TABLE "LabItemMaster" ADD COLUMN "subcategory" TEXT;

-- CreateTable
CREATE TABLE "UsageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "UsageTemplate_label_key" ON "UsageTemplate"("label");
