-- CreateEnum
CREATE TYPE "AccessTier" AS ENUM ('super', 'advanced', 'user');

-- CreateEnum
CREATE TYPE "connection_mode" AS ENUM ('one_way', 'two_way');

-- AlterTable
ALTER TABLE "connection" ADD COLUMN     "mode" "connection_mode" NOT NULL DEFAULT 'two_way',
ADD COLUMN     "vendorDivisionId" TEXT;

-- AlterTable
ALTER TABLE "contract" ADD COLUMN     "vendorDivisionId" TEXT;

-- AlterTable
ALTER TABLE "member" ADD COLUMN     "accessTier" "AccessTier" NOT NULL DEFAULT 'super';

-- AlterTable
ALTER TABLE "vendor_division" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "division_member" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "division_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facility_assignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facility_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_cog_record" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorDivisionId" TEXT,
    "facilityId" TEXT,
    "vendorName" TEXT,
    "inventoryNumber" TEXT NOT NULL,
    "inventoryDescription" TEXT NOT NULL,
    "vendorItemNo" TEXT,
    "manufacturerNo" TEXT,
    "poNumber" TEXT,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "extendedPrice" DECIMAL(14,2),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "transactionDate" DATE NOT NULL,
    "category" TEXT,
    "notes" TEXT,
    "matchStatus" "COGMatchStatus" NOT NULL DEFAULT 'pending',
    "contractId" TEXT,
    "contractPrice" DECIMAL(12,2),
    "isOnContract" BOOLEAN NOT NULL DEFAULT false,
    "savingsAmount" DECIMAL(14,2),
    "variancePercent" DECIMAL(6,2),
    "fileImportId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_cog_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "division_member_userId_idx" ON "division_member"("userId");

-- CreateIndex
CREATE INDEX "division_member_divisionId_idx" ON "division_member"("divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "division_member_divisionId_userId_key" ON "division_member"("divisionId", "userId");

-- CreateIndex
CREATE INDEX "facility_assignment_userId_idx" ON "facility_assignment"("userId");

-- CreateIndex
CREATE INDEX "facility_assignment_facilityId_idx" ON "facility_assignment"("facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "facility_assignment_userId_facilityId_key" ON "facility_assignment"("userId", "facilityId");

-- CreateIndex
CREATE INDEX "vendor_cog_record_vendorId_idx" ON "vendor_cog_record"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_cog_record_vendorDivisionId_idx" ON "vendor_cog_record"("vendorDivisionId");

-- CreateIndex
CREATE INDEX "vendor_cog_record_transactionDate_idx" ON "vendor_cog_record"("transactionDate");

-- CreateIndex
CREATE INDEX "vendor_cog_record_vendorItemNo_idx" ON "vendor_cog_record"("vendorItemNo");

-- CreateIndex
CREATE INDEX "vendor_cog_record_contractId_idx" ON "vendor_cog_record"("contractId");

-- CreateIndex
CREATE INDEX "vendor_cog_record_vendorId_transactionDate_idx" ON "vendor_cog_record"("vendorId", "transactionDate");

-- CreateIndex
CREATE INDEX "connection_vendorDivisionId_idx" ON "connection"("vendorDivisionId");

-- CreateIndex
CREATE INDEX "contract_vendorDivisionId_idx" ON "contract"("vendorDivisionId");

-- CreateIndex
CREATE INDEX "vendor_division_vendorId_idx" ON "vendor_division"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_division_vendorId_code_key" ON "vendor_division"("vendorId", "code");

-- AddForeignKey
ALTER TABLE "division_member" ADD CONSTRAINT "division_member_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "vendor_division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "division_member" ADD CONSTRAINT "division_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_assignment" ADD CONSTRAINT "facility_assignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facility_assignment" ADD CONSTRAINT "facility_assignment_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_vendorDivisionId_fkey" FOREIGN KEY ("vendorDivisionId") REFERENCES "vendor_division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_cog_record" ADD CONSTRAINT "vendor_cog_record_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_cog_record" ADD CONSTRAINT "vendor_cog_record_vendorDivisionId_fkey" FOREIGN KEY ("vendorDivisionId") REFERENCES "vendor_division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection" ADD CONSTRAINT "connection_vendorDivisionId_fkey" FOREIGN KEY ("vendorDivisionId") REFERENCES "vendor_division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

