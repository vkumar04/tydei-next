/**
 * Contract Contribution engine — true-margin v2.
 *
 * Supersedes `lib/contracts/true-margin.ts` by extending its proportional
 * rebate allocation model with a second dimension: active price-reduction
 * benefits captured on on-contract purchases. Every procedure now receives
 * both a rebate slice (cash back) AND a price-reduction slice (dollars saved
 * vs list/pre-contract price), which together form `totalContractBenefit` —
 * the number that feeds true-margin v2.
 *
 * Design invariants:
 * - Pure. No Prisma imports. Callers precompute per-vendor totals.
 * - [A9] Zero-reimbursement / zero-revenue guard: percent outputs clamp to 0
 *   instead of NaN / Infinity when revenue or reimbursement is 0.
 * - Per-procedure allocation is proportional to the procedure's vendor spend
 *   share within each vendor bucket; rebates and price reductions are
 *   allocated independently so a vendor that has only a price reduction
 *   (no cash rebate) still contributes benefit.
 * - Per-vendor roll-ups are surfaced separately so callers can render a
 *   per-vendor breakdown in the UI.
 */

/** A single procedure within a case and the vendor spend it drove. */
export interface ProcedureVendorSpend {
  procedureId: string
  vendorId: string
  /** Dollars spent with the vendor on supplies used in this procedure. */
  vendorSpend: number
}

/** Per-vendor totals: rebate dollars + price-reduction dollars + total spend. */
export interface VendorContractBenefit {
  vendorId: string
  /** Total dollars the case spent with this vendor across all procedures. */
  totalVendorSpend: number
  /** Cash rebate earned on that vendor's spend in this case. */
  rebateAmount: number
  /** Active price-reduction benefit realized on that vendor's on-contract purchases. */
  priceReductionAmount: number
}

export interface AllocateContractBenefitsInput {
  procedures: ProcedureVendorSpend[]
  vendors: VendorContractBenefit[]
}

/** Per-procedure output — rebate + price reduction + sum. */
export interface ProcedureContractAllocation {
  procedureId: string
  rebateAllocation: number
  priceReductionAllocation: number
  totalContractBenefit: number
}

export interface AllocateContractBenefitsResult {
  /** Per-procedure allocations, keyed by procedureId. */
  allocations: Map<string, ProcedureContractAllocation>
  /** Per-vendor rebate dollars allocated to procedures from that vendor. */
  vendorRebateAllocations: Map<string, number>
  /** Per-vendor price-reduction dollars allocated to procedures from that vendor. */
  vendorPriceReductionAllocations: Map<string, number>
}

/**
 * Allocate contract benefits (rebates + price reductions) across procedures
 * in proportion to each procedure's share of vendor spend. Both dimensions
 * are allocated independently per vendor; zero-spend vendors allocate 0.
 */
