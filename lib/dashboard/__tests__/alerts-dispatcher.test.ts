import { describe, it, expect } from "vitest"
import { dispatchDashboardAlerts } from "../alerts-dispatcher"
import type { RankedAlert } from "@/lib/alerts/priority-ranker"

const makeAlert = (
  id: string,
  alertType: string,
  priorityScore: number,
): RankedAlert => ({
  id,
  severity: "medium",
  alertType,
  dollarImpact: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  priorityScore,
})

describe("dispatchDashboardAlerts", () => {
  it("defaults the limit to 5 when not provided", () => {
    const rankedAlerts: RankedAlert[] = Array.from({ length: 8 }, (_, i) =>
      makeAlert(`a${i}`, "off_contract", 100 - i),
    )
    const result = dispatchDashboardAlerts({ rankedAlerts })
    expect(result.top).toHaveLength(5)
    expect(result.top.map((a) => a.id)).toEqual(["a0", "a1", "a2", "a3", "a4"])
    expect(result.moreCount).toBe(3)
  })

  it("honors a custom limit", () => {
    const rankedAlerts: RankedAlert[] = Array.from({ length: 6 }, (_, i) =>
      makeAlert(`a${i}`, "off_contract", 100 - i),
    )
    const result = dispatchDashboardAlerts({ rankedAlerts, limit: 3 })
    expect(result.top).toHaveLength(3)
    expect(result.moreCount).toBe(3)
  })

  it("filters to only the requested alert types", () => {
    const rankedAlerts: RankedAlert[] = [
      makeAlert("a1", "off_contract", 100),
      makeAlert("a2", "rebate_due", 90),
      makeAlert("a3", "expiring_contract", 80),
      makeAlert("a4", "off_contract", 70),
    ]
    const result = dispatchDashboardAlerts({
      rankedAlerts,
      includeTypes: ["off_contract"],
    })
    expect(result.top.map((a) => a.id)).toEqual(["a1", "a4"])
    expect(result.moreCount).toBe(0)
  })

  it("computes moreCount from the filtered-but-not-selected remainder", () => {
    const rankedAlerts: RankedAlert[] = [
      makeAlert("a1", "off_contract", 100),
      makeAlert("a2", "off_contract", 90),
      makeAlert("a3", "off_contract", 80),
      makeAlert("a4", "off_contract", 70),
      makeAlert("a5", "rebate_due", 60),
    ]
    const result = dispatchDashboardAlerts({
      rankedAlerts,
      limit: 2,
      includeTypes: ["off_contract"],
    })
    expect(result.top.map((a) => a.id)).toEqual(["a1", "a2"])
    // 4 match the filter, 2 selected → 2 more.
    expect(result.moreCount).toBe(2)
  })

  it("returns empty top and zero moreCount for empty input", () => {
    const result = dispatchDashboardAlerts({ rankedAlerts: [] })
    expect(result.top).toEqual([])
    expect(result.moreCount).toBe(0)
  })

  it("treats an empty includeTypes array as 'no filter'", () => {
    const rankedAlerts: RankedAlert[] = [
      makeAlert("a1", "off_contract", 100),
      makeAlert("a2", "rebate_due", 90),
    ]
    const result = dispatchDashboardAlerts({
      rankedAlerts,
      includeTypes: [],
    })
    expect(result.top).toHaveLength(2)
    expect(result.moreCount).toBe(0)
  })

  it("returns the entire filtered list when limit exceeds length", () => {
    const rankedAlerts: RankedAlert[] = [
      makeAlert("a1", "off_contract", 100),
      makeAlert("a2", "off_contract", 90),
    ]
    const result = dispatchDashboardAlerts({ rankedAlerts, limit: 10 })
    expect(result.top).toHaveLength(2)
    expect(result.moreCount).toBe(0)
  })

  it("returns empty top and full moreCount when limit is zero", () => {
    const rankedAlerts: RankedAlert[] = [
      makeAlert("a1", "off_contract", 100),
      makeAlert("a2", "rebate_due", 90),
    ]
    const result = dispatchDashboardAlerts({ rankedAlerts, limit: 0 })
    expect(result.top).toEqual([])
    expect(result.moreCount).toBe(2)
  })

  it("preserves the upstream ranking order", () => {
    const rankedAlerts: RankedAlert[] = [
      makeAlert("zzz", "off_contract", 200),
      makeAlert("aaa", "off_contract", 100),
    ]
    const result = dispatchDashboardAlerts({ rankedAlerts })
    expect(result.top.map((a) => a.id)).toEqual(["zzz", "aaa"])
  })
})
