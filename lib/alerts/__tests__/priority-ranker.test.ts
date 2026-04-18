import { describe, it, expect } from "vitest"
import {
  computePriorityScore,
  rankAlerts,
  type AlertForRanking,
} from "../priority-ranker"

const alert = (overrides: Partial<AlertForRanking> = {}): AlertForRanking => ({
  id: "a-1",
  severity: "medium",
  alertType: "off_contract",
  dollarImpact: null,
  createdAt: new Date("2026-04-18T12:00:00Z"),
  ...overrides,
})

const now = new Date("2026-04-18T12:00:00Z")

describe("computePriorityScore", () => {
  it("high severity adds 100 points", () => {
    const score = computePriorityScore(alert({ severity: "high" }), now)
    // high(100) + off_contract(30) + no dollar + 0 age = 130
    expect(score).toBe(130)
  })

  it("medium severity adds 50 points", () => {
    const score = computePriorityScore(alert({ severity: "medium" }), now)
    expect(score).toBe(80)
  })

  it("low severity adds 15 points", () => {
    const score = computePriorityScore(alert({ severity: "low" }), now)
    expect(score).toBe(45)
  })

  it("adds +50 for dollar impact >= $100K", () => {
    const score = computePriorityScore(
      alert({ severity: "high", dollarImpact: 250_000 }),
      now,
    )
    expect(score).toBe(180) // 100 + 30 + 50
  })

  it("adds +30 for dollar impact >= $25K but < $100K", () => {
    const score = computePriorityScore(
      alert({ severity: "high", dollarImpact: 50_000 }),
      now,
    )
    expect(score).toBe(160)
  })

  it("adds +15 for dollar impact >= $5K but < $25K", () => {
    const score = computePriorityScore(
      alert({ severity: "high", dollarImpact: 10_000 }),
      now,
    )
    expect(score).toBe(145)
  })

  it("adds +5 for dollar impact >= $500 but < $5K", () => {
    const score = computePriorityScore(
      alert({ severity: "high", dollarImpact: 1_000 }),
      now,
    )
    expect(score).toBe(135)
  })

  it("considers absolute value of negative dollar impact", () => {
    const score = computePriorityScore(
      alert({ severity: "high", dollarImpact: -150_000 }),
      now,
    )
    expect(score).toBe(180)
  })

  it("subtracts up to 30 points for age decay", () => {
    const oldAlert = alert({
      severity: "high",
      createdAt: new Date("2026-01-01T12:00:00Z"), // 107 days old
    })
    const score = computePriorityScore(oldAlert, now)
    // high(100) + off_contract(30) − 30 (capped) = 100
    expect(score).toBe(100)
  })

  it("uses different type weights", () => {
    const offContract = computePriorityScore(
      alert({ alertType: "off_contract" }),
      now,
    )
    const expiring = computePriorityScore(
      alert({ alertType: "expiring_contract" }),
      now,
    )
    const other = computePriorityScore(alert({ alertType: "other" }), now)
    expect(offContract).toBeGreaterThan(expiring)
    expect(expiring).toBeGreaterThan(other)
  })

  it("unknown alertType falls back to 'other' weight", () => {
    const score = computePriorityScore(
      alert({ alertType: "some_unknown_kind" }),
      now,
    )
    expect(score).toBe(55) // medium(50) + other(5)
  })
})

describe("rankAlerts", () => {
  it("returns empty for empty input", () => {
    expect(rankAlerts([], now)).toEqual([])
  })

  it("sorts highest-priority first", () => {
    const ranked = rankAlerts(
      [
        alert({ id: "low", severity: "low" }),
        alert({ id: "high", severity: "high" }),
        alert({ id: "medium", severity: "medium" }),
      ],
      now,
    )
    expect(ranked.map((a) => a.id)).toEqual(["high", "medium", "low"])
  })

  it("tiebreaks by id desc when scores are equal", () => {
    const ranked = rankAlerts(
      [
        alert({ id: "alpha", severity: "high" }),
        alert({ id: "charlie", severity: "high" }),
        alert({ id: "bravo", severity: "high" }),
      ],
      now,
    )
    expect(ranked.map((a) => a.id)).toEqual(["charlie", "bravo", "alpha"])
  })

  it("attaches priorityScore to every result", () => {
    const ranked = rankAlerts([alert()], now)
    expect(ranked[0].priorityScore).toBe(80)
  })

  it("does not mutate input array", () => {
    const alerts = [alert({ id: "a" }), alert({ id: "b" })]
    const ref = alerts
    rankAlerts(alerts, now)
    expect(alerts).toBe(ref)
    expect(alerts.map((a) => a.id)).toEqual(["a", "b"])
  })
})
