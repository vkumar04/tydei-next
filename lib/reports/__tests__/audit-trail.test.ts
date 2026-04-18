import { describe, it, expect } from "vitest"
import {
  buildRebateCalculationAudit,
  type AuditContractInfo,
  type AuditTier,
  type AuditPurchase,
} from "../audit-trail"

const contract: AuditContractInfo = {
  id: "c-1",
  name: "Arthrex 2026 Master",
  vendor: "Arthrex",
  type: "usage",
  effectiveDate: new Date("2026-01-01"),
  expirationDate: new Date("2028-12-31"),
}

const tiers: AuditTier[] = [
  { name: "Tier 1", minSpend: 0, maxSpend: 500_000, rebateRate: 2 },
  { name: "Tier 2", minSpend: 500_000, maxSpend: 1_000_000, rebateRate: 4 },
  { name: "Tier 3", minSpend: 1_000_000, maxSpend: null, rebateRate: 6 },
]

describe("buildRebateCalculationAudit", () => {
  it("aggregates included POs and computes gross + net rebate", () => {
    const purchases: AuditPurchase[] = [
      { poNumber: "PO-1", date: new Date("2026-02-01"), amount: 100_000 },
      { poNumber: "PO-2", date: new Date("2026-03-01"), amount: 200_000 },
    ]
    const audit = buildRebateCalculationAudit({
      contract,
      tiers,
      currentTierName: "Tier 1",
      purchases,
    })

    expect(audit.calc.totalEligibleSpend).toBe(300_000)
    expect(audit.calc.currentTierRate).toBe(2)
    expect(audit.calc.grossRebate).toBe(6000) // 300_000 × 2%
    expect(audit.calc.netRebate).toBe(6000)
    expect(audit.inclusions).toHaveLength(2)
    expect(audit.excludedPOs).toHaveLength(0)
  })

  it("partitions excluded POs and populates excludedPOs", () => {
    const purchases: AuditPurchase[] = [
      { poNumber: "PO-1", date: new Date("2026-02-01"), amount: 100_000 },
      {
        poNumber: "PO-2",
        date: new Date("2026-03-01"),
        amount: 50_000,
        exclusionReason: "Service items excluded per §4.2",
        exclusionCategory: "excluded_item",
      },
    ]
    const audit = buildRebateCalculationAudit({
      contract,
      tiers,
      currentTierName: "Tier 1",
      purchases,
    })

    expect(audit.inclusions).toHaveLength(1)
    expect(audit.excludedPOs).toHaveLength(1)
    expect(audit.excludedPOs[0]).toMatchObject({
      poNumber: "PO-2",
      amount: 50_000,
      reason: "Service items excluded per §4.2",
    })
    // Eligible spend only counts inclusions
    expect(audit.calc.totalEligibleSpend).toBe(100_000)
  })

  it("applies signed adjustments to gross rebate", () => {
    const purchases: AuditPurchase[] = [
      { poNumber: "PO-1", date: new Date("2026-02-01"), amount: 845_000 },
    ]
    const audit = buildRebateCalculationAudit({
      contract,
      tiers,
      currentTierName: "Tier 2",
      purchases,
      adjustments: [
        { description: "Administrative fee (2%)", amount: -676 }, // -2% of 33.8k... keeping simple
        { description: "Early payment credit", amount: 500 },
      ],
    })

    // $845,000 × 4% = $33,800 gross
    expect(audit.calc.grossRebate).toBeCloseTo(33_800, 2)
    // Net = gross - 676 + 500
    expect(audit.calc.netRebate).toBeCloseTo(33_624, 2)
    expect(audit.calc.adjustments).toHaveLength(2)
  })

  it("groups exclusions by category with combined amounts", () => {
    const purchases: AuditPurchase[] = [
      {
        poNumber: "PO-A",
        date: new Date("2026-02-01"),
        amount: 5_000,
        exclusionReason: "Section 4.2 — service items",
        exclusionCategory: "excluded_item",
      },
      {
        poNumber: "PO-B",
        date: new Date("2026-02-15"),
        amount: 2_500,
        exclusionReason: "Section 4.2 — repairs",
        exclusionCategory: "excluded_item",
      },
      {
        poNumber: "PO-C",
        date: new Date("2026-03-01"),
        amount: 3_200,
        exclusionReason: "Section 5.1 — consignment returns",
        exclusionCategory: "carve_out",
      },
    ]
    const audit = buildRebateCalculationAudit({
      contract,
      tiers,
      currentTierName: "Tier 1",
      purchases,
    })

    expect(audit.calc.exclusions).toHaveLength(2)
    const items = audit.calc.exclusions.find((e) => e.category === "excluded_item")!
    expect(items.amount).toBe(7_500)
    const carve = audit.calc.exclusions.find((e) => e.category === "carve_out")!
    expect(carve.amount).toBe(3_200)
  })

  it("emits plain and detailed formula strings", () => {
    const purchases: AuditPurchase[] = [
      { poNumber: "PO-1", date: new Date("2026-02-01"), amount: 100_000 },
    ]
    const audit = buildRebateCalculationAudit({
      contract,
      tiers,
      currentTierName: "Tier 1",
      purchases,
    })

    expect(audit.calc.formula).toMatch(/Net Rebate/i)
    expect(audit.calc.detailedFormula).toContain("$100,000")
    expect(audit.calc.detailedFormula).toContain("2%")
    expect(audit.calc.detailedFormula).toContain("$2,000")
  })

  it("locks tier definition copy (retroactive rule)", () => {
    const audit = buildRebateCalculationAudit({
      contract,
      tiers,
      currentTierName: "Tier 1",
      purchases: [],
    })
    expect(audit.tierDefinition).toContain("RETROACTIVELY")
  })

  it("handles empty purchases without crashing", () => {
    const audit = buildRebateCalculationAudit({
      contract,
      tiers,
      currentTierName: "Tier 1",
      purchases: [],
    })
    expect(audit.calc.totalEligibleSpend).toBe(0)
    expect(audit.calc.grossRebate).toBe(0)
    expect(audit.calc.netRebate).toBe(0)
    expect(audit.inclusions).toEqual([])
    expect(audit.excludedPOs).toEqual([])
  })

  it("returns zero tier rate when currentTierName doesn't match any tier", () => {
    const audit = buildRebateCalculationAudit({
      contract,
      tiers,
      currentTierName: "Bogus Tier",
      purchases: [
        { poNumber: "PO-1", date: new Date("2026-02-01"), amount: 100_000 },
      ],
    })
    expect(audit.calc.currentTierRate).toBe(0)
    expect(audit.calc.grossRebate).toBe(0)
  })
})
