-- CreateTable
CREATE TABLE "ReliquatPromotion" (
    "id" TEXT NOT NULL,
    "campagneId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ReliquatPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReliquatPromotion_campagneId_teacherId_key" ON "ReliquatPromotion"("campagneId", "teacherId");

-- AddForeignKey
ALTER TABLE "ReliquatPromotion" ADD CONSTRAINT "ReliquatPromotion_campagneId_fkey" FOREIGN KEY ("campagneId") REFERENCES "Campagne"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReliquatPromotion" ADD CONSTRAINT "ReliquatPromotion_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "Teacher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
