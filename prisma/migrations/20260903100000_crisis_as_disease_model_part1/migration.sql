-- AlterTable: TemplateCrisisScenario gains targetTemplateId (nullable for now, filled by
-- prisma/migrate-crisis-to-disease-model.ts, made NOT NULL with FK in the next migration) and sortOrder.
ALTER TABLE "TemplateCrisisScenario" ADD COLUMN "targetTemplateId" TEXT;
ALTER TABLE "TemplateCrisisScenario" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CrisisRescueConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "postRescueSeverity" INTEGER NOT NULL,
    CONSTRAINT "CrisisRescueConfig_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiseaseTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CrisisRescueConfig_templateId_key" ON "CrisisRescueConfig"("templateId");

-- AlterTable: CrisisRescueActionRow gains rescueConfigId (nullable for now; old scenarioId column
-- stays until the migration script has copied rows across, then both are finalized in the next migration).
ALTER TABLE "CrisisRescueActionRow" ADD COLUMN "rescueConfigId" TEXT;

-- CreateTable
CREATE TABLE "CaseCrisisTriggerProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "conditionSince" DATETIME NOT NULL,
    CONSTRAINT "CaseCrisisTriggerProgress_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CaseCrisisTriggerProgress_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "TemplateCrisisScenario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseCrisisTriggerProgress_caseId_scenarioId_key" ON "CaseCrisisTriggerProgress"("caseId", "scenarioId");
