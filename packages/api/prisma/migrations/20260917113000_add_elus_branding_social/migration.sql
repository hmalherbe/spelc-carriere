-- CreateEnum
CREATE TYPE "EluRole" AS ENUM ('TITULAIRE', 'SUPPLEANT');

-- CreateTable
CREATE TABLE "Elu" (
    "id" TEXT NOT NULL,
    "commission" "AdelSyncType" NOT NULL,
    "role" "EluRole" NOT NULL,
    "prenom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Elu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailingBranding" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "t1Text" TEXT,
    "logoData" BYTEA,
    "logoContentType" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "MailingBranding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialLink" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SocialLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Elu_commission_idx" ON "Elu"("commission");

