import { describe, expect, it } from "vitest"

import {
  filterAwaitingReview,
  isAwaitingReview,
} from "../pending-awaiting-review"

describe("isAwaitingReview", () => {
  it("returns true only for submitted rows", () => {
    expect(isAwaitingReview({ status: "submitted" })).toBe(true)
    for (const status of [
      "draft",
      "approved",
      "rejected",
      "revision_requested",
      "withdrawn",
    ]) {
      expect(isAwaitingReview({ status })).toBe(false)
    }
  })
})

describe("filterAwaitingReview", () => {
  it("keeps only submitted rows, preserving order and extra fields", () => {
    const rows = [
      { id: "a", status: "submitted" },
      { id: "b", status: "rejected" },
      { id: "c", status: "submitted" },
      { id: "d", status: "approved" },
    ]
    expect(filterAwaitingReview(rows)).toEqual([
      { id: "a", status: "submitted" },
      { id: "c", status: "submitted" },
    ])
  })

  it("returns [] for undefined input (query not yet resolved)", () => {
    expect(filterAwaitingReview(undefined)).toEqual([])
  })

  it("returns [] when nothing is awaiting review", () => {
    expect(
      filterAwaitingReview([
        { status: "approved" },
        { status: "withdrawn" },
      ]),
    ).toEqual([])
  })

  // B3 invariant: the tab-strip badge count and the tab's "awaiting review"
  // rows derive from this one filter — count == rows.length by construction.
  it("badge count equals the number of rows the tab renders", () => {
    const rows = [
      { status: "submitted" },
      { status: "revision_requested" },
      { status: "submitted" },
    ]
    expect(filterAwaitingReview(rows).length).toBe(2)
  })
})
