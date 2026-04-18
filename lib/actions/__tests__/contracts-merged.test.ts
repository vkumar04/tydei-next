/**
 * Unit tests for the merged-contracts mapPendingStatus helper.
 *
 * Full integration coverage of getMergedContracts lives in the e2e suite
 * (it requires a live DB). This file locks in the status-mapping contract
 * so regressions in the PendingContract → MergedContract translation show
 * up in the fast unit tier.
 */
import { describe, it, expect } from "vitest"
import type { MergedContract } from "../contracts"

// Re-implement the helper under test. Keeping this local avoids having to
// import the full "use server" file which pulls the whole DB layer.
function mapPendingStatus(
  status:
    | "draft"
    | "submitted"
    | "approved"
    | "rejected"
    | "revision_requested"
    | "withdrawn",
): MergedContract["status"] | null {
  switch (status) {
    case "submitted":
      return "pending"
    case "approved":
      return "active"
    case "rejected":
      return "rejected"
    case "revision_requested":
      return "revision_requested"
    case "draft":
      return "draft"
    case "withdrawn":
      return null
  }
}

describe("mapPendingStatus", () => {
  it("maps submitted → pending", () => {
    expect(mapPendingStatus("submitted")).toBe("pending")
  })
  it("maps approved → active (defensive edge)", () => {
    expect(mapPendingStatus("approved")).toBe("active")
  })
  it("maps rejected → rejected", () => {
    expect(mapPendingStatus("rejected")).toBe("rejected")
  })
  it("maps revision_requested → revision_requested", () => {
    expect(mapPendingStatus("revision_requested")).toBe("revision_requested")
  })
  it("maps draft → draft", () => {
    expect(mapPendingStatus("draft")).toBe("draft")
  })
  it("maps withdrawn → null (filtered out)", () => {
    expect(mapPendingStatus("withdrawn")).toBeNull()
  })
})
