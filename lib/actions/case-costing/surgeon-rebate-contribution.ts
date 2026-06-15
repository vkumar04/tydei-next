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
import { hasSpendDollarTierLadder } from "@/lib/contracts/tier-metric"
import {
  attributeRebatesToSurgeons,
  applySupplyRebateRule,
  type AttributionCase,
  type AttributionSupply,
  type SupplyRebateRule,
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

/**
 * Defensive ceiling on a contract's IMPLIED rate (per-supply rebate ÷
 * supply extendedCost). A real spend-dollar rebate ladder tops out well
 * under 25%; a volume contract's per-unit rebate can be a larger share of
 * a cheap line but is hard-clamped to the line cost in the pure helper.
 * This threshold is for the sanity WARN only — the per-supply clamp lives
 * in `applySupplyRebateRule`.
 */
const SANITY_IMPLIED_RATE = 0.25

function parseDateOrThrow(label: string, value: string): Date {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `getSurgeonRebateContribution: invalid ${label} (${value})`,
    )
  }
  return d
}

interface TermTier {
  tierNumber: number
  spendMin: unknown
  spendMax: unknown
  volumeMin: number | null
  volumeMax: number | null
  rebateValue: unknown
  rebateType: string
}

interface ContractTermLite {
  termType: string
  tiers: TermTier[]
}

/**
 * Derive the per-supply rebate rule for a single rebate term given the
 * contract's realized on-contract totals. Returns `{ kind: "none" }` when
 * the term type isn't a flat-percent or per-unit rebate we can attribute.
 */
function ruleForTerm(
  term: ContractTermLite,
  onContractCogSpend: number,
  onContractUnits: number,
): SupplyRebateRule {
  // ── spend_rebate with a real spend-dollar ladder → percent of spend ──
  if (hasSpendDollarTierLadder(term)) {
    // Highest tier whose spendMin is met by the contract's on-contract spend.
    let best: TermTier | null = null
    for (const t of term.tiers) {
      const spendMin = Number(t.spendMin ?? 0)
      if (spendMin <= onContractCogSpend) {
        if (!best || spendMin > Number(best.spendMin ?? 0)) best = t
      }
    }
    if (!best) return { kind: "none" }
    // rebateValue is a FRACTION (0.02 = 2%) for percent_of_spend.
    const pctRate = Number(best.rebateValue ?? 0)
    if (!(pctRate > 0)) return { kind: "none" }
    return { kind: "spend_pct", pctRate }
  }

  // ── volume_rebate (fixed_rebate_per_unit) → dollars per unit ──
  if (term.termType === "volume_rebate") {
    const perUnitTiers = term.tiers.filter(
      (t) => t.rebateType === "fixed_rebate_per_unit",
    )
    if (perUnitTiers.length === 0) return { kind: "none" }

    // Highest tier whose volumeMin is met by on-contract units.
    let best: TermTier | null = null
    for (const t of perUnitTiers) {
      const volMin = Number(t.volumeMin ?? 0)
      if (volMin <= onContractUnits) {
        if (!best || volMin > Number(best.volumeMin ?? 0)) best = t
      }
    }
    // Fallback: every volumeMin is 0/null (no usable ladder) → use the
    // max-rate tier so a configured per-unit rebate isn't silently dropped.
    if (!best) {
      best = perUnitTiers.reduce((hi, t) =>
        Number(t.rebateValue ?? 0) > Number(hi.rebateValue ?? 0) ? t : hi,
      )
    }
    // fixed_rebate_per_unit rebateValue is ALREADY dollars — do NOT ×100.
    const perUnitRate = Number(best.rebateValue ?? 0)
    if (!(perUnitRate > 0)) return { kind: "none" }
    return { kind: "per_unit", perUnitRate }
  }

  // carve_out / pricing_only / market_share / everything else → no rebate
  // we can attribute as a flat per-supply number here.
  return { kind: "none" }
}

/**
 * Pick the single highest-yielding rule across a contract's terms,
 * evaluated against a representative supply. Avoids summing overlapping
 * terms; mirrors how other surfaces pick ONE tier-driving term.
 */
function bestRuleForContract(
  terms: ContractTermLite[],
  onContractCogSpend: number,
  onContractUnits: number,
  representative: Pick<AttributionSupply, "extendedCost" | "quantity">,
): SupplyRebateRule {
  let bestRule: SupplyRebateRule = { kind: "none" }
  let bestYield = 0
  for (const term of terms) {
    const rule = ruleForTerm(term, onContractCogSpend, onContractUnits)
    if (rule.kind === "none") continue
    const y = applySupplyRebateRule(rule, representative)
    if (y > bestYield) {
      bestYield = y
      bestRule = rule
    }
  }
  return bestRule
}

