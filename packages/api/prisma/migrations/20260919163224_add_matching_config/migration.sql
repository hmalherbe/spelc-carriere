-- CreateTable
CREATE TABLE "MatchingConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "minSuggestionThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.55,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "MatchingConfig_pkey" PRIMARY KEY ("id")
);
