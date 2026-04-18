/**
 * Rebate Optimizer — alert-generator tests.
 *
 * Covers the acceptance criteria from the rebate-optimizer rewrite spec:
 *
 *   - Empty contracts → empty alerts.
 *   - Top-tier contract (nextTierThreshold null) → no alerts.
 *   - approaching_next_tier bucket (medium severity).
 *   - at_tier_threshold bucket (high severity, mutually exclusive w/ approaching).
 *   - missed_tier_opportunity bucket (high severity, can co-emit).
 *   - Severity sort: high → medium → low; ties broken by contract name.
 *   - Messages include formatted dollars.
 *   - Zero velocity → missed opportunity when expiring.
 *   - Titles reference correct tier names.
 */

import { describe, it, expect } from "vitest"
import {
  generateRebateAlerts,
  type ContractForAlert,
  type RebateAlert,
} from "../alert-generator"

function baseContract(
  overrides: Partial<ContractForAlert> = {},
): ContractForAlert {
  return {
    id: "c-1",
    name: "Contract A",
    vendorName: "Vendor X",
    currentSpend: 500_000,
    currentTierName: "Tier 1",
    nextTierName: "Tier 2",
    nextTierThreshold: 1_000_000,
    additionalRebateIfReached: 10_000,
    daysUntilExpiration: 365,
    monthlySpendRate: 100_000,
    ...overrides,
  }
}

