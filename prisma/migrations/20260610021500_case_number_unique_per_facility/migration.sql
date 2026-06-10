-- 2026-06-09 audit BLOCKER: caseNumber was globally unique, so facility B
-- importing a colliding EHR-local case number ("CASE-0001") hijacked or
-- merged facility A's case. Uniqueness is per-facility.
--
-- Safe on prod data: all existing cases belong to a single facility and
-- caseNumber is already distinct (verified 2026-06-09: 674 rows, distinct
-- count = row count).

-- DropIndex
DROP INDEX "case_record_caseNumber_key";

-- CreateIndex
CREATE UNIQUE INDEX "case_record_facilityId_caseNumber_key" ON "case_record"("facilityId", "caseNumber");
