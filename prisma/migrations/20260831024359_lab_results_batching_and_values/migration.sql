-- AlterTable
ALTER TABLE "LabItemMaster" ADD COLUMN "sampleValues" TEXT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "batchId" TEXT;
ALTER TABLE "Order" ADD COLUMN "resultValues" TEXT;
