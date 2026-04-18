import { describe, it, expect } from "vitest"
import {
  summarizeAlerts,
  type AlertSummaryInputRow,
} from "../alert-severity"

describe("summarizeAlerts", () => {
  it("returns all zeros for empty input", () => {
    expect(summarizeAlerts({ alerts: [] })).toEqual({
      totalUnresolved: 0,
      highPriority: 0,
      mediumPriority: 0,
      lowPriority: 0,
      byType: {},
    })
  })

  it("counts only unresolved statuses (new_alert + read)", () => {
    const alerts: AlertSummaryInputRow[] = [
      { status: "new_alert", severity: "high", alertType: "expiring" },
      { status: "read", severity: "medium", alertType: "tier" },
      { status: "resolved", severity: "high", alertType: "expiring" },
      { status: "dismissed", severity: "low", alertType: "tier" },
    ]
    const s = summarizeAlerts({ alerts })
    expect(s.totalUnresolved).toBe(2)
  })

  it("counts severity buckets correctly", () => {
    const alerts: AlertSummaryInputRow[] = [
      { status: "new_alert", severity: "high", alertType: "x" },
      { status: "new_alert", severity: "high", alertType: "x" },
      { status: "read", severity: "medium", alertType: "x" },
      { status: "read", severity: "low", alertType: "x" },
      { status: "read", severity: "low", alertType: "x" },
      { status: "read", severity: "low", alertType: "x" },
    ]
    const s = summarizeAlerts({ alerts })
    expect(s.highPriority).toBe(2)
    expect(s.mediumPriority).toBe(1)
    expect(s.lowPriority).toBe(3)
  })

  it("ignores severity from resolved alerts", () => {
    const alerts: AlertSummaryInputRow[] = [
      { status: "resolved", severity: "high", alertType: "x" },
      { status: "resolved", severity: "medium", alertType: "x" },
      { status: "dismissed", severity: "low", alertType: "x" },
    ]
    const s = summarizeAlerts({ alerts })
    expect(s.highPriority).toBe(0)
    expect(s.mediumPriority).toBe(0)
    expect(s.lowPriority).toBe(0)
    expect(s.totalUnresolved).toBe(0)
  })

  it("groups unresolved alerts by alertType", () => {
    const alerts: AlertSummaryInputRow[] = [
      { status: "new_alert", severity: "high", alertType: "expiring" },
      { status: "new_alert", severity: "medium", alertType: "expiring" },
      { status: "read", severity: "low", alertType: "tier_shortfall" },
      { status: "resolved", severity: "high", alertType: "ignored_type" },
    ]
    const s = summarizeAlerts({ alerts })
    expect(s.byType).toEqual({
      expiring: 2,
      tier_shortfall: 1,
    })
    expect(s.byType["ignored_type"]).toBeUndefined()
  })

  it("totalUnresolved equals sum of severity buckets", () => {
    const alerts: AlertSummaryInputRow[] = [
      { status: "new_alert", severity: "high", alertType: "a" },
      { status: "read", severity: "medium", alertType: "b" },
      { status: "read", severity: "low", alertType: "c" },
      { status: "resolved", severity: "high", alertType: "d" },
    ]
    const s = summarizeAlerts({ alerts })
    expect(s.totalUnresolved).toBe(
      s.highPriority + s.mediumPriority + s.lowPriority,
    )
  })

  it("handles alertType with duplicate keys across statuses", () => {
    const alerts: AlertSummaryInputRow[] = [
      { status: "new_alert", severity: "high", alertType: "expiring" },
      { status: "resolved", severity: "high", alertType: "expiring" },
      { status: "read", severity: "medium", alertType: "expiring" },
    ]
    const s = summarizeAlerts({ alerts })
    // resolved row excluded from byType
    expect(s.byType["expiring"]).toBe(2)
  })

  it("distinguishes new_alert from read while both count as unresolved", () => {
    const alerts: AlertSummaryInputRow[] = [
      { status: "new_alert", severity: "high", alertType: "x" },
      { status: "read", severity: "high", alertType: "x" },
    ]
    const s = summarizeAlerts({ alerts })
    expect(s.totalUnresolved).toBe(2)
    expect(s.highPriority).toBe(2)
    expect(s.byType["x"]).toBe(2)
  })

  it("preserves alertType string shape (case-sensitive)", () => {
    const alerts: AlertSummaryInputRow[] = [
      { status: "new_alert", severity: "low", alertType: "Expiring" },
      { status: "new_alert", severity: "low", alertType: "expiring" },
    ]
    const s = summarizeAlerts({ alerts })
    expect(s.byType["Expiring"]).toBe(1)
    expect(s.byType["expiring"]).toBe(1)
  })
})
