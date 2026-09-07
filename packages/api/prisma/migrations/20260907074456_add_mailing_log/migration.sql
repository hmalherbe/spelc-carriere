-- CreateEnum
CREATE TYPE "MailingStatus" AS ENUM ('SENT', 'FAILED');

-- CreateTable
CREATE TABLE "MailingLog" (
    "id" TEXT NOT NULL,
    "campagneId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "adherentId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "MailingStatus" NOT NULL,
    "error" TEXT,
    "brevoMessageId" TEXT,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailingLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailingLog_campagneId_idx" ON "MailingLog"("campagneId");

-- CreateIndex
CREATE UNIQUE INDEX "MailingLog_campagneId_teacherId_key" ON "MailingLog"("campagneId", "teacherId");

-- AddForeignKey
ALTER TABLE "MailingLog" ADD CONSTRAINT "MailingLog_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "Campagne"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailingLog" ADD CONSTRAINT "MailingLog_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
