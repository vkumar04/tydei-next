"use server"

/**
 * Case-costing — per-surgeon rebate contribution server action.
 *
 * Replaces the legacy flat-3%-of-spend estimate on the "Rebate
 * Contribution" report tab with a PER-SUPPLY, CONTRACT-TYPE-AWARE
 * attribution.
 *
 * Why the old single-rate model read $0 on real data
 * ──────────────────────────────────────────────────
 * The previous version derived ONE `effectiveRate[contractId]` from a
 * spend-dollar tier ladder and multiplied every on-contract supply's
 * `extendedCost` by it. But the surgeons' on-contract supplies match a
 * VOLUME contract (Arthrex: $10–15 PER UNIT via `fixed_rebate_per_unit`)
 * and PRICING-ONLY contracts — not a spend-% one. Those term types fail
 * `hasSpendDollarTierLadder`, so every supply got rate 0 and the report
 * showed $0. The one real spend-% contract had no matched supplies.
 *
 * New model (confirmed): compute each on-contract supply's rebate by ITS
 * OWN contract's structure.
 *
 * Per owned contract we derive a single `SupplyRebateRule` from its
 * PRIMARY rebate term + tiers + that contract's realized on-contract
 * totals:
 *
 *   1. onContractCogSpend = Σ COGRecord.extendedPrice (matchStatus
 *      'on_contract', this contract, facility-scoped).
 *   2. onContractUnits    = Σ CaseSupply.quantity where
 *      `isOnContract && contractId = this` (case.facilityId = facility).
 *      COGRecord has no clean unit count, so supply quantity is the right
 *      basis for the supply-level estimate.
 *
 * Primary-term → rule:
 *
 *   - spend_rebate w/ a spend-dollar ladder (`hasSpendDollarTierLadder`):
 *       pctRate = `rebateValue` (FRACTION, 0.02 = 2%) of the HIGHEST tier
 *       whose `spendMin <= onContractCogSpend`.
 *       supply rebate = supply.extendedCost × pctRate.
 *
 *   - volume_rebate (tiers are `fixed_rebate_per_unit`; `rebateValue` is
 *     $/unit, already dollars — NOT a fraction; only `percent_of_spend`
 *     is scaled by 100, confirmed in `computeRebateFromPrismaTiers`):
 *       perUnitRate = `rebateValue` of the HIGHEST tier whose
 *       `(volumeMin ?? 0) <= onContractUnits` (volume tiers differentiate
 *       by `volumeMin`; many demo rows leave `spendMin = 0`). If every
 *       tier's volumeMin is 0/null, fall back to the MAX-rate tier.
 *       supply rebate = supply.quantity × perUnitRate.
 *
 *   - carve_out: the carve-out rate lives in per-SKU
 *     `ContractPricing.carveOutPercent`, exposed only through the heavy
 *     `"use server"` `getCarveOutRebate` action (needs its own auth +
 *     COG scan, no readily-callable pure rate). Rather than fabricate a
 *     number we SKIP carve_out → rule "none" (0). Documented, not invented.
 *
 *   - pricing_only / everything else → "none" (0): these are price
 *     savings, not rebates.
 *
 * When a contract has multiple qualifying rebate terms we pick the single
 * HIGHEST-YIELDING rule per supply (using a representative supply), never
 * summing overlapping terms (mirrors how performance-read / accrual pick
 * one tier-driving term).
 *
 * Each per-supply rebate is clamped to ≤ its extendedCost in the pure
 * helper (`applySupplyRebateRule`). A contract-level sanity warn fires
 * when a contract's IMPLIED rate (rebate ÷ on-contract spend) looks wild.
 *
 * Contracts are facility-scoped via `contractsOwnedByFacility`; COG and
 * supply reads are scoped to `facility.id`. Output is plain JSON
 * (Decimal → number) via `serialize`, safe over the action boundary.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { buildSupplyRebateRuleMap } from "@/lib/actions/case-costing/supply-rebate-rules"
import {
  attributeRebatesToSurgeons,
  applySupplyRebateRule,
  type AttributionCase,
  type AttributionSupply,
  type SurgeonRebateRow,
} from "@/lib/case-costing/attribute-surgeon-rebates"

export interface GetSurgeonRebateContributionInput {
  facilityId?: string
  /** ISO date (YYYY-MM-DD); inclusive lower bound on dateOfSurgery. */
  dateFrom?: string
  /** ISO date (YYYY-MM-DD); inclusive upper bound on dateOfSurgery. */
  dateTo?: string
}

export type SurgeonRebateContributionRow = SurgeonRebateRow

function parseDateOrThrow(label: string, value: string): Date {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `getSurgeonRebateContribution: invalid ${label} (${value})`,
    )
  }
  return d
}

/**
 * Build the per-surgeon attributed-rebate rows for a facility, honoring
 * an optional date window on `dateOfSurgery`.
 */
export async function getSurgeonRebateContribution(
  input: GetSurgeonRebateContributionInput = {},
): Promise<SurgeonRebateContributionRow[]> {
  const { facility } = await requireFacility()

  // ─── 1. Owned contracts → per-supply rule map ──────────────────
  // The contractId → SupplyRebateRule derivation lives in the shared
  // `buildSupplyRebateRuleMap` so this report and the per-procedure
  // True-Margin table attribute the SAME per-supply rebate (CLAUDE.md
  // "Per-supply rebate rule" invariant).
  const ownedContracts = await prisma.contract.findMany({
    where: contractsOwnedByFacility(facility.id),
    select: { id: true },
  })
  const ownedContractIds = ownedContracts.map((c) => c.id)
  const ruleByContract = await buildSupplyRebateRuleMap(
    facility.id,
    ownedContractIds,
  )

  // ─── 2. Per-surgeon attribution ───────────────────────────────
  const dateFilter: { gte?: Date; lte?: Date } = {}
  if (input.dateFrom) dateFilter.gte = parseDateOrThrow("dateFrom", input.dateFrom)
  if (input.dateTo) dateFilter.lte = parseDateOrThrow("dateTo", input.dateTo)

  const cases = await prisma.case.findMany({
    where: {
      facilityId: facility.id,
      ...(dateFilter.gte || dateFilter.lte
        ? { dateOfSurgery: dateFilter }
        : {}),
    },
    select: {
      surgeonName: true,
      totalSpend: true,
      complianceStatus: true,
      supplies: {
        select: {
          isOnContract: true,
          contractId: true,
          extendedCost: true,
          quantity: true,
        },
      },
    },
  })

  const attributionCases: AttributionCase[] = cases.map((c) => ({
    surgeonName: c.surgeonName,
    totalSpend: Number(c.totalSpend),
    complianceStatus: c.complianceStatus,
    supplies: c.supplies.map((s) => ({
      isOnContract: s.isOnContract,
      contractId: s.contractId,
      extendedCost: Number(s.extendedCost),
      quantity: Number(s.quantity),
    })),
  }))

  const perSupplyRebate = (supply: AttributionSupply): number => {
    if (!supply.contractId) return 0
    const rule = ruleByContract.get(supply.contractId) ?? { kind: "none" }
    return applySupplyRebateRule(rule, supply)
  }

  const rows = attributeRebatesToSurgeons(attributionCases, perSupplyRebate)

  return serialize(rows)
}
