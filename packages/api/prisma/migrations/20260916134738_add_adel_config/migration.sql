-- CreateTable
CREATE TABLE "AdelConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "loginUrl" TEXT,
    "username" TEXT,
    "passwordEncrypted" TEXT,
    "spelcName" TEXT NOT NULL DEFAULT 'azur',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "AdelConfig_pkey" PRIMARY KEY ("id")
);
