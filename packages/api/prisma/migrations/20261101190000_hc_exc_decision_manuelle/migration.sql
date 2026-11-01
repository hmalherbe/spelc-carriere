-- AlterTable
ALTER TABLE "HcExcSnapshot" ADD COLUMN     "decisionManuelle" BOOLEAN;

-- DropTable (remplacé par la décision ligne-à-ligne choixRecteur/decisionManuelle — voir
-- HcExcSnapshot.decisionManuelle's own doc comment)
DROP TABLE "Contingent";
