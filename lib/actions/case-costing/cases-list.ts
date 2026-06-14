"use server"

/**
 * Case-costing — cases list server action.
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4.1.
 * Loads a facility's cases with enough data to render the list page
 * (supplies for margin, procedures for CPT display, payor for
 * reimbursement lookup). Consumers pair this with:
 *   - lib/case-costing/filter-cases.ts::filterCases
 *   - lib/case-costing/sort-cases.ts::sortCases
 *   - lib/case-costing/score-calc.ts::calculateMargin
 *   - lib/case-costing/reimbursement-lookup.ts::bulkLookupReimbursement
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import {
  buildCptRateMap,
  resolveCaseReimbursement,
} from "@/lib/case-costing/cpt-rate-map"

export interface GetCasesForFacilityFilters {
  dateFrom?: string | Date | null
  dateTo?: string | Date | null
  surgeons?: string[]
  cptCodes?: string[]
  limit?: number
}

export async function getCasesForFacility(
  filters: GetCasesForFacilityFilters = {},
) {
  const { facility } = await requireFacility()

  const dateFrom = toDate(filters.dateFrom)
  const dateTo = toDate(filters.dateTo)
  const limit = filters.limit ?? 500

  const [cases, payorContracts] = await Promise.all([
    prisma.case.findMany({
      where: {
        facilityId: facility.id,
        ...(dateFrom && { dateOfSurgery: { gte: dateFrom } }),
        ...(dateTo && !dateFrom && { dateOfSurgery: { lte: dateTo } }),
        ...(dateFrom && dateTo && { dateOfSurgery: { gte: dateFrom, lte: dateTo } }),
        ...(filters.surgeons &&
          filters.surgeons.length > 0 && {
            surgeonName: { in: filters.surgeons },
          }),
        ...(filters.cptCodes &&
          filters.cptCodes.length > 0 && {
            primaryCptCode: { in: filters.cptCodes },
          }),
      },
      take: limit,
      orderBy: { dateOfSurgery: "desc" },
      include: {
        supplies: {
          select: {
            id: true,
            vendorItemNo: true,
            materialName: true,
            usedCost: true,
            quantity: true,
            extendedCost: true,
            contractId: true,
          },
        },
        procedures: {
          select: {
            id: true,
            cptCode: true,
          },
        },
      },
    }),
    prisma.payorContract.findMany({
      where: { facilityId: facility.id, status: "active" },
      select: { cptRates: true },
    }),
  ])

  // 2026-06-14: the Reimb./Margin columns read raw `totalReimbursement`
  // (0 for most rows) → "—". Backfill each case's reimbursement from the
  // canonical CPT-rate map (same helper as the hero card, surgeon
  // scorecards, and the report) and recompute margin so the list, surgeon
  // margin%, and Financial tab all agree.
  const cptRateMap = buildCptRateMap(payorContracts)
  const withReimbursement = cases.map((c) => {
    const reimbursement = resolveCaseReimbursement(
      {
        storedReimbursement: Number(c.totalReimbursement),
        primaryCptCode: c.primaryCptCode,
        procedureCptCodes: c.procedures.map((p) => p.cptCode),
      },
      cptRateMap,
    )
    return {
      ...c,
      totalReimbursement: reimbursement,
      margin: reimbursement - Number(c.totalSpend),
    }
  })

  return serialize(withReimbursement)
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  if (v instanceof Date) return v
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Returns just the distinct surgeons at this facility (for the filter
 * dropdown on the cases list page).
 */
export async function getSurgeonsForFacility(): Promise<string[]> {
  const { facility } = await requireFacility()

  const rows = await prisma.case.groupBy({
    by: ["surgeonName"],
    where: {
      facilityId: facility.id,
      surgeonName: { not: null },
    },
  })

  return rows
    .map((r) => r.surgeonName)
    .filter((n): n is string => n !== null)
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Returns distinct primary CPT codes at this facility (for the filter
 * dropdown).
 */
export async function getCptCodesForFacility(): Promise<string[]> {
  const { facility } = await requireFacility()

  const rows = await prisma.case.groupBy({
    by: ["primaryCptCode"],
    where: {
      facilityId: facility.id,
      primaryCptCode: { not: null },
    },
  })

  return rows
    .map((r) => r.primaryCptCode)
    .filter((c): c is string => c !== null)
    .sort((a, b) => a.localeCompare(b))
}
