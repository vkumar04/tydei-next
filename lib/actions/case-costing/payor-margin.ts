"use server"

/**
 * Payor Contract Margin — list + summary.
 *
 * Exposes two facility-scoped server actions backing the
 * `PayorContractMarginCard` on /dashboard/case-costing:
 *
 *   1. `getPayorContractsForFacility` — dropdown options.
 *   2. `getPayorContractMarginSummary(payorContractId)` — totals the
 *      facility's Case rows against the contract's `cptRates` JSON,
 *      returning Est. Reimbursement + CPT Matched + Total Margin.
 *
 * Uses the existing pure reimbursement lookup in
 * `lib/case-costing/reimbursement-lookup.ts` so the math is shared with
 * the Cases list + Financial tabs (no drift).
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  lookupReimbursement,
  type PayorCptRate,
} from "@/lib/case-costing/reimbursement-lookup"
import {
  normalizePayorCptRates,
  type StoredPayorRate,
} from "@/lib/case-costing/payor-rate-normalize"

export interface PayorContractOption {
  id: string
  label: string
}

export interface PayorContractMarginSummary {
  payorContractId: string
  payorName: string
  totalCases: number
  cptMatched: number
  estReimbursement: number
  /** Spend across ALL the facility's cases (matched + unmatched). */
  totalSpend: number
  /** Spend across CPT-matched cases only — the margin denominator. */
  matchedSpend: number
  /**
   * Audit M12: margin over MATCHED cases only (matched reimbursement −
   * matched spend). The old number subtracted ALL-case spend from
   * matched-only reimbursement, which went arbitrarily negative as
   * unmatched cases accumulated.
   */
  totalMargin: number
  unmatchedCases: number
  unmatchedSpend: number
}

export async function getPayorContractsForFacility(): Promise<
  PayorContractOption[]
> {
  const { facility } = await requireFacility()
  const rows = await prisma.payorContract.findMany({
    where: { facilityId: facility.id, status: "active" },
    select: { id: true, payorName: true, contractNumber: true },
    orderBy: [{ payorName: "asc" }, { contractNumber: "asc" }],
  })
  return rows.map((r) => ({
    id: r.id,
    label: `${r.payorName} — ${r.contractNumber}`,
  }))
}


export async function getPayorContractMarginSummary(
  payorContractId: string,
): Promise<PayorContractMarginSummary | null> {
  const { facility } = await requireFacility()

  const contract = await prisma.payorContract.findFirst({
    where: { id: payorContractId, facilityId: facility.id },
    select: {
      id: true,
      payorName: true,
      payorType: true,
      cptRates: true,
    },
  })
  if (!contract) return null

  // Normalization lives in lib/case-costing/payor-rate-normalize.ts so it is
  // reachable by tests. Inline here it dropped `effectiveDate` for months
  // with the whole suite green, because nothing could call it without a
  // database and a session.
  const rates: PayorCptRate[] = normalizePayorCptRates(
    contract.cptRates as StoredPayorRate[] | null,
    String(contract.payorType),
  )

  const cases = await prisma.case.findMany({
    where: { facilityId: facility.id },
    select: {
      id: true,
      primaryCptCode: true,
      dateOfSurgery: true,
      totalSpend: true,
    },
  })

  let cptMatched = 0
  let estReimbursement = 0
  let totalSpend = 0
  let matchedSpend = 0
  for (const c of cases) {
    const spend = Number(c.totalSpend ?? 0)
    totalSpend += spend
    const lookup = lookupReimbursement(
      {
        primaryCptCode: c.primaryCptCode,
        payorType: String(contract.payorType),
        dateOfSurgery: new Date(c.dateOfSurgery),
      },
      rates,
    )
    if (lookup.source !== "not_found" && lookup.reimbursement > 0) {
      cptMatched++
      estReimbursement += lookup.reimbursement
      matchedSpend += spend
    }
  }

  return {
    payorContractId: contract.id,
    payorName: contract.payorName,
    totalCases: cases.length,
    cptMatched,
    estReimbursement,
    totalSpend,
    matchedSpend,
    // Audit M12: margin over matched cases only — see interface note.
    totalMargin: estReimbursement - matchedSpend,
    unmatchedCases: cases.length - cptMatched,
    unmatchedSpend: totalSpend - matchedSpend,
  }
}
