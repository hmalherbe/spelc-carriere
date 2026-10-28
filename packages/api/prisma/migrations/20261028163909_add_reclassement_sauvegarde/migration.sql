-- CreateTable
CREATE TABLE "ReclassementSauvegarde" (
    "id" TEXT NOT NULL,
    "cas" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "parametres" JSONB NOT NULL,
    "resultat" JSONB NOT NULL,
    "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "savedById" TEXT NOT NULL,

    CONSTRAINT "ReclassementSauvegarde_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReclassementSauvegarde_nom_prenom_idx" ON "ReclassementSauvegarde"("nom", "prenom");
