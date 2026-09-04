-- CreateTable
CREATE TABLE "PathogenMaster" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "gramStain" TEXT,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PathogenSusceptibility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pathogenId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "susceptibility" TEXT NOT NULL,
    "note" TEXT,
    CONSTRAINT "PathogenSusceptibility_pathogenId_fkey" FOREIGN KEY ("pathogenId") REFERENCES "PathogenMaster" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PathogenSusceptibility_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DrugCategoryMaster" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PathogenMaster_name_key" ON "PathogenMaster"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PathogenSusceptibility_pathogenId_categoryId_key" ON "PathogenSusceptibility"("pathogenId", "categoryId");
