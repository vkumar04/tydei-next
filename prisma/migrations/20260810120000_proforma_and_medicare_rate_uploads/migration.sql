-- CreateTable
CREATE TABLE "proforma_statement" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "facilityKey" TEXT NOT NULL,
    "facilityId" TEXT,
    "facilityLabel" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "lineItems" JSONB NOT NULL,
    "matchedFields" JSONB NOT NULL DEFAULT '[]',
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proforma_statement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicare_rate_set" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rates" JSONB NOT NULL,
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicare_rate_set_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "proforma_statement_vendorId_facilityKey_key" ON "proforma_statement"("vendorId", "facilityKey");

-- CreateIndex
CREATE INDEX "proforma_statement_vendorId_idx" ON "proforma_statement"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "medicare_rate_set_vendorId_name_key" ON "medicare_rate_set"("vendorId", "name");

-- CreateIndex
CREATE INDEX "medicare_rate_set_vendorId_idx" ON "medicare_rate_set"("vendorId");

-- AddForeignKey
ALTER TABLE "proforma_statement" ADD CONSTRAINT "proforma_statement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proforma_statement" ADD CONSTRAINT "proforma_statement_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicare_rate_set" ADD CONSTRAINT "medicare_rate_set_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
