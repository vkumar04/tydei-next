-- CreateTable
CREATE TABLE "proposal_evaluation" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "overallScore" DOUBLE PRECISION,
    "verdict" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proposal_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposal_evaluation_facilityId_idx" ON "proposal_evaluation"("facilityId");

-- AddForeignKey
ALTER TABLE "proposal_evaluation" ADD CONSTRAINT "proposal_evaluation_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
