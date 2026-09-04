-- AlterTable
ALTER TABLE "CaseDiseaseLink" ADD COLUMN "relevantSpecimenSites" TEXT;

-- AlterTable
ALTER TABLE "LabItemMaster" ADD COLUMN "microbiologyKind" TEXT;
ALTER TABLE "LabItemMaster" ADD COLUMN "specimenSite" TEXT;
