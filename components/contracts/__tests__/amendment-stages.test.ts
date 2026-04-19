import { describe, it, expect, vi } from "vitest"

// The amendment-extractor module is a client component whose import chain
// touches server actions (which transitively pull in Stripe). Mock those
// boundaries so the pure `nextStage` helper can be imported in isolation.
vi.mock("@/lib/actions/contracts", () => ({
  updateContract: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import {
  nextStage,
  type Stage,
} from "@/components/contracts/amendment-extractor"

describe("amendment-extractor stage progression", () => {
  it("advances upload → review → confirm → applying → done", () => {
    let s: Stage = "upload"
    const seen: Stage[] = [s]
    let next = nextStage(s)
    while (next !== null) {
      s = next
      seen.push(s)
      next = nextStage(s)
    }
    expect(seen).toEqual([
      "upload",
      "review",
      "confirm",
      "applying",
      "done",
    ])
  })

  it("returns null at terminal stage", () => {
    expect(nextStage("done")).toBeNull()
  })
})
