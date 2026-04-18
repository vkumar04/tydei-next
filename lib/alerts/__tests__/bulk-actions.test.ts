import { describe, it, expect } from "vitest"
import { planBulkAction, summarizeBulkPlan } from "../bulk-actions"

describe("planBulkAction — mark_read", () => {
  it("moves eligible alerts; skips already-read and terminal", () => {
    const plan = planBulkAction({
      action: "mark_read",
      alerts: [
        { id: "a", status: "new_alert" },
        { id: "b", status: "read" },
        { id: "c", status: "resolved" },
        { id: "d", status: "dismissed" },
      ],
      now: new Date("2026-04-18T12:00:00Z"),
    })
    expect(plan.toUpdate.map((x) => x.alertId)).toEqual(["a"])
    expect(plan.skipped.map((x) => x.alertId).sort()).toEqual(["b", "c", "d"])
  })

  it("attaches readAt timestamp patch", () => {
    const now = new Date("2026-04-18T12:00:00Z")
    const plan = planBulkAction({
      action: "mark_read",
      alerts: [{ id: "a", status: "new_alert" }],
      now,
    })
    expect(plan.toUpdate[0].patch).toEqual({
      status: "read",
      readAt: now,
    })
  })
})

describe("planBulkAction — resolve", () => {
  it("promotes new_alert + read to resolved", () => {
    const plan = planBulkAction({
      action: "resolve",
      alerts: [
        { id: "a", status: "new_alert" },
        { id: "b", status: "read" },
      ],
    })
    expect(plan.toUpdate.map((x) => x.alertId).sort()).toEqual(["a", "b"])
  })

  it("skips already-resolved and dismissed", () => {
    const plan = planBulkAction({
      action: "resolve",
      alerts: [
        { id: "a", status: "resolved" },
        { id: "b", status: "dismissed" },
      ],
    })
    expect(plan.toUpdate).toEqual([])
    expect(plan.skipped).toHaveLength(2)
  })
})

describe("planBulkAction — dismiss", () => {
  it("dismisses from any non-dismissed status", () => {
    const plan = planBulkAction({
      action: "dismiss",
      alerts: [
        { id: "a", status: "new_alert" },
        { id: "b", status: "read" },
        { id: "c", status: "resolved" },
      ],
    })
    expect(plan.toUpdate).toHaveLength(3)
  })

  it("skips already-dismissed (no-op transition)", () => {
    const plan = planBulkAction({
      action: "dismiss",
      alerts: [{ id: "a", status: "dismissed" }],
    })
    expect(plan.toUpdate).toEqual([])
    // dismissed → dismissed is a no-op transition
    expect(plan.skipped[0].reason).toMatch(/no-op/)
    expect(plan.skipped[0].currentStatus).toBe("dismissed")
  })
})

describe("planBulkAction — skipped rationale", () => {
  it("records current status + reason for each skipped alert", () => {
    const plan = planBulkAction({
      action: "mark_read",
      alerts: [{ id: "a", status: "dismissed" }],
    })
    expect(plan.skipped[0]).toMatchObject({
      alertId: "a",
      currentStatus: "dismissed",
    })
    expect(plan.skipped[0].reason).toBeTruthy()
  })

  it("handles empty input", () => {
    const plan = planBulkAction({ action: "resolve", alerts: [] })
    expect(plan.toUpdate).toEqual([])
    expect(plan.skipped).toEqual([])
  })
})

describe("summarizeBulkPlan", () => {
  it("computes totals correctly", () => {
    const plan = planBulkAction({
      action: "resolve",
      alerts: [
        { id: "a", status: "new_alert" },
        { id: "b", status: "read" },
        { id: "c", status: "resolved" },
        { id: "d", status: "dismissed" },
      ],
    })
    const summary = summarizeBulkPlan(plan)
    expect(summary.totalSelected).toBe(4)
    expect(summary.willUpdate).toBe(2)
    expect(summary.willSkip).toBe(2)
  })

  it("handles empty plan", () => {
    const plan = planBulkAction({ action: "resolve", alerts: [] })
    const summary = summarizeBulkPlan(plan)
    expect(summary).toEqual({
      totalSelected: 0,
      willUpdate: 0,
      willSkip: 0,
    })
  })
})
