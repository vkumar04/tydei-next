-- AlterTable
ALTER TABLE "pending_contract" ADD COLUMN     "vendorDivisionId" TEXT;

-- CreateIndex
CREATE INDEX "pending_contract_vendorDivisionId_idx" ON "pending_contract"("vendorDivisionId");

-- AddForeignKey
ALTER TABLE "pending_contract" ADD CONSTRAINT "pending_contract_vendorDivisionId_fkey" FOREIGN KEY ("vendorDivisionId") REFERENCES "vendor_division"("id") ON DELETE SET NULL ON UPDATE CASCADE;
