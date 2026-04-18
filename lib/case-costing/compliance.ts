/**
 * Case-costing contract compliance pure helpers.
 *
 * Computes per-case on-contract vs. off-contract supply spend and rolls up
 * facility-level totals. Supplies are expected to be pre-enriched with an
 * `isOnContract` flag (typically produced by the COG enrichment pipeline);
 * this module does not look up contract eligibility itself.
 *
 * Design invariants:
 *  - Pure. No Prisma imports. Callers shape data into `CaseForCompliance[]`.
 *  - Per-case result order preserved from input.
 *  - Zero-supply cases → compliance percent of 0 (not NaN).
 *  - Compliance percent is a 0-100 scalar (not 0-1 fraction).
 *  - Facility summary flags cases with compliancePercent < 80 as low.
 */

const LOW_COMPLIANCE_THRESHOLD = 80

export interface CaseForCompliance {
  caseId: string
  supplies: Array<{
    vendorItemNo: string | null
    isOnContract: boolean // pre-enriched by COG enrichment
    extendedCost: number
  }>
}

export interface CaseComplianceResult {
  caseId: string
  totalSupplySpend: number
  onContractSpend: number
  offContractSpend: number
  /** 0-100 scalar. 0 when totalSupplySpend is 0. */
  compliancePercent: number
  suppliesTotal: number
  suppliesOnContract: number
}

export interface FacilityComplianceSummary {
  totalSupplySpend: number
  onContractSpend: number
  offContractSpend: number
  /** 0-100 scalar. 0 when totalSupplySpend is 0. */
  compliancePercent: number
  /** Count of cases with compliancePercent < 80. */
  casesWithLowCompliance: number
}

export function computeCaseCompliance(
  cases: CaseForCompliance[],
): CaseComplianceResult[] {
  return cases.map((c) => {
    let onContractSpend = 0
    let offContractSpend = 0
    let suppliesOnContract = 0
    const suppliesTotal = c.supplies.length

    for (const s of c.supplies) {
      const cost = Number.isFinite(s.extendedCost) ? s.extendedCost : 0
      if (s.isOnContract) {
        onContractSpend += cost
        suppliesOnContract += 1
      } else {
        offContractSpend += cost
      }
    }

    const totalSupplySpend = onContractSpend + offContractSpend
    const compliancePercent =
      totalSupplySpend > 0 ? (onContractSpend / totalSupplySpend) * 100 : 0

    return {
      caseId: c.caseId,
      totalSupplySpend,
      onContractSpend,
      offContractSpend,
      compliancePercent,
      suppliesTotal,
      suppliesOnContract,
    }
  })
}

export function summarizeFacilityCompliance(
  cases: CaseComplianceResult[],
): FacilityComplianceSummary {
  let totalSupplySpend = 0
  let onContractSpend = 0
  let offContractSpend = 0
  let casesWithLowCompliance = 0

  for (const c of cases) {
    totalSupplySpend += c.totalSupplySpend
    onContractSpend += c.onContractSpend
    offContractSpend += c.offContractSpend
    if (c.compliancePercent < LOW_COMPLIANCE_THRESHOLD) {
      casesWithLowCompliance += 1
    }
  }

  const compliancePercent =
    totalSupplySpend > 0 ? (onContractSpend / totalSupplySpend) * 100 : 0

  return {
    totalSupplySpend,
    onContractSpend,
    offContractSpend,
    compliancePercent,
    casesWithLowCompliance,
  }
}
