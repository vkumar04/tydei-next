import { describe, it, expect } from "vitest"
import type { AiAdvisoryProposal, AiReviewPanelState } from "../types"

describe("AiAdvisoryProposal<TSuggestion>", () => {
  it("structurally accepts a vendor-dedup-shaped proposal", () => {
    type VendorDedupSuggestion = { existingVendorId: string; similarityMethod: string }
    const p: AiAdvisoryProposal<VendorDedupSuggestion> = {
      id: "p_1",
      kind: "vendor_dedup",
      title: "Merge 'Medlyne' into 'Medline Industries'",
      reasoning: "single-char typo",
      confidence: 0.91,
      suggestion: { existingVendorId: "v_abc", similarityMethod: "levenshtein" },
      alternatives: [{ existingVendorId: "v_def", similarityMethod: "phonetic" }],
      generatedAt: new Date("2026-04-18T00:00:00Z"),
    }
    expect(p.kind).toBe("vendor_dedup")
    expect(p.suggestion.similarityMethod).toBe("levenshtein")
    expect(p.alternatives?.[0]?.existingVendorId).toBe("v_def")
  })

  it("allows alternatives to be omitted", () => {
    const p: AiAdvisoryProposal<string> = {
      id: "p_2",
      kind: "match_status_explainer",
      title: "Why this row is off-contract",
      reasoning: "...",
      confidence: 0.5,
      suggestion: "plain explanation",
      generatedAt: new Date(),
    }
    expect(p.alternatives).toBeUndefined()
  })
})

describe("AiReviewPanelState", () => {
  it("narrows correctly on the discriminant", () => {
    const states: AiReviewPanelState[] = [
      { status: "idle" },
      { status: "loading" },
      { status: "error", message: "boom" },
      { status: "ready", proposals: [] },
    ]
    for (const s of states) {
      if (s.status === "error") expect(s.message).toBe("boom")
      if (s.status === "ready") expect(Array.isArray(s.proposals)).toBe(true)
    }
  })
})
