"use server"

/**
 * Case-costing — payor-mix server action.
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md
 * (Subsystem 0 — payor-mix summary used by surgeon scorecards and reports).
 *
 * Thin wrapper around `computePayorMix` in `lib/case-costing/payor-mix.ts`.
 *
 * Schema note:
 *   - `Case` currently has no direct `payorType` column. Until the model grows
 *     one (or a `Payor` join), every case is surfaced under `casesWithoutPayor`
 *     and every `shares` entry stays at 0. The pure helper handles this safely.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import {
  computePayorMix,
  type CaseWithPayor,
  type PayorMixSummary,
} from "@/lib/case-costing/payor-mix"

export async function getFacilityPayorMix(): Promise<PayorMixSummary> {
  const { facility, user } = await requireFacility()

  const cases = await prisma.case.findMany({
    where: { facilityId: facility.id },
    select: {
      totalReimbursement: true,
    },
  })

  const input: CaseWithPayor[] = cases.map((c) => ({
    // Case.payorType does not exist on the current schema — see file header.
    payorType: null,
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
