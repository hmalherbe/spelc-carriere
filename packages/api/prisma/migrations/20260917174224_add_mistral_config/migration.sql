-- CreateTable
CREATE TABLE "MistralConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "apiKeyEncrypted" TEXT,
    "model" TEXT NOT NULL DEFAULT 'mistral-large-latest',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "MistralConfig_pkey" PRIMARY KEY ("id")
);
