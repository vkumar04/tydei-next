-- CreateTable
CREATE TABLE "contract_dcf_link" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_dcf_link_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contract_dcf_link_contractId_proposalId_key" ON "contract_dcf_link"("contractId", "proposalId");
CREATE INDEX "contract_dcf_link_vendorId_idx" ON "contract_dcf_link"("vendorId");
CREATE INDEX "contract_dcf_link_contractId_idx" ON "contract_dcf_link"("contractId");
ALTER TABLE "contract_dcf_link" ADD CONSTRAINT "contract_dcf_link_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_dcf_link" ADD CONSTRAINT "contract_dcf_link_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "contract_dcf_link" ADD CONSTRAINT "contract_dcf_link_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "dividend_proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
