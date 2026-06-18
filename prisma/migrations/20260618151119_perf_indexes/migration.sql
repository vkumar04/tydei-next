-- CreateIndex
CREATE INDEX "case_record_facilityId_dateOfSurgery_idx" ON "case_record"("facilityId", "dateOfSurgery");

-- CreateIndex
CREATE INDEX "cog_record_contractId_transactionDate_idx" ON "cog_record"("contractId", "transactionDate");
