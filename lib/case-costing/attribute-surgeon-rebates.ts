/**
 * Per-surgeon rebate attribution — pure math.
 *
 * Replaces the legacy flat-3%-of-spend estimate on the case-costing
 * "Rebate Contribution" report. A surgeon's attributed rebate is the
 * sum, over the ON-CONTRACT supplies they used, of a PER-SUPPLY rebate
 * that is computed by the supply's OWN contract structure:
 *
 *     attributedRebate(surgeon) =
 *       Σ over on-contract supplies of  perSupplyRebate(supply)
 *
 * `perSupplyRebate` is supplied UPSTREAM by the server action
 * (`lib/actions/case-costing/surgeon-rebate-contribution.ts`), which
 * precomputes a per-contract `SupplyRebateRule` from each contract's
 * primary rebate term + tiers + its realized on-contract totals, then
 * applies it per supply:
 *
 *   - spend_rebate (spend-dollar ladder) → extendedCost × pctRate
 *       (pctRate = the qualifying tier's fractional rebateValue)
 *   - volume_rebate (fixed_rebate_per_unit) → quantity × perUnitRate
 *       (perUnitRate = the qualifying tier's $/unit rebateValue)
 *   - carve_out / pricing_only / everything else → 0
 *
 * Earlier model: a single flat `effectiveRate[contractId]` applied to
 * extendedCost. That read $0 on real data because the surgeons'
 * on-contract supplies match a VOLUME contract ($/unit) and PRICING-ONLY
 * contracts, not a spend-% one. The per-supply, contract-type-aware rule
 * computes each supply's rebate by its own contract's structure instead.
 *
 * Each per-supply rebate is clamped to ≤ the supply's extendedCost
 * (defensive — a rebate never exceeds the line spend). Supplies on no
 * contract (or that the rule scores 0) contribute nothing; we never fall
 * back to a fabricated flat percent (CLAUDE.md "rebates are NEVER
 * auto-computed for display"). The flat 0.03 this replaces was pure
 * invention.
 *
 * Pure + framework-free (no Prisma, no server-action imports) so Vitest
 * and client components can both exercise it.
 */

/** A single supply line on a case, reduced to what attribution needs. */
export interface AttributionSupply {
  isOnContract: boolean
  /** null when the supply isn't tied to a contract — contributes $0. */
  contractId: string | null
  /** Extended cost of the supply (already qty × unit). */
  extendedCost: number
  /** Units on this supply line — drives per-unit (volume) rebates. */
  quantity: number
}

/** A single case, reduced to what attribution needs. */
export interface AttributionCase {
  surgeonName: string | null
  /** Total case spend (used for the per-surgeon `spend` column). */
  totalSpend: number
  /** "compliant" counts toward the surgeon's compliance rate. */
  complianceStatus: string
  supplies: readonly AttributionSupply[]
}

/** One output row — mirrors the legacy `rebateStats` row shape. */
export interface SurgeonRebateRow {
  name: string
  cases: number
  spend: number
  attributedRebate: number
  /** compliant / cases × 100, or 0 when the surgeon has no cases. */
  complianceRate: number
}

/**
 * A per-supply rebate rule for one contract. The server action derives
 * exactly one of these per owned contract from its primary rebate term:
 *
 *   - { kind: "spend_pct", pctRate }   → extendedCost × pctRate
 *   - { kind: "per_unit",  perUnitRate } → quantity × perUnitRate
 *   - { kind: "none" }                 → 0 (pricing-only, carve-out, etc.)
 *
 * `applySupplyRebateRule` is the single place the rule is applied so the
 * server action and tests evaluate it identically, including the
 * ≤extendedCost clamp.
 */
export type SupplyRebateRule =
  | { kind: "spend_pct"; pctRate: number }
  | { kind: "per_unit"; perUnitRate: number }
  | { kind: "none" }

/**
 * Apply a contract's rule to one supply, returning the per-supply rebate
 * dollars. Result is clamped to [0, extendedCost] — a rebate can never be
 * negative nor exceed the line spend.
 */
export function applySupplyRebateRule(
  rule: SupplyRebateRule,
  supply: Pick<AttributionSupply, "extendedCost" | "quantity">,
): number {
  let raw: number
  switch (rule.kind) {
    case "spend_pct":
      raw = supply.extendedCost * rule.pctRate
      break
    case "per_unit":
      raw = supply.quantity * rule.perUnitRate
      break
    case "none":
    default:
      return 0
  }
  if (!Number.isFinite(raw) || raw <= 0) return 0
  // Defensive clamp: a rebate never exceeds the line's extended cost.
  return Math.min(raw, supply.extendedCost)
}

const UNKNOWN_SURGEON = "Unknown"

/**
 * Attribute earned-rebate dollars to surgeons from their on-contract
 * supply usage.
 *
 * @param cases           Facility cases (already date/scope filtered by the caller).
 * @param perSupplyRebate (supply) => rebate dollars for that supply. The caller
 *                        builds this from the per-contract `SupplyRebateRule`s
 *                        (e.g. via `applySupplyRebateRule`). A supply with no
 *                        contract — or one the rule scores 0 — contributes $0;
 *                        never a fallback flat rate. The function is responsible
 *                        for the ≤extendedCost clamp.
 * @returns one row per surgeon, sorted by `attributedRebate` descending.
 */
export function attributeRebatesToSurgeons(
  cases: readonly AttributionCase[],
  perSupplyRebate: (supply: AttributionSupply) => number,
): SurgeonRebateRow[] {
  interface Acc {
    cases: number
    spend: number
    compliant: number
    attributedRebate: number
  }

  const bySurgeon = new Map<string, Acc>()

  for (const c of cases) {
    const name = c.surgeonName ?? UNKNOWN_SURGEON
    const entry =
      bySurgeon.get(name) ??
      ({ cases: 0, spend: 0, compliant: 0, attributedRebate: 0 } satisfies Acc)

    entry.cases += 1
    entry.spend += c.totalSpend
    if (c.complianceStatus === "compliant") entry.compliant += 1

    for (const s of c.supplies) {
      if (!s.isOnContract || !s.contractId) continue
      const rebate = perSupplyRebate(s)
      if (rebate <= 0) continue
      entry.attributedRebate += rebate
    }

    bySurgeon.set(name, entry)
  }

  return Array.from(bySurgeon.entries())
    .map(([name, d]) => ({
      name,
      cases: d.cases,
      spend: d.spend,
      attributedRebate: d.attributedRebate,
      complianceRate: d.cases > 0 ? (d.compliant / d.cases) * 100 : 0,
    }))
    .sort((a, b) => b.attributedRebate - a.attributedRebate)
}
