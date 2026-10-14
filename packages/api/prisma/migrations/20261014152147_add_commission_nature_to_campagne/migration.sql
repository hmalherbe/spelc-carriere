-- CreateEnum
CREATE TYPE "Commission" AS ENUM ('CCMA', 'CCMI');

-- CreateEnum
CREATE TYPE "CampagneNature" AS ENUM ('ECHELON', 'HC', 'EXC');

-- AlterTable
ALTER TABLE "Campagne" ADD COLUMN     "commission" "Commission",
ADD COLUMN     "nature" "CampagneNature";

-- Backfill every existing campagne from its own `type` — fully deterministic, see
-- Campagne.commission/nature's own doc comments in schema.prisma for why this mapping is exact and
-- lossless for CCMA/CCMI (nature=ECHELON, commission=type itself) and only leaves `commission` null
-- for an HC/EXC campagne (ambiguous from `type` alone — none exist yet in production at the time of
-- this migration, so nothing is actually left ambiguous by it in practice).
UPDATE "Campagne" SET "nature" = 'ECHELON', "commission" = 'CCMA' WHERE "type" = 'CCMA';
UPDATE "Campagne" SET "nature" = 'ECHELON', "commission" = 'CCMI' WHERE "type" = 'CCMI';
UPDATE "Campagne" SET "nature" = 'HC' WHERE "type" = 'HC';
UPDATE "Campagne" SET "nature" = 'EXC' WHERE "type" = 'EXC';
