-- CreateTable
CREATE TABLE "MailingEvent" (
    "id" TEXT NOT NULL,
    "mailingLogId" TEXT,
    "brevoMessageId" TEXT,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB NOT NULL,

    CONSTRAINT "MailingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailingEvent_mailingLogId_idx" ON "MailingEvent"("mailingLogId");

-- CreateIndex
CREATE INDEX "MailingEvent_brevoMessageId_idx" ON "MailingEvent"("brevoMessageId");

-- CreateIndex
CREATE INDEX "MailingLog_brevoMessageId_idx" ON "MailingLog"("brevoMessageId");

-- AddForeignKey
ALTER TABLE "MailingEvent" ADD CONSTRAINT "MailingEvent_mailingLogId_fkey" FOREIGN KEY ("mailingLogId") REFERENCES "MailingLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
