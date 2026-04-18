import { describe, it, expect } from "vitest"
import {
  computeDashboardKPIs,
  type KPIInput,
  type KPIInputContract,
} from "../kpi-calc"

const ref = new Date("2026-04-18T00:00:00Z")

const daysFromRef = (days: number): Date => {
  const d = new Date(ref.getTime())
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

const baseInput = (overrides: Partial<KPIInput> = {}): KPIInput => ({
  contracts: [],
  totalSpendYTD: 0,
  rebateAgg: { earned: 0, collected: 0 },
  pendingAlerts: 0,
  referenceDate: ref,
  ...overrides,
})

describe("computeDashboardKPIs", () => {
  it("returns zeroed KPIs for empty input", () => {
    const k = computeDashboardKPIs(baseInput())
    expect(k).toEqual({
      totalContractValue: 0,
      totalSpendYTD: 0,
      spendProgress: 0,
      totalRebatesEarned: 0,
      totalRebatesCollected: 0,
      rebateCollectionRate: 0,
      activeContractsCount: 0,
      expiringContractsCount: 0,
      pendingAlerts: 0,
    })
  })

  it("sums totalValue across active + expiring only", () => {
    const contracts: KPIInputContract[] = [
      { status: "active", totalValue: 1000, expirationDate: daysFromRef(365) },
      { status: "expiring", totalValue: 500, expirationDate: daysFromRef(30) },
      { status: "expired", totalValue: 9999, expirationDate: daysFromRef(-10) },
      { status: "draft", totalValue: 7777, expirationDate: null },
    ]
    const k = computeDashboardKPIs(baseInput({ contracts }))
    expect(k.totalContractValue).toBe(1500)
  })

  it("buckets an active contract within 90 days as expiring", () => {
    const contracts: KPIInputContract[] = [
      { status: "active", totalValue: 200, expirationDate: daysFromRef(45) },
    ]
    const k = computeDashboardKPIs(baseInput({ contracts }))
    expect(k.activeContractsCount).toBe(0)
    expect(k.expiringContractsCount).toBe(1)
  })

  it("treats active contracts with no expirationDate as active", () => {
    const contracts: KPIInputContract[] = [
      { status: "active", totalValue: 100, expirationDate: null },
      { status: "active", totalValue: 200, expirationDate: daysFromRef(365) },
    ]
    const k = computeDashboardKPIs(baseInput({ contracts }))
    expect(k.activeContractsCount).toBe(2)
    expect(k.expiringContractsCount).toBe(0)
  })

  it("computes spendProgress and clamps to 0-1", () => {
    const contracts: KPIInputContract[] = [
      { status: "active", totalValue: 1000, expirationDate: daysFromRef(365) },
    ]
    const k = computeDashboardKPIs(
      baseInput({ contracts, totalSpendYTD: 250 }),
    )
    expect(k.spendProgress).toBeCloseTo(0.25)

    const over = computeDashboardKPIs(
      baseInput({ contracts, totalSpendYTD: 5000 }),
    )
    expect(over.spendProgress).toBe(1)
  })

  it("returns spendProgress=0 when totalContractValue is 0", () => {
    const k = computeDashboardKPIs(baseInput({ totalSpendYTD: 1000 }))
    expect(k.spendProgress).toBe(0)
  })

  it("computes rebateCollectionRate and clamps", () => {
    const k = computeDashboardKPIs(
      baseInput({ rebateAgg: { earned: 1000, collected: 250 } }),
    )
    expect(k.rebateCollectionRate).toBeCloseTo(0.25)

    const over = computeDashboardKPIs(
      baseInput({ rebateAgg: { earned: 100, collected: 500 } }),
    )
    expect(over.rebateCollectionRate).toBe(1)
  })

  it("returns rebateCollectionRate=0 when earned is 0", () => {
    const k = computeDashboardKPIs(
      baseInput({ rebateAgg: { earned: 0, collected: 50 } }),
    )
    expect(k.rebateCollectionRate).toBe(0)
  })

  it("passes through totals and pendingAlerts", () => {
    const k = computeDashboardKPIs(
      baseInput({
        totalSpendYTD: 123,
        rebateAgg: { earned: 1000, collected: 400 },
        pendingAlerts: 7,
      }),
    )
    expect(k.totalSpendYTD).toBe(123)
    expect(k.totalRebatesEarned).toBe(1000)
    expect(k.totalRebatesCollected).toBe(400)
    expect(k.pendingAlerts).toBe(7)
  })

  it("mixes active, expiring, expired, and draft across the portfolio", () => {
    const contracts: KPIInputContract[] = [
      { status: "active", totalValue: 1000, expirationDate: daysFromRef(365) }, // active
      { status: "active", totalValue: 500, expirationDate: daysFromRef(30) }, // expiring
      { status: "expiring", totalValue: 700, expirationDate: daysFromRef(120) }, // expiring
      { status: "expired", totalValue: 250, expirationDate: daysFromRef(-30) }, // ignored
      { status: "draft", totalValue: 999, expirationDate: null }, // ignored
    ]
    const k = computeDashboardKPIs(
      baseInput({
        contracts,
        totalSpendYTD: 600,
        rebateAgg: { earned: 100, collected: 50 },
        pendingAlerts: 3,
      }),
    )
    expect(k.activeContractsCount).toBe(1)
    expect(k.expiringContractsCount).toBe(2)
    expect(k.totalContractValue).toBe(2200)
    expect(k.spendProgress).toBeCloseTo(600 / 2200)
    expect(k.rebateCollectionRate).toBeCloseTo(0.5)
    expect(k.pendingAlerts).toBe(3)
  })

  it("treats expired active contracts (past date) as non-live — neither active nor expiring", () => {
    const contracts: KPIInputContract[] = [
      { status: "active", totalValue: 1000, expirationDate: daysFromRef(-5) },
    ]
    const k = computeDashboardKPIs(baseInput({ contracts }))
    expect(k.activeContractsCount).toBe(0)
    expect(k.expiringContractsCount).toBe(0)
    expect(k.totalContractValue).toBe(0)
  })

  it("defaults referenceDate to now when omitted", () => {
    // An expirationDate far in the future is still considered active.
    const contracts: KPIInputContract[] = [
      {
        status: "active",
        totalValue: 42,
        expirationDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      },
    ]
    const k = computeDashboardKPIs({
      contracts,
      totalSpendYTD: 0,
      rebateAgg: { earned: 0, collected: 0 },
      pendingAlerts: 0,
    })
    expect(k.activeContractsCount).toBe(1)
  })
})
