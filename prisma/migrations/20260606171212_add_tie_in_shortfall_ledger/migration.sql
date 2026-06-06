-- CreateTable
CREATE TABLE "contract_tie_in_shortfall_ledger" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "lineItemId" TEXT,
    "periodNumber" INTEGER NOT NULL,
    "scheduledDue" DECIMAL(14,2) NOT NULL,
    "rebateEarned" DECIMAL(14,2) NOT NULL,
    "periodShortfall" DECIMAL(14,2) NOT NULL,
    "carriedForwardBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "runningBalance" DECIMAL(14,2) NOT NULL,
    "shortfallHandling" "TrueUpShortfallHandling" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_tie_in_shortfall_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_tie_in_shortfall_ledger_contractId_idx" ON "contract_tie_in_shortfall_ledger"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_tie_in_shortfall_ledger_contractId_lineItemId_peri_key" ON "contract_tie_in_shortfall_ledger"("contractId", "lineItemId", "periodNumber");

-- AddForeignKey
ALTER TABLE "contract_tie_in_shortfall_ledger" ADD CONSTRAINT "contract_tie_in_shortfall_ledger_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
