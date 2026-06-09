-- AlterTable
ALTER TABLE "pending_contract" ADD COLUMN     "approvedContractId" TEXT;

-- CreateIndex
CREATE INDEX "pending_contract_approvedContractId_idx" ON "pending_contract"("approvedContractId");

-- AddForeignKey
ALTER TABLE "pending_contract" ADD CONSTRAINT "pending_contract_approvedContractId_fkey" FOREIGN KEY ("approvedContractId") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
