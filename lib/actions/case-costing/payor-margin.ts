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
 *
 * Regression guard: `tests/workflows/facility-payor-contract-margin.spec.ts`.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  lookupReimbursement,
  type PayorCptRate,
} from "@/lib/case-costing/reimbursement-lookup"

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
  totalSpend: number
  totalMargin: number
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

interface SeededRate {
  cpt?: string
  cptCode?: string
  rate?: number
  reimbursement?: number
  description?: string
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

  // cptRates is stored as `{cpt, rate, description}` in the seed but
  // `lookupReimbursement` takes `{cptCode, reimbursement}`. Normalize at
  // the boundary; tolerate either shape so legacy data keeps working.
  const raw = (contract.cptRates as SeededRate[] | null) ?? []
  const rates: PayorCptRate[] = raw.map((r) => ({
    payorType: String(contract.payorType),
    cptCode: String(r.cptCode ?? r.cpt ?? ""),
    reimbursement: Number(r.reimbursement ?? r.rate ?? 0),
  }))

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
  for (const c of cases) {
    totalSpend += Number(c.totalSpend ?? 0)
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
    }
  }

  return {
    payorContractId: contract.id,
    payorName: contract.payorName,
    totalCases: cases.length,
    cptMatched,
    estReimbursement,
    totalSpend,
    totalMargin: estReimbursement - totalSpend,
  }
}
