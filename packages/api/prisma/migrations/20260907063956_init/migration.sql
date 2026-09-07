-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'GESTIONNAIRE', 'LECTURE');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('AUTO_CONFIRMED', 'PENDING_REVIEW', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'GESTIONNAIRE',
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grille" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "Grille_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "EchelonRow" (
    "id" TEXT NOT NULL,
    "grilleCode" TEXT NOT NULL,
    "echelon" TEXT NOT NULL,
    "echelonSuivant" TEXT NOT NULL,
    "indice" INTEGER NOT NULL,
    "dureeAnnees" DOUBLE PRECISION,
    "dureeAlternative" DOUBLE PRECISION,

    CONSTRAINT "EchelonRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValeurDuPoint" (
    "id" TEXT NOT NULL,
    "valeur" DOUBLE PRECISION NOT NULL,
    "applicableA" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValeurDuPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeMapping" (
    "grade" TEXT NOT NULL,
    "grilleCode" TEXT NOT NULL,
    "degre" INTEGER NOT NULL,
    "accesHorsClasse" BOOLEAN NOT NULL DEFAULT false,
    "accesClasseExceptionnelle" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GradeMapping_pkey" PRIMARY KEY ("grade")
);

-- CreateTable
CREATE TABLE "Campagne" (
    "id" TEXT NOT NULL,
    "anneeScolaire" TEXT NOT NULL,
    "periodeDebut" TIMESTAMP(3) NOT NULL,
    "periodeFin" TIMESTAMP(3) NOT NULL,
    "dateCcma" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Campagne_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RectoratImport" (
    "id" TEXT NOT NULL,
    "campagneId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedBy" TEXT,
    "rowCount" INTEGER NOT NULL,

    CONSTRAINT "RectoratImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeacherSnapshot" (
    "id" TEXT NOT NULL,
    "campagneId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "nomUsage" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "dateNaissance" TIMESTAMP(3),
    "rneEtablissement" TEXT,
    "nomEtablissement" TEXT,
    "typeEtablissement" TEXT,
    "codePostal" TEXT,
    "ville" TEXT,
    "disciplineCode" TEXT,
    "disciplineLibelle" TEXT,
    "echelonActuel" TEXT NOT NULL,
    "dateAccesEchelon" TIMESTAMP(3) NOT NULL,
    "avisEvaluation" INTEGER,
    "ancienneteGrade" DOUBLE PRECISION,
    "ancienneteEchelon" DOUBLE PRECISION,
    "typePromotion" TEXT,
    "dureeRestante" TEXT,
    "dateProchainePromotionRectorat" TIMESTAMP(3),

    CONSTRAINT "TeacherSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Teacher" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Teacher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Adherent" (
    "id" TEXT NOT NULL,
    "civilite" TEXT,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "nomNaissance" TEXT,
    "grade" TEXT,
    "echelleSpelc" TEXT,
    "ancienEchelon" TEXT,
    "statut" TEXT,
    "typeContrat" TEXT,
    "ancienIndice" INTEGER,
    "dateEffet" TIMESTAMP(3),
    "mailPersonnel" TEXT,
    "mailAcademique" TEXT,
    "departement" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Adherent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchCandidate" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT,
    "adherentId" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "confidence" DOUBLE PRECISION NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComputedPromotionState" (
    "id" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "campagneId" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grilleCode" TEXT NOT NULL,
    "echelonDepart" TEXT NOT NULL,
    "echelonSuivant" TEXT NOT NULL,
    "indiceActuel" INTEGER NOT NULL,
    "futurIndice" INTEGER NOT NULL,
    "gainSalaireBrut" INTEGER NOT NULL,
    "gainSalaireNet" INTEGER NOT NULL,
    "dateProchainePromotion" TIMESTAMP(3),
    "baEstimate" TEXT,

    CONSTRAINT "ComputedPromotionState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaSeuil" (
    "id" TEXT NOT NULL,
    "campagneId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "echelonDepart" INTEGER NOT NULL,
    "nombrePromusBa" INTEGER NOT NULL,
    "minBareme" INTEGER NOT NULL,
    "minAncienneteGrade" DOUBLE PRECISION NOT NULL,
    "minAncienneteEchelon" DOUBLE PRECISION NOT NULL,
    "minAge" INTEGER NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lockedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaSeuil_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "EchelonRow_grilleCode_echelon_key" ON "EchelonRow"("grilleCode", "echelon");

-- CreateIndex
CREATE INDEX "TeacherSnapshot_campagneId_teacherId_idx" ON "TeacherSnapshot"("campagneId", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchCandidate_teacherId_key" ON "MatchCandidate"("teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchCandidate_adherentId_key" ON "MatchCandidate"("adherentId");

-- CreateIndex
CREATE UNIQUE INDEX "ComputedPromotionState_teacherId_campagneId_key" ON "ComputedPromotionState"("teacherId", "campagneId");

-- CreateIndex
CREATE UNIQUE INDEX "BaSeuil_campagneId_grade_echelonDepart_key" ON "BaSeuil"("campagneId", "grade", "echelonDepart");

-- AddForeignKey
ALTER TABLE "EchelonRow" ADD CONSTRAINT "EchelonRow_grilleCode_fkey" FOREIGN KEY ("grilleCode") REFERENCES "Grille"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RectoratImport" ADD CONSTRAINT "RectoratImport_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "Campagne"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSnapshot" ADD CONSTRAINT "TeacherSnapshot_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "Campagne"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSnapshot" ADD CONSTRAINT "TeacherSnapshot_importId_fkey" FOREIGN KEY ("importId") REFERENCES "RectoratImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeacherSnapshot" ADD CONSTRAINT "TeacherSnapshot_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_adherentId_fkey" FOREIGN KEY ("adherentId") REFERENCES "Adherent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComputedPromotionState" ADD CONSTRAINT "ComputedPromotionState_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaSeuil" ADD CONSTRAINT "BaSeuil_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "Campagne"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaSeuil" ADD CONSTRAINT "BaSeuil_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
