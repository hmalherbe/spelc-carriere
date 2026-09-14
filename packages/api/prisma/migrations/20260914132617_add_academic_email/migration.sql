-- CreateTable
CREATE TABLE "AcademicEmail" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcademicEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AcademicEmail_nom_prenom_idx" ON "AcademicEmail"("nom", "prenom");
