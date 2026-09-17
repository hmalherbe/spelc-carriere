-- DropForeignKey
ALTER TABLE "BaSeuil" DROP CONSTRAINT "BaSeuil_campagneId_fkey";

-- DropForeignKey
ALTER TABLE "BaSeuil" DROP CONSTRAINT "BaSeuil_lockedById_fkey";

-- DropTable
DROP TABLE "BaSeuil";

