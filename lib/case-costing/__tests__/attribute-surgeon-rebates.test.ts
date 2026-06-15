import { describe, it, expect } from "vitest"
import {
  attributeRebatesToSurgeons,
  applySupplyRebateRule,
  type AttributionCase,
  type AttributionSupply,
  type SupplyRebateRule,
} from "../attribute-surgeon-rebates"

const EPSILON = 1e-9

/**
 * Build a `perSupplyRebate(supply)` from a contractId → rule map, exactly
 * the way the server action does (via `applySupplyRebateRule`). Lets the
 * tests exercise the real rule/clamp logic end-to-end.
 */
function makePerSupplyRebate(rules: Map<string, SupplyRebateRule>) {
  return (s: AttributionSupply): number => {
    if (!s.contractId) return 0
    const rule = rules.get(s.contractId) ?? { kind: "none" as const }
    return applySupplyRebateRule(rule, s)
  }
}

describe("applySupplyRebateRule", () => {
  it("spend_pct: extendedCost × pctRate", () => {
    const rule: SupplyRebateRule = { kind: "spend_pct", pctRate: 0.02 }
    expect(
      applySupplyRebateRule(rule, { extendedCost: 600, quantity: 3 }),
    ).toBeCloseTo(12, 9)
  })

  it("per_unit: quantity × perUnitRate (NOT extendedCost-based)", () => {
    // Arthrex-shaped: $10/unit, 8 units → $80 regardless of line cost.
    const rule: SupplyRebateRule = { kind: "per_unit", perUnitRate: 10 }
    expect(
      applySupplyRebateRule(rule, { extendedCost: 4000, quantity: 8 }),
    ).toBeCloseTo(80, 9)
  })

  it("none (pricing-only / carve-out / unknown): 0", () => {
    const rule: SupplyRebateRule = { kind: "none" }
    expect(
      applySupplyRebateRule(rule, { extendedCost: 1000, quantity: 5 }),
    ).toBe(0)
  })

  it("clamps a rebate to ≤ the supply's extendedCost", () => {
    // per-unit rate larger than the line value → clamp to extendedCost.
    const rule: SupplyRebateRule = { kind: "per_unit", perUnitRate: 100 }
    // raw = 5 × 100 = 500, but extendedCost is only 120 → 120.
    expect(
      applySupplyRebateRule(rule, { extendedCost: 120, quantity: 5 }),
    ).toBeCloseTo(120, 9)
  })

  it("clamps a >100% spend_pct rate to extendedCost", () => {
    const rule: SupplyRebateRule = { kind: "spend_pct", pctRate: 1.5 }
    // raw = 200 × 1.5 = 300 → clamped to 200.
    expect(
      applySupplyRebateRule(rule, { extendedCost: 200, quantity: 1 }),
    ).toBeCloseTo(200, 9)
  })

  it("returns 0 for non-finite or non-positive raw values", () => {
    expect(
      applySupplyRebateRule(
        { kind: "spend_pct", pctRate: 0 },
        { extendedCost: 100, quantity: 1 },
      ),
    ).toBe(0)
    expect(
      applySupplyRebateRule(
        { kind: "per_unit", perUnitRate: 5 },
        { extendedCost: 100, quantity: 0 },
      ),
    ).toBe(0)
  })
})

