-- CreateTable
CREATE TABLE "BrevoConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "apiKeyEncrypted" TEXT,
    "senderEmail" TEXT,
    "senderName" TEXT NOT NULL DEFAULT 'Spelc',
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "testEmail" TEXT,
    "testMaxSends" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "BrevoConfig_pkey" PRIMARY KEY ("id")
);
