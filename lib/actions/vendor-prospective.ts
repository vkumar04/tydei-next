"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import {
  analyzeVendorProspective,
  type BenchmarkDataPoint,
  type CapitalDealDetails,
  type VendorContractVariant,
  type VendorFacilityType,
  type VendorPricingScenario,
  type VendorProspectiveInput,
  type VendorProspectiveResult,
} from "@/lib/prospective-analysis/vendor-prospective-analyzer"

// ─── Input shape ───────────────────────────────────────────────

/**
 * Caller-supplied portion of a vendor prospective analysis request.
 *
 * We accept the user-entered scenario inputs (price/volume/rebate per
 * scenario), the target margin floors, and an optional capital block
 * + an optional reference to a stored proposal alert from
 * `createProposal`. The action backfills facility metadata and pulls
 * benchmarks scoped to the calling vendor.
 */
export interface VendorProspectiveAnalysisInput {
  facilityId: string
  contractVariant: VendorContractVariant
  pricingScenarios: VendorPricingScenario[]
  /** Decimal targets, e.g. 0.40 = 40%. */
  targetGrossMarginPercent: number
  minimumAcceptableGrossMarginPercent: number
  facilityEstimatedAnnualSpend?: number
  facilityCurrentVendorShare?: number
  targetVendorShare?: number
  capitalDetails?: CapitalDealDetails
  /** Optional alert id from `createProposal` — used to pull pricing items
   *  and seed benchmark lookups when the caller doesn't have them yet. */
  proposalAlertId?: string
}

// ─── Action ────────────────────────────────────────────────────

export async function getVendorProspectiveAnalysis(
  input: VendorProspectiveAnalysisInput,
): Promise<VendorProspectiveResult> {
  const { vendor } = await requireVendor()

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: input.facilityId },
    select: { id: true, name: true, type: true, beds: true },
  })

  // Pull benchmarks (vendor-scoped + national) for the calling vendor.
  // Mirror getVendorBenchmarks but trimmed to the columns the analyzer
  // needs.
  const benchmarkRows = await prisma.productBenchmark.findMany({
    where: {
      OR: [{ vendorId: vendor.id }, { vendorId: null }],
    },
    select: {
      vendorItemNo: true,
      category: true,
      nationalAvgPrice: true,
    },
    take: 200,
  })

  const benchmarks: BenchmarkDataPoint[] = benchmarkRows.map((b) => ({
    vendorItemNo: b.vendorItemNo,
    category: b.category,
    nationalAvgPrice: b.nationalAvgPrice ? Number(b.nationalAvgPrice) : null,
    // ProductBenchmark has no internal-vendor-cost column today;
    // analyzer falls back to the 55% gross-margin assumption.
    internalListPrice: null,
    internalUnitCost: null,
  }))

  // Estimate facility's annual category spend from COG when caller didn't
  // supply it. Pulls trailing-12mo extendedPrice for this vendor at this
  // facility, since that's the only vendor-portal-visible signal.
  let facilityEstimatedAnnualSpend = input.facilityEstimatedAnnualSpend
  if (facilityEstimatedAnnualSpend == null) {
    const oneYearAgo = new Date()
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
    const agg = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        vendorId: vendor.id,
        transactionDate: { gte: oneYearAgo },
      },
      _sum: { extendedPrice: true },
    })
    facilityEstimatedAnnualSpend = Number(agg._sum?.extendedPrice ?? 0)
  }

  const facilityType = mapFacilityType(facility.type)

  const analyzerInput: VendorProspectiveInput = {
    facilityId: facility.id,
    facilityName: facility.name,
    facilityType,
    contractVariant: input.contractVariant,
    pricingScenarios: input.pricingScenarios,
    benchmarks,
    facilityEstimatedAnnualSpend,
    facilityCurrentVendorShare: input.facilityCurrentVendorShare,
    targetVendorShare: input.targetVendorShare,
    capitalDetails: input.capitalDetails,
    targetGrossMarginPercent: input.targetGrossMarginPercent,
    minimumAcceptableGrossMarginPercent:
      input.minimumAcceptableGrossMarginPercent,
  }

  const result = analyzeVendorProspective(analyzerInput)
  return serialize(result)
}

// ─── Helpers ───────────────────────────────────────────────────

function mapFacilityType(t: string): VendorFacilityType {
  // Prisma enum: hospital | asc | clinic | surgery_center
  // Charles enum: HOSPITAL | ASC | IDN | CLINIC
  switch (t) {
    case "hospital":
      return "HOSPITAL"
    case "asc":
    case "surgery_center":
      return "ASC"
    case "clinic":
      return "CLINIC"
    default:
      return "HOSPITAL"
  }
}
