/**
 * Unit tests for the "Last Action" date resolver behind the vendor
 * "My Contracts" list column (bugs.rtfd 2026-06-11 B4).
 *
 * The rule: pending submissions show `reviewedAt ?? submittedAt`;
 * real Contract rows show `updatedAt`. Inputs may arrive as Date
 * objects or serialized ISO strings — both must normalize.
 */
import { describe, it, expect } from "vitest"
import { resolveLastActionAt } from "@/components/vendor/contracts/last-action"

describe("resolveLastActionAt", () => {
  it("pending with a review decision uses reviewedAt", () => {
    const result = resolveLastActionAt({
      kind: "pending",
      reviewedAt: "2026-06-05T14:30:00.000Z",
      submittedAt: "2026-06-01T09:00:00.000Z",
    })
    expect(result.toISOString()).toBe("2026-06-05T14:30:00.000Z")
  })

  it("pending without a review falls back to submittedAt", () => {
    const result = resolveLastActionAt({
      kind: "pending",
      reviewedAt: null,
      submittedAt: "2026-06-01T09:00:00.000Z",
    })
    expect(result.toISOString()).toBe("2026-06-01T09:00:00.000Z")
  })

  it("contract rows use updatedAt", () => {
    const result = resolveLastActionAt({
      kind: "contract",
      updatedAt: "2026-05-20T18:45:00.000Z",
    })
    expect(result.toISOString()).toBe("2026-05-20T18:45:00.000Z")
  })

  it("passes through Date instances without re-parsing", () => {
    const reviewed = new Date("2026-06-07T10:00:00.000Z")
    const result = resolveLastActionAt({
      kind: "pending",
      reviewedAt: reviewed,
      submittedAt: new Date("2026-06-01T09:00:00.000Z"),
    })
    expect(result).toBe(reviewed)
  })
})
