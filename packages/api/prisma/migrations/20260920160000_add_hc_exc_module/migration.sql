-- CreateEnum
CREATE TYPE "CampagneType" AS ENUM ('CCMA', 'CCMI', 'HC', 'EXC');

-- AlterTable: Campagne.type moves from AdelSyncType (CCMA/CCMI only) to the new CampagneType
-- (which also covers HC/EXC) — cast in place instead of drop+recreate, since Prisma's own
-- generated migration would otherwise silently wipe every existing campagne's type. Every value
-- currently stored (CCMA/CCMI, or NULL) has an identically-named member in the new enum, so a
-- plain USING cast through text is lossless.
ALTER TABLE "Campagne" ALTER COLUMN "type" TYPE "CampagneType" USING ("type"::text::"CampagneType");

-- CreateTable
CREATE TABLE "HcExcSnapshot" (
    "id" TEXT NOT NULL,
    "campagneId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "nomUsage" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "vivier" TEXT,
    "rang" INTEGER NOT NULL,
    "choixRecteur" BOOLEAN NOT NULL DEFAULT false,
    "totalBareme" INTEGER,
    "avisCE" TEXT,
    "avisInspecteur" TEXT,
    "appreciationRecteur" TEXT,
    "pointsRecteur" INTEGER,
    "pointsAnciennete" INTEGER,
    "millesime" INTEGER,
    "origine" TEXT,
    "disciplineCode" TEXT,
    "disciplineLibelle" TEXT,
    "rneEtablissement" TEXT,
    "nomEtablissement" TEXT,
    "dateNaissance" TIMESTAMP(3),
    "echelonActuel" TEXT NOT NULL,
    "ancienneteEchelon" DOUBLE PRECISION,
    "rowIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HcExcSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contingent" (
    "id" TEXT NOT NULL,
    "campagneId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "vivier" TEXT,
    "contingentAnnonce" INTEGER,
    "contingentPropose" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "Contingent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HcExcSnapshot_campagneId_teacherId_idx" ON "HcExcSnapshot"("campagneId", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "Contingent_campagneId_grade_vivier_key" ON "Contingent"("campagneId", "grade", "vivier");

-- AddForeignKey
ALTER TABLE "HcExcSnapshot" ADD CONSTRAINT "HcExcSnapshot_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "Campagne"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HcExcSnapshot" ADD CONSTRAINT "HcExcSnapshot_importId_fkey" FOREIGN KEY ("importId") REFERENCES "RectoratImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HcExcSnapshot" ADD CONSTRAINT "HcExcSnapshot_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contingent" ADD CONSTRAINT "Contingent_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "Campagne"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
