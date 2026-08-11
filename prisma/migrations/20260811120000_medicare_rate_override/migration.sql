-- CreateTable
CREATE TABLE "medicare_rate_override" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "label" TEXT,
    "code" TEXT NOT NULL,
    "medicareRate" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicare_rate_override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "medicare_rate_override_vendorId_group_key" ON "medicare_rate_override"("vendorId", "group");

-- CreateIndex
CREATE INDEX "medicare_rate_override_vendorId_idx" ON "medicare_rate_override"("vendorId");

-- AddForeignKey
ALTER TABLE "medicare_rate_override" ADD CONSTRAINT "medicare_rate_override_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
