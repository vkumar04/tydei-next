import { describe, it, expect } from "vitest"
import {
  canTransition,
  filterTransitionable,
  buildTransitionPatch,
  type AlertStatusValue,
} from "../status-workflow"

describe("canTransition", () => {
  it("new_alert can transition to read, resolved, dismissed", () => {
    expect(canTransition({ from: "new_alert", to: "read" }).allowed).toBe(true)
    expect(canTransition({ from: "new_alert", to: "resolved" }).allowed).toBe(true)
    expect(canTransition({ from: "new_alert", to: "dismissed" }).allowed).toBe(true)
  })

  it("read can transition to resolved, dismissed (but NOT back to new_alert)", () => {
    expect(canTransition({ from: "read", to: "resolved" }).allowed).toBe(true)
    expect(canTransition({ from: "read", to: "dismissed" }).allowed).toBe(true)
    expect(canTransition({ from: "read", to: "new_alert" }).allowed).toBe(false)
  })

  it("resolved can only transition to dismissed", () => {
    expect(canTransition({ from: "resolved", to: "dismissed" }).allowed).toBe(true)
    expect(canTransition({ from: "resolved", to: "read" }).allowed).toBe(false)
    expect(canTransition({ from: "resolved", to: "new_alert" }).allowed).toBe(false)
  })

  it("dismissed is terminal — no transitions out", () => {
    expect(canTransition({ from: "dismissed", to: "read" }).allowed).toBe(false)
    expect(canTransition({ from: "dismissed", to: "resolved" }).allowed).toBe(false)
    expect(canTransition({ from: "dismissed", to: "new_alert" }).allowed).toBe(false)
  })

  it("no-op transitions (from == to) disallowed", () => {
    const result = canTransition({ from: "read", to: "read" })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("no-op")
  })

  it("rejection includes a reason string", () => {
    const result = canTransition({ from: "dismissed", to: "read" })
    expect(result.reason).toContain("dismissed")
    expect(result.reason).toContain("read")
  })
})

describe("filterTransitionable", () => {
  it("returns only alerts that can legally transition to target", () => {
    const alerts = [
      { id: "a", status: "new_alert" as AlertStatusValue },
      { id: "b", status: "read" as AlertStatusValue },
      { id: "c", status: "dismissed" as AlertStatusValue },
      { id: "d", status: "resolved" as AlertStatusValue },
    ]
    const filtered = filterTransitionable(alerts, "resolved")
    // new_alert → resolved OK, read → resolved OK, dismissed → resolved NO,
    // resolved → resolved NO (no-op)
    expect(filtered.map((a) => a.id)).toEqual(["a", "b"])
  })

  it("returns empty when no alerts can transition", () => {
    const alerts = [
      { id: "a", status: "dismissed" as AlertStatusValue },
      { id: "b", status: "resolved" as AlertStatusValue },
    ]
    expect(filterTransitionable(alerts, "read")).toEqual([])
  })

  it("preserves input order of passing alerts", () => {
    const alerts = [
      { id: "x", status: "new_alert" as AlertStatusValue },
      { id: "y", status: "new_alert" as AlertStatusValue },
      { id: "z", status: "new_alert" as AlertStatusValue },
    ]
    expect(filterTransitionable(alerts, "read").map((a) => a.id)).toEqual([
      "x",
      "y",
      "z",
    ])
  })
})

describe("buildTransitionPatch", () => {
  const now = new Date("2026-04-18T12:00:00Z")

  it("to=read sets readAt", () => {
    const patch = buildTransitionPatch("read", now)
    expect(patch).toEqual({ status: "read", readAt: now })
  })

  it("to=resolved sets resolvedAt", () => {
    const patch = buildTransitionPatch("resolved", now)
    expect(patch).toEqual({ status: "resolved", resolvedAt: now })
  })

  it("to=dismissed sets dismissedAt", () => {
    const patch = buildTransitionPatch("dismissed", now)
    expect(patch).toEqual({ status: "dismissed", dismissedAt: now })
  })

  it("to=new_alert clears all stamps (defensive — caller should gate)", () => {
    const patch = buildTransitionPatch("new_alert", now)
    expect(patch).toEqual({
      status: "new_alert",
      readAt: null,
      resolvedAt: null,
      dismissedAt: null,
    })
  })

  it("defaults to new Date() when not supplied", () => {
    const before = Date.now()
    const patch = buildTransitionPatch("read")
    const after = Date.now()
    expect(patch.readAt).toBeInstanceOf(Date)
    const ms = (patch.readAt as Date).getTime()
    expect(ms).toBeGreaterThanOrEqual(before)
    expect(ms).toBeLessThanOrEqual(after)
  })
})
