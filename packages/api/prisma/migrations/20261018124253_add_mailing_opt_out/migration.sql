-- CreateTable
CREATE TABLE "MailingOptOut" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "nom" TEXT,
    "prenom" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campagneId" TEXT,
    "teacherId" TEXT,

    CONSTRAINT "MailingOptOut_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailingOptOut_email_idx" ON "MailingOptOut"("email");

-- CreateIndex
CREATE INDEX "MailingOptOut_nom_prenom_idx" ON "MailingOptOut"("nom", "prenom");
