-- CreateEnum
CREATE TYPE "MailingKind" AS ENUM ('RESULTAT', 'RECLASSEMENT');

-- AlterTable
ALTER TABLE "MailingLog" ADD COLUMN     "kind" "MailingKind" NOT NULL DEFAULT 'RESULTAT';

-- DropIndex (previous 2-column unique, superseded below — every existing row becomes RESULTAT via
-- the column default above, so this is lossless)
DROP INDEX "MailingLog_campagneId_teacherId_key";

-- CreateIndex
CREATE UNIQUE INDEX "MailingLog_campagneId_teacherId_kind_key" ON "MailingLog"("campagneId", "teacherId", "kind");