export function allocateContractBenefitsToProcedures(
  input: AllocateContractBenefitsInput,
): AllocateContractBenefitsResult {
  const allocations = new Map<string, ProcedureContractAllocation>()
  const vendorRebateAllocations = new Map<string, number>()
  const vendorPriceReductionAllocations = new Map<string, number>()

  // Seed every procedure with zeroed allocations so callers get deterministic
  // output even when a procedure had no vendor spend.
  for (const p of input.procedures) {
    if (!allocations.has(p.procedureId)) {
      allocations.set(p.procedureId, {
        procedureId: p.procedureId,
        rebateAllocation: 0,
        priceReductionAllocation: 0,
        totalContractBenefit: 0,
      })
    }
  }

  // Seed vendor roll-ups with zeroes so every vendor appears in the output.
  for (const v of input.vendors) {
    if (!vendorRebateAllocations.has(v.vendorId)) {
      vendorRebateAllocations.set(v.vendorId, 0)
    }
    if (!vendorPriceReductionAllocations.has(v.vendorId)) {
      vendorPriceReductionAllocations.set(v.vendorId, 0)
    }
  }

  for (const vendor of input.vendors) {
    const procsForVendor = input.procedures.filter(
      (p) => p.vendorId === vendor.vendorId,
    )

    // Recompute total spend from the procedure rows to stay consistent with
    // the per-procedure share denominator. Falls back to the caller-supplied
    // totalVendorSpend if procedure rows are missing.
    const procedureSumSpend = procsForVendor.reduce(
      (sum, p) => sum + p.vendorSpend,
      0,
    )
    const denom =
      procedureSumSpend > 0 ? procedureSumSpend : vendor.totalVendorSpend

    if (denom <= 0) {
      // No spend to allocate against — leave allocations at 0 and skip.
      continue
    }

    const rebateBudget = Math.max(0, vendor.rebateAmount)
    const priceReductionBudget = Math.max(0, vendor.priceReductionAmount)

    let vendorRebateTotal = 0
    let vendorPriceReductionTotal = 0

    for (const p of procsForVendor) {
      if (p.vendorSpend <= 0) continue
      const share = p.vendorSpend / denom
      const rebateShare = rebateBudget * share
      const priceReductionShare = priceReductionBudget * share

      const existing = allocations.get(p.procedureId)
      // Guaranteed by the seed loop above, but narrow for TS.
      if (!existing) continue

      existing.rebateAllocation += rebateShare
      existing.priceReductionAllocation += priceReductionShare
      existing.totalContractBenefit =
        existing.rebateAllocation + existing.priceReductionAllocation

      vendorRebateTotal += rebateShare
      vendorPriceReductionTotal += priceReductionShare
    }

    vendorRebateAllocations.set(
      vendor.vendorId,
      (vendorRebateAllocations.get(vendor.vendorId) ?? 0) + vendorRebateTotal,
    )
    vendorPriceReductionAllocations.set(
      vendor.vendorId,
      (vendorPriceReductionAllocations.get(vendor.vendorId) ?? 0) +
        vendorPriceReductionTotal,
    )
  }

  return {
    allocations,
    vendorRebateAllocations,
    vendorPriceReductionAllocations,
  }
}

/** Case-level P&L inputs for margin v2. */
export interface CaseMarginInputs {
  /** Total reimbursement for the case (payor + patient responsibility). */
  reimbursement: number
  /** Total direct costs for the case (supplies + implants + other). */
  costs: number
}

/** Per-procedure / per-case contract benefit inputs for margin v2. */
export interface ContractBenefitAllocation {
  rebateAllocation: number
  priceReductionAllocation: number
  /**
   * Optional explicit total. When omitted, the engine uses
   * `rebateAllocation + priceReductionAllocation`. Passing it through
   * lets callers reuse a memoised `ProcedureContractAllocation` row.
   */
  totalContractBenefit?: number
}

export interface MarginV2Result {
  standardMargin: number
  /** 0 when reimbursement (revenue) is 0 — see [A9]. */
  standardMarginPercent: number
  trueMargin: number
  /** 0 when reimbursement (revenue) is 0 — see [A9]. */
  trueMarginPercent: number
  rebateContribution: number
  priceReductionContribution: number
  totalContractBenefit: number
}

/**
 * Compute standard + true margin for a case (or procedure) given its
 * reimbursement, costs, and allocated contract benefits.
 *
 * standardMargin = reimbursement − costs
 * trueMargin     = reimbursement − costs + totalContractBenefit
 *                = standardMargin + rebateAllocation + priceReductionAllocation
 *
 * [A9] When reimbursement is 0, percent outputs return 0 (not NaN / Infinity).
 */
export function calculateMarginsV2(
  caseData: CaseMarginInputs,
  allocation: ContractBenefitAllocation,
): MarginV2Result {
  const rebate = Math.max(0, allocation.rebateAllocation)
  const priceReduction = Math.max(0, allocation.priceReductionAllocation)
  const totalContractBenefit =
    allocation.totalContractBenefit ?? rebate + priceReduction

  const revenue = caseData.reimbursement
  const standardMargin = revenue - caseData.costs
  const trueMargin = standardMargin + totalContractBenefit

  // [A9] Zero-reimbursement guard.
  const hasRevenue = revenue > 0
  const standardMarginPercent = hasRevenue
    ? (standardMargin / revenue) * 100
    : 0
  const trueMarginPercent = hasRevenue ? (trueMargin / revenue) * 100 : 0

  return {
    standardMargin,
    standardMarginPercent,
    trueMargin,
    trueMarginPercent,
    rebateContribution: rebate,
    priceReductionContribution: priceReduction,
    totalContractBenefit,
  }
}
