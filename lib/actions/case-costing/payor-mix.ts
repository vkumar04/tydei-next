"use server"

/**
 * Case-costing — payor-mix server action.
 *
 * (Subsystem 0 — payor-mix summary used by surgeon scorecards and reports).
 *
 * Thin wrapper around `computePayorMix` in `lib/case-costing/payor-mix.ts`.
 *
 * Schema note:
 *   - Payor data lives on `Case.payorClass` (audit M8 — an earlier note here
 *     claimed no payor column existed, which went stale once the schema grew
 *     `payorClass`). Raw classes are mapped to the canonical buckets via
 *     `classifyPayorClass`; cases without a payorClass still surface under
 *     `casesWithoutPayor`.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import {
  computePayorMix,
  classifyPayorClass,
  type CaseWithPayor,
  type PayorMixSummary,
} from "@/lib/case-costing/payor-mix"

export async function getFacilityPayorMix(): Promise<PayorMixSummary> {
  const { facility, user } = await requireFacility()

  const cases = await prisma.case.findMany({
    where: { facilityId: facility.id },
    select: {
      payorClass: true,
      totalReimbursement: true,
    },
  })

  const input: CaseWithPayor[] = cases.map((c) => ({
    payorType: classifyPayorClass(c.payorClass),
    totalReimbursement: Number(c.totalReimbursement),
  }))

  const summary = computePayorMix(input)

  await logAudit({
    userId: user.id,
    action: "case_costing.payor_mix_viewed",
    entityType: "facility",
    entityId: facility.id,
    metadata: {
      caseCount: input.length,
      casesWithoutPayor: summary.casesWithoutPayor,
    },
  })

  return serialize(summary)
}
