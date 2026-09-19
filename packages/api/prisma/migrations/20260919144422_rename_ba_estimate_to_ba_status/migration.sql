/*
  Warnings:

  - You are about to drop the column `baEstimate` on the `ComputedPromotionState` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ComputedPromotionState" DROP COLUMN "baEstimate",
ADD COLUMN     "baStatus" TEXT;