describe("generateRebateAlerts", () => {
  it("returns empty alerts for empty contracts", () => {
    expect(generateRebateAlerts([])).toEqual<RebateAlert[]>([])
  })

  it("emits no alerts for contracts already at the top tier", () => {
    const contract = baseContract({
      nextTierThreshold: null,
      nextTierName: null,
    })
    expect(generateRebateAlerts([contract])).toEqual<RebateAlert[]>([])
  })

  it("emits no alerts for contracts far from the next tier", () => {
    // 50% to go, 5 months velocity, not expiring — none of the buckets fire.
    const contract = baseContract({
      currentSpend: 500_000,
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 100_000,
      daysUntilExpiration: 365,
    })
    expect(generateRebateAlerts([contract])).toEqual<RebateAlert[]>([])
  })

  it("emits approaching_next_tier at medium severity when 18% to go and 2 months velocity", () => {
    const contract = baseContract({
      id: "c-approach",
      name: "Approach Co",
      currentSpend: 820_000, // 18% to go
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 100_000, // 1.8 months to reach
      daysUntilExpiration: 365,
      additionalRebateIfReached: 12_000,
    })

    const alerts = generateRebateAlerts([contract])
    expect(alerts).toHaveLength(1)
    const [alert] = alerts
    expect(alert.kind).toBe("approaching_next_tier")
    expect(alert.severity).toBe("medium")
    expect(alert.contractId).toBe("c-approach")
    expect(alert.title).toBe("Approach Co approaching Tier 2 tier")
    expect(alert.valueReference).toBe(12_000)
  })

  it("emits at_tier_threshold at high severity when 3% to go and 1 month velocity (no approaching alert)", () => {
    const contract = baseContract({
      id: "c-close",
      name: "Close Corp",
      currentSpend: 970_000, // 3% to go
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 100_000, // 0.3 months
      daysUntilExpiration: 365,
      additionalRebateIfReached: 5_000,
    })

    const alerts = generateRebateAlerts([contract])
    // Mutually exclusive: must NOT also emit approaching_next_tier.
    expect(alerts).toHaveLength(1)
    const [alert] = alerts
    expect(alert.kind).toBe("at_tier_threshold")
    expect(alert.severity).toBe("high")
    expect(alert.title).toBe("Close Corp is at the Tier 2 threshold")
  })

  it("emits missed_tier_opportunity at high severity when contract expiring before velocity can reach tier", () => {
    const contract = baseContract({
      id: "c-miss",
      name: "Missing Co",
      currentSpend: 400_000,
      nextTierThreshold: 1_000_000, // $600k to go
      monthlySpendRate: 200_000, // 3 months to reach
      daysUntilExpiration: 50, // ~1.67 months remaining → can't reach
      additionalRebateIfReached: 25_000,
    })

    const alerts = generateRebateAlerts([contract])
    expect(alerts).toHaveLength(1)
    const [alert] = alerts
    expect(alert.kind).toBe("missed_tier_opportunity")
    expect(alert.severity).toBe("high")
    expect(alert.title).toBe(
      "Missing Co won't reach Tier 2 before expiration",
    )
    expect(alert.valueReference).toBe(25_000)
  })

  it("lets a single contract emit multiple alerts (approaching + missed opportunity)", () => {
    // 18% to go (approaching), 2 months velocity — but contract expires in
    // 30 days (~1 month) so they can't reach in time.
    const contract = baseContract({
      id: "c-combo",
      name: "Combo LLC",
      currentSpend: 820_000,
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 100_000, // 1.8 months to reach
      daysUntilExpiration: 30, // 1 month remaining
      additionalRebateIfReached: 8_000,
    })

    const alerts = generateRebateAlerts([contract])
    const kinds = alerts.map((a) => a.kind).sort()
    expect(kinds).toEqual(["approaching_next_tier", "missed_tier_opportunity"])
    // Missed opportunity (high) should sort before approaching (medium).
    expect(alerts[0].severity).toBe("high")
    expect(alerts[1].severity).toBe("medium")
  })

  it("sorts alerts by severity descending, then by contract name ascending", () => {
    const highA = baseContract({
      id: "c-high-a",
      name: "Alpha Co",
      currentSpend: 970_000,
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 100_000,
      daysUntilExpiration: 365,
    }) // at_tier_threshold, high
    const highB = baseContract({
      id: "c-high-b",
      name: "Bravo Co",
      currentSpend: 970_000,
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 100_000,
      daysUntilExpiration: 365,
    }) // at_tier_threshold, high
    const med = baseContract({
      id: "c-med",
      name: "Charlie Co",
      currentSpend: 820_000,
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 100_000,
      daysUntilExpiration: 365,
    }) // approaching, medium

    const alerts = generateRebateAlerts([med, highB, highA])
    expect(alerts.map((a) => a.contractName)).toEqual([
      "Alpha Co",
      "Bravo Co",
      "Charlie Co",
    ])
    expect(alerts.map((a) => a.severity)).toEqual(["high", "high", "medium"])
  })

  it("formats dollar amounts in the alert message", () => {
    const contract = baseContract({
      currentSpend: 820_000,
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 100_000,
      additionalRebateIfReached: 12_345,
    })

    const [alert] = generateRebateAlerts([contract])
    // Default currency format has no cents and a dollar sign.
    expect(alert.message).toContain("$180,000")
    expect(alert.message).toContain("$12,345")
  })

  it("treats zero velocity as infinite months and emits missed opportunity when expiring", () => {
    const contract = baseContract({
      id: "c-zero-vel",
      name: "Zero Velocity Co",
      currentSpend: 400_000,
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 0,
      daysUntilExpiration: 45, // expiring within 90 days
      additionalRebateIfReached: 15_000,
    })

    const alerts = generateRebateAlerts([contract])
    expect(alerts).toHaveLength(1)
    expect(alerts[0].kind).toBe("missed_tier_opportunity")
    expect(alerts[0].severity).toBe("high")
  })

  it("references the supplied tier names in titles", () => {
    const contract = baseContract({
      id: "c-title",
      name: "Titled Corp",
      currentTierName: "Silver",
      nextTierName: "Platinum",
      currentSpend: 970_000,
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 100_000,
      daysUntilExpiration: 365,
    })

    const [alert] = generateRebateAlerts([contract])
    expect(alert.title).toBe("Titled Corp is at the Platinum threshold")
  })

  it("does not emit missed_tier_opportunity when contract has already expired (negative days)", () => {
    const contract = baseContract({
      id: "c-expired",
      name: "Expired Co",
      currentSpend: 400_000,
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 50_000,
      daysUntilExpiration: -5,
    })
    const alerts = generateRebateAlerts([contract])
    expect(alerts.map((a) => a.kind)).not.toContain("missed_tier_opportunity")
  })

  it("skips contracts already past the threshold (spendToGo <= 0)", () => {
    const contract = baseContract({
      currentSpend: 1_100_000,
      nextTierThreshold: 1_000_000,
    })
    expect(generateRebateAlerts([contract])).toEqual<RebateAlert[]>([])
  })

  it("approaching + missed co-emit puts missed (high) before approaching (medium)", () => {
    const contract = baseContract({
      id: "c-order",
      name: "Order Co",
      currentSpend: 820_000,
      nextTierThreshold: 1_000_000,
      monthlySpendRate: 100_000,
      daysUntilExpiration: 30,
    })
    const alerts = generateRebateAlerts([contract])
    expect(alerts[0].kind).toBe("missed_tier_opportunity")
    expect(alerts[1].kind).toBe("approaching_next_tier")
  })
})