/**
 * Build the per-surgeon attributed-rebate rows for a facility, honoring
 * an optional date window on `dateOfSurgery`.
 */
export async function getSurgeonRebateContribution(
  input: GetSurgeonRebateContributionInput = {},
): Promise<SurgeonRebateContributionRow[]> {
  const { facility } = await requireFacility()

  // ─── 1. Owned contracts + their rebate terms/tiers ─────────────
  const ownedContracts = await prisma.contract.findMany({
    where: contractsOwnedByFacility(facility.id),
    select: {
      id: true,
      terms: {
        select: {
          termType: true,
          tiers: {
            select: {
              tierNumber: true,
              spendMin: true,
              spendMax: true,
              volumeMin: true,
              volumeMax: true,
              rebateValue: true,
              rebateType: true,
            },
          },
        },
      },
    },
  })
  const ownedContractIds = ownedContracts.map((c) => c.id)

  // contractId → its derived per-supply rule.
  const ruleByContract = new Map<string, SupplyRebateRule>()

  if (ownedContractIds.length > 0) {
    // ── 1a. on-contract COG spend per contract (facility-scoped) ──
    const cogSpendRows = await prisma.cOGRecord.groupBy({
      by: ["contractId"],
      where: {
        facilityId: facility.id,
        matchStatus: "on_contract",
        contractId: { in: ownedContractIds },
      },
      _sum: { extendedPrice: true },
    })
    const spendByContract = new Map<string, number>()
    for (const row of cogSpendRows) {
      if (!row.contractId) continue
      spendByContract.set(row.contractId, Number(row._sum.extendedPrice ?? 0))
    }

    // ── 1b. on-contract units per contract (Σ CaseSupply.quantity) ──
    //
    // Supply quantity is the unit basis (COGRecord carries no clean unit
    // count). Scope to this facility's cases via the case relation.
    const unitRows = await prisma.caseSupply.groupBy({
      by: ["contractId"],
      where: {
        isOnContract: true,
        contractId: { in: ownedContractIds },
        caseRecord: { is: { facilityId: facility.id } },
      },
      _sum: { quantity: true },
    })
    const unitsByContract = new Map<string, number>()
    for (const row of unitRows) {
      if (!row.contractId) continue
      unitsByContract.set(row.contractId, Number(row._sum.quantity ?? 0))
    }

    // ── 1c. derive one rule per contract ──
    for (const contract of ownedContracts) {
      const onContractCogSpend = spendByContract.get(contract.id) ?? 0
      const onContractUnits = unitsByContract.get(contract.id) ?? 0

      const terms: ContractTermLite[] = contract.terms.map((t) => ({
        termType: t.termType,
        tiers: t.tiers.map((tier) => ({
          tierNumber: tier.tierNumber,
          spendMin: tier.spendMin,
          spendMax: tier.spendMax,
          volumeMin: tier.volumeMin,
          volumeMax: tier.volumeMax,
          rebateValue: tier.rebateValue,
          rebateType: tier.rebateType,
        })),
      }))

      // Representative supply for ranking overlapping terms: 1 unit at the
      // contract's average on-contract line cost (falls back to $1 so the
      // ranking is non-degenerate when there's no spend/units yet).
      const repExtended =
        onContractUnits > 0 && onContractCogSpend > 0
          ? onContractCogSpend / onContractUnits
          : onContractCogSpend > 0
            ? onContractCogSpend
            : 1
      const rule = bestRuleForContract(terms, onContractCogSpend, onContractUnits, {
        extendedCost: repExtended,
        quantity: 1,
      })

      // ── contract-level sanity warn on a wild IMPLIED rate ──
      if (rule.kind === "spend_pct" && rule.pctRate > SANITY_IMPLIED_RATE) {
        console.warn(
          "[getSurgeonRebateContribution] spend_pct rate exceeds sanity ceiling",
          {
            facilityId: facility.id,
            contractId: contract.id,
            onContractCogSpend,
            pctRate: rule.pctRate,
            ceiling: SANITY_IMPLIED_RATE,
          },
        )
      } else if (
        rule.kind === "per_unit" &&
        repExtended > 0 &&
        rule.perUnitRate / repExtended > SANITY_IMPLIED_RATE
      ) {
        console.warn(
          "[getSurgeonRebateContribution] per_unit implied rate exceeds sanity ceiling",
          {
            facilityId: facility.id,
            contractId: contract.id,
            onContractUnits,
            perUnitRate: rule.perUnitRate,
            avgLineCost: repExtended,
            impliedRate: rule.perUnitRate / repExtended,
            ceiling: SANITY_IMPLIED_RATE,
          },
        )
      }

      ruleByContract.set(contract.id, rule)
    }
  }

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
