-- CreateTable
CREATE TABLE "DrugCategoryMaster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "majorCategory" TEXT NOT NULL,
    "subCategory" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DrugCategoryLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "drugMasterId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DrugCategoryLink_drugMasterId_fkey" FOREIGN KEY ("drugMasterId") REFERENCES "DrugMaster" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DrugCategoryLink_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DrugCategoryMaster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DrugCategoryMaster_majorCategory_subCategory_key" ON "DrugCategoryMaster"("majorCategory", "subCategory");

-- CreateIndex
CREATE INDEX "DrugCategoryLink_categoryId_idx" ON "DrugCategoryLink"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "DrugCategoryLink_drugMasterId_categoryId_key" ON "DrugCategoryLink"("drugMasterId", "categoryId");
