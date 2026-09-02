-- AlterTable
ALTER TABLE "DiseaseTemplate" ADD COLUMN "treatmentConfig" TEXT;
ALTER TABLE "DiseaseTemplate" ADD COLUMN "vitalsConfig" TEXT;

-- CreateTable
CREATE TABLE "TemplateLabPattern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "labItemCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mildText" TEXT,
    "moderateText" TEXT,
    "severeText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TemplateLabPattern_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiseaseTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplateLabPatternValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patternId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "TemplateLabPatternValue_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "TemplateLabPattern" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplateCrisisScenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "windowMinutes" INTEGER NOT NULL,
    "postRescueSeverity" INTEGER NOT NULL,
    "crisisVitals" TEXT NOT NULL,
    CONSTRAINT "TemplateCrisisScenario_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DiseaseTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CrisisTriggerRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT,
    "label" TEXT,
    "field" TEXT,
    "op" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CrisisTriggerRow_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "TemplateCrisisScenario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CrisisRescueActionRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "drugCategories" TEXT NOT NULL,
    "procedureKeywords" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CrisisRescueActionRow_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "TemplateCrisisScenario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateLabPattern_templateId_labItemCode_key" ON "TemplateLabPattern"("templateId", "labItemCode");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateCrisisScenario_templateId_key" ON "TemplateCrisisScenario"("templateId");
