"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

export interface FacilityPayorContract {
  id: string
  payorName: string
  payorType: string
  contractNumber: string
  effectiveDate: string
  expirationDate: string
  status: string
  cptRates: { cptCode: string; description?: string; rate: number }[]
  implantPassthrough: boolean
  implantMarkup: number
}

export async function getFacilityPayorContracts(): Promise<FacilityPayorContract[]> {
  const { facility } = await requireFacility()

  const contracts = await prisma.payorContract.findMany({
    where: {
      facilityId: facility.id,
      status: "active",
    },
    orderBy: { payorName: "asc" },
  })

  return serialize(
    contracts.map((c) => ({
      id: c.id,
      payorName: c.payorName,
      payorType: c.payorType,
      contractNumber: c.contractNumber,
      effectiveDate: c.effectiveDate.toISOString(),
      expirationDate: c.expirationDate.toISOString(),
      status: c.status,
      cptRates: (c.cptRates as { cptCode: string; description?: string; rate: number }[]) ?? [],
      implantPassthrough: c.implantPassthrough,
      implantMarkup: Number(c.implantMarkup),
    }))
  )
}

/**
 * Calculate margin for cases using a specific payor contract's CPT rates
 */
export async function calculatePayorMargins(input: {
  facilityId?: string
  payorContractId: string
  surgeonName?: string | null
  procedureCpt?: string | null
  dateFrom?: string | null
  dateTo?: string | null
  matchedOnly?: boolean
  sortBy?: "matchedFirst" | "marginDesc" | "marginAsc" | "spendDesc" | "date"
  limit?: number
}) {
  const { facility } = await requireFacility()

  // Scope the case query itself so filters operate on the full dataset
  // server-side (the old version loaded all cases, then sliced to the
  // first 50 regardless of filters — Charles's "pagination only organizes
  // that one page" complaint).
  const caseWhere = {
    facilityId: facility.id,
    ...(input.surgeonName
      ? { surgeonName: { contains: input.surgeonName, mode: "insensitive" as const } }
      : {}),
    ...(input.procedureCpt
      ? {
          OR: [
            { primaryCptCode: input.procedureCpt },
            { procedures: { some: { cptCode: input.procedureCpt } } },
          ],
        }
      : {}),
    ...(input.dateFrom || input.dateTo
      ? {
          dateOfSurgery: {
            ...(input.dateFrom && { gte: new Date(input.dateFrom) }),
            ...(input.dateTo && { lte: new Date(input.dateTo) }),
          },
        }
      : {}),
  }

  const [contract, cases] = await Promise.all([
    prisma.payorContract.findUniqueOrThrow({
      where: { id: input.payorContractId },
    }),
    prisma.case.findMany({ where: caseWhere, include: { procedures: true } }),
  ])

  // Shape-tolerant CPT rate map: accept both {cpt, rate} (seed format)
  // and {cptCode, rate}.
  const cptRates =
    (contract.cptRates as
      | Array<{ cpt?: string; cptCode?: string; rate: number }>
      | null) ?? []
  const rateMap = new Map<string, number>()
  for (const r of cptRates) {
    const code = r.cptCode ?? r.cpt
    if (code && typeof r.rate === "number") rateMap.set(code, r.rate)
  }

  let totalEstimatedReimbursement = 0
  let totalSpend = 0
  let matchedCases = 0

  const allCaseMargins = cases.map((c) => {
    const spend = Number(c.totalSpend)
    totalSpend += spend

    // Try the primary CPT first, then any procedure's CPT (take the
    // highest matching rate). The old implementation only checked
    // primaryCptCode, which misses cases that have procedures rows but
    // no primary flag — exactly the shape the CSV importer writes.
    let reimbursement = 0
    let matched = false
    if (c.primaryCptCode && rateMap.has(c.primaryCptCode)) {
      reimbursement = rateMap.get(c.primaryCptCode)!
      matched = true
    }
    for (const p of c.procedures) {
      if (p.cptCode && rateMap.has(p.cptCode)) {
        const r = rateMap.get(p.cptCode)!
        if (r > reimbursement) reimbursement = r
        matched = true
      }
    }
    if (!matched) {
      // Last resort: fall back to whatever's stored on the case row.
      reimbursement = Number(c.totalReimbursement)
      if (reimbursement > 0) matched = true
    }
    if (matched) matchedCases++
    totalEstimatedReimbursement += reimbursement

    return {
      caseId: c.id,
      caseNumber: c.caseNumber,
      surgeonName: c.surgeonName,
      primaryCptCode: c.primaryCptCode,
      dateOfSurgery: c.dateOfSurgery,
      spend,
      estimatedReimbursement: reimbursement,
      margin: reimbursement - spend,
      marginPercent:
        reimbursement > 0 ? ((reimbursement - spend) / reimbursement) * 100 : 0,
      matched,
    }
  })

  // Filter to matched-only if requested (default false — Charles's
  // callers may want to see the full list, we just sort so matched
  // surfaces first).
  const filtered = input.matchedOnly
    ? allCaseMargins.filter((c) => c.matched)
    : allCaseMargins

  const sortBy = input.sortBy ?? "matchedFirst"
  filtered.sort((a, b) => {
    switch (sortBy) {
      case "marginDesc":
        return b.margin - a.margin
      case "marginAsc":
        return a.margin - b.margin
      case "spendDesc":
        return b.spend - a.spend
      case "date":
        return (
          new Date(b.dateOfSurgery).getTime() -
          new Date(a.dateOfSurgery).getTime()
        )
      case "matchedFirst":
      default:
        // Matched cases first, then highest margin, then highest spend.
        // Puts the interesting rows on page 1 instead of filling it
        // with unmatched zero-reimbursement rows.
        if (a.matched !== b.matched) return a.matched ? -1 : 1
        if (b.margin !== a.margin) return b.margin - a.margin
        return b.spend - a.spend
    }
  })

  const limit = input.limit ?? 500
  return serialize({
    payorName: contract.payorName,
    totalCases: cases.length,
    matchedCases,
    totalSpend,
    totalEstimatedReimbursement,
    totalMargin: totalEstimatedReimbursement - totalSpend,
    avgMarginPercent:
      totalEstimatedReimbursement > 0
        ? ((totalEstimatedReimbursement - totalSpend) /
            totalEstimatedReimbursement) *
          100
        : 0,
    caseMargins: filtered.slice(0, limit),
  })
}
