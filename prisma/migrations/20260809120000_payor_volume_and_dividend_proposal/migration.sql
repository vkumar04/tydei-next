-- CreateTable
CREATE TABLE "payor_volume_dataset" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "facilityKey" TEXT NOT NULL,
    "facilityId" TEXT,
    "facilityLabel" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "periods" JSONB NOT NULL DEFAULT '[]',
    "groups" JSONB NOT NULL DEFAULT '[]',
    "totalAnnualizedVolume" INTEGER NOT NULL DEFAULT 0,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payor_volume_dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dividend_proposal" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "facilityKey" TEXT,
    "facilityLabel" TEXT NOT NULL,
    "verdict" TEXT,
    "annualDividendImpact" DOUBLE PRECISION,
    "netPresentValue" DOUBLE PRECISION,
    "paybackYears" DOUBLE PRECISION,
    "noiImpact" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dividend_proposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payor_volume_dataset_vendorId_facilityKey_key" ON "payor_volume_dataset"("vendorId", "facilityKey");

-- CreateIndex
CREATE INDEX "payor_volume_dataset_vendorId_idx" ON "payor_volume_dataset"("vendorId");

-- CreateIndex
CREATE INDEX "dividend_proposal_vendorId_idx" ON "dividend_proposal"("vendorId");

-- AddForeignKey
ALTER TABLE "payor_volume_dataset" ADD CONSTRAINT "payor_volume_dataset_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payor_volume_dataset" ADD CONSTRAINT "payor_volume_dataset_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_proposal" ADD CONSTRAINT "dividend_proposal_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