describe("attributeRebatesToSurgeons", () => {
  it("attributes per-supply rebate by each contract's OWN structure", () => {
    // contract-VOL is a volume contract ($10/unit); contract-SPEND is a
    // spend-% contract (2% of extendedCost); contract-PRICE is pricing-only.
    const rules = new Map<string, SupplyRebateRule>([
      ["contract-VOL", { kind: "per_unit", perUnitRate: 10 }],
      ["contract-SPEND", { kind: "spend_pct", pctRate: 0.02 }],
      ["contract-PRICE", { kind: "none" }],
    ])
    const perSupplyRebate = makePerSupplyRebate(rules)

    const cases: AttributionCase[] = [
      {
        surgeonName: "Dr. Smith",
        totalSpend: 5000,
        complianceStatus: "compliant",
        supplies: [
          // volume: 8 units × $10 = $80 (NOT extendedCost-based)
          {
            isOnContract: true,
            contractId: "contract-VOL",
            extendedCost: 3360,
            quantity: 8,
          },
          // pricing-only: 0 even with spend
          {
            isOnContract: true,
            contractId: "contract-PRICE",
            extendedCost: 1640,
            quantity: 4,
          },
          // off-contract: ignored
          {
            isOnContract: false,
            contractId: null,
            extendedCost: 400,
            quantity: 2,
          },
        ],
      },
      {
        surgeonName: "Dr. Smith",
        totalSpend: 500,
        complianceStatus: "non_compliant",
        supplies: [
          // spend-%: 500 × 0.02 = $10
          {
            isOnContract: true,
            contractId: "contract-SPEND",
            extendedCost: 500,
            quantity: 1,
          },
        ],
      },
    ]

    const rows = attributeRebatesToSurgeons(cases, perSupplyRebate)

    expect(rows).toHaveLength(1)
    const smith = rows[0]
    expect(smith.name).toBe("Dr. Smith")
    expect(smith.cases).toBe(2)
    expect(smith.spend).toBeCloseTo(5500, 9)
    // 80 (volume) + 0 (pricing) + 10 (spend) = 90 — NOT 5500 × 0.03 = 165.
    expect(smith.attributedRebate).toBeCloseTo(90, 9)
    // 1 of 2 cases compliant.
    expect(smith.complianceRate).toBeCloseTo(50, 9)
  })

  it("applies the ≤extendedCost clamp end-to-end through attribution", () => {
    const rules = new Map<string, SupplyRebateRule>([
      ["c", { kind: "per_unit", perUnitRate: 100 }],
    ])
    const perSupplyRebate = makePerSupplyRebate(rules)
    const cases: AttributionCase[] = [
      {
        surgeonName: "Dr. Clamp",
        totalSpend: 120,
        complianceStatus: "compliant",
        supplies: [
          // raw 5 × 100 = 500, clamped to extendedCost 120.
          { isOnContract: true, contractId: "c", extendedCost: 120, quantity: 5 },
        ],
      },
    ]
    const rows = attributeRebatesToSurgeons(cases, perSupplyRebate)
    expect(rows[0].attributedRebate).toBeCloseTo(120, 9)
  })

  it("ignores supplies flagged on-contract but missing a contractId, and unknown contractIds", () => {
    const rules = new Map<string, SupplyRebateRule>([
      ["contract-A", { kind: "per_unit", perUnitRate: 10 }],
    ])
    const perSupplyRebate = makePerSupplyRebate(rules)
    const cases: AttributionCase[] = [
      {
        surgeonName: "Dr. Jones",
        totalSpend: 300,
        complianceStatus: "compliant",
        supplies: [
          // on-contract but null contractId -> $0
          { isOnContract: true, contractId: null, extendedCost: 100, quantity: 1 },
          // contractId not in the rule map -> $0
          { isOnContract: true, contractId: "contract-Z", extendedCost: 100, quantity: 1 },
          // valid: 1 unit × $10 = 10
          { isOnContract: true, contractId: "contract-A", extendedCost: 100, quantity: 1 },
        ],
      },
    ]

    const rows = attributeRebatesToSurgeons(cases, perSupplyRebate)
    expect(rows[0].attributedRebate).toBeCloseTo(10, 9)
  })

  it("buckets null surgeonName under 'Unknown' and sorts by attributedRebate desc", () => {
    const rules = new Map<string, SupplyRebateRule>([
      ["c", { kind: "spend_pct", pctRate: 0.5 }],
    ])
    const perSupplyRebate = makePerSupplyRebate(rules)
    const cases: AttributionCase[] = [
      {
        surgeonName: null,
        totalSpend: 10,
        complianceStatus: "compliant",
        supplies: [{ isOnContract: true, contractId: "c", extendedCost: 10, quantity: 1 }],
      },
      {
        surgeonName: "Dr. Big",
        totalSpend: 100,
        complianceStatus: "compliant",
        supplies: [{ isOnContract: true, contractId: "c", extendedCost: 100, quantity: 1 }],
      },
    ]

    const rows = attributeRebatesToSurgeons(cases, perSupplyRebate)
    expect(rows.map((r) => r.name)).toEqual(["Dr. Big", "Unknown"])
    expect(rows[0].attributedRebate).toBeCloseTo(50, 9)
    expect(rows[1].attributedRebate).toBeCloseTo(5, 9)
  })

  it("returns an empty array for no cases", () => {
    expect(attributeRebatesToSurgeons([], () => 0)).toEqual([])
  })

  it("guards complianceRate at 0 for a surgeon (never NaN)", () => {
    const cases: AttributionCase[] = [
      {
        surgeonName: "Dr. Zero",
        totalSpend: 0,
        complianceStatus: "non_compliant",
        supplies: [],
      },
    ]
    const rows = attributeRebatesToSurgeons(cases, () => 0)
    expect(rows[0].attributedRebate).toBe(0)
    expect(rows[0].complianceRate).toBe(0)
    expect(Number.isNaN(rows[0].complianceRate)).toBe(false)
  })

  it("does not leak a flat fallback when no rule is known (all rebates 0)", () => {
    const perSupplyRebate = makePerSupplyRebate(new Map())
    const cases: AttributionCase[] = [
      {
        surgeonName: "Dr. Smith",
        totalSpend: 1000,
        complianceStatus: "compliant",
        supplies: [
          { isOnContract: true, contractId: "contract-A", extendedCost: 1000, quantity: 5 },
        ],
      },
    ]
    const rows = attributeRebatesToSurgeons(cases, perSupplyRebate)
    // No rule known -> $0, NOT 1000 × 0.03.
    expect(rows[0].attributedRebate).toBeCloseTo(0, 9)
    expect(Math.abs(rows[0].attributedRebate - 30)).toBeGreaterThan(EPSILON)
  })
})
