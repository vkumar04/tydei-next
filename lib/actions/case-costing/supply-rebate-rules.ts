/**
 * Per-supply rebate RULE map — the single source of truth for "what
 * rebate does an on-contract supply contribute".
 *
 * Extracted so BOTH the surgeon Rebate-Contribution report
 * (`getSurgeonRebateContribution`) and the per-procedure True-Margin
 * table (`getTrueMarginReport`) derive the same `contractId → rule`
 * mapping — they previously disagreed (True Margin distributed each
 * vendor's *earned* rebate proportionally by spend share; the surgeon
 * report matched each supply's product to its contract and applied that
 * contract's rebate term). Vick 2026-06-16: "Rebate allocation should be
 * taking the products the surgeons used … checking the product numbers
 * with the contracts and seeing what rebate they are contributing." That
 * is exactly this per-supply rule, so both surfaces now route through it.
 *
 * A rule is derived from a contract's PRIMARY (highest-yielding) rebate
 * term evaluated against the contract's realized on-contract totals:
 *   - spend_rebate (spend-dollar ladder) → extendedCost × pctRate
 *   - volume_rebate (fixed_rebate_per_unit) → quantity × perUnitRate
 *   - carve_out / pricing_only / market_share / … → none (0)
 * Apply it per supply with `applySupplyRebateRule` (the ≤extendedCost
 * clamp lives there).
 */
import { prisma } from "@/lib/db"
import { hasSpendDollarTierLadder } from "@/lib/contracts/tier-metric"
import {
  applySupplyRebateRule,
  type AttributionSupply,
  type SupplyRebateRule,
} from "@/lib/case-costing/attribute-surgeon-rebates"

/**
 * Defensive ceiling on a contract's IMPLIED rate (per-supply rebate ÷
 * supply extendedCost). A real spend-dollar rebate ladder tops out well
 * under 25%; a volume contract's per-unit rebate can be a larger share of
 * a cheap line but is hard-clamped to the line cost in the pure helper.
 * This threshold is for the sanity WARN only — the per-supply clamp lives
 * in `applySupplyRebateRule`.
 */
export const SANITY_IMPLIED_RATE = 0.25

export interface TermTier {
  tierNumber: number
  spendMin: unknown
  spendMax: unknown
  volumeMin: number | null
  volumeMax: number | null
  rebateValue: unknown
  rebateType: string
}

export interface ContractTermLite {
  termType: string
  tiers: TermTier[]
}

/**
 * Derive the per-supply rebate rule for a single rebate term given the
 * contract's realized on-contract totals. Returns `{ kind: "none" }` when
 * the term type isn't a flat-percent or per-unit rebate we can attribute.
 */
export function ruleForTerm(
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
export function bestRuleForContract(
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
 * Build the `contractId → SupplyRebateRule` map for a facility's
 * contracts. Computes each contract's realized on-contract COG spend
 * (facility-scoped) and on-contract units (Σ CaseSupply.quantity) — the
 * inputs `ruleForTerm` needs to pick the qualifying tier — then derives
 * one rule per contract from its highest-yielding term.
 *
 * `contractIds` should be the set of contracts whose rules you need
 * (e.g. the contracts touched by the cases in scope). Contracts not in
 * the map (or scored `none`) contribute $0 per supply.
 */
export async function buildSupplyRebateRuleMap(
  facilityId: string,
  contractIds: string[],
): Promise<Map<string, SupplyRebateRule>> {
  const ruleByContract = new Map<string, SupplyRebateRule>()
  if (contractIds.length === 0) return ruleByContract

  const contracts = await prisma.contract.findMany({
    where: { id: { in: contractIds } },
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

  // ── on-contract COG spend per contract (facility-scoped) ──
  const cogSpendRows = await prisma.cOGRecord.groupBy({
    by: ["contractId"],
    where: {
      facilityId,
      matchStatus: "on_contract",
      contractId: { in: contractIds },
    },
    _sum: { extendedPrice: true },
  })
  const spendByContract = new Map<string, number>()
  for (const row of cogSpendRows) {
    if (!row.contractId) continue
    spendByContract.set(row.contractId, Number(row._sum.extendedPrice ?? 0))
  }

  // ── on-contract units per contract (Σ CaseSupply.quantity) ──
  const unitRows = await prisma.caseSupply.groupBy({
    by: ["contractId"],
    where: {
      isOnContract: true,
      contractId: { in: contractIds },
      caseRecord: { is: { facilityId } },
    },
    _sum: { quantity: true },
  })
  const unitsByContract = new Map<string, number>()
  for (const row of unitRows) {
    if (!row.contractId) continue
    unitsByContract.set(row.contractId, Number(row._sum.quantity ?? 0))
  }

  for (const contract of contracts) {
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
        "[buildSupplyRebateRuleMap] spend_pct rate exceeds sanity ceiling",
        {
          facilityId,
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
        "[buildSupplyRebateRuleMap] per_unit implied rate exceeds sanity ceiling",
        {
          facilityId,
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

  return ruleByContract
}
