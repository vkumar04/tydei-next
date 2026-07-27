-- CreateTable
CREATE TABLE "vendor_alias" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'vendor',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_alias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_alias_vendorId_idx" ON "vendor_alias"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_alias_normalizedAlias_key" ON "vendor_alias"("normalizedAlias");

-- AddForeignKey
ALTER TABLE "vendor_alias" ADD CONSTRAINT "vendor_alias_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
