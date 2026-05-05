/**
 * Smoke tests for the LLM-based clause extractor.
 *
 * The Anthropic call itself is mocked — we're verifying the prompt
 * shape, the truncation behavior, and that the LLM output flows
 * through to a `ContractClause[]` the canonical analyzer can consume.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
}))

vi.mock("@/lib/ai/generate-structured", () => ({
  generateStructured: generateStructuredMock,
  withCacheControl: () => ({}),
}))

vi.mock("@/lib/ai/config", () => ({
  claudeModel: { id: "claude-opus-4-6" },
  claudeSonnet: { id: "claude-sonnet-4-6" },
  claudeHaiku: { id: "claude-haiku-4-5" },
}))

import {
  extractClauses,
  extractClausesResponseSchema,
} from "../clause-extractor"
import { analyzePDFContract } from "../clause-risk-analyzer"

beforeEach(() => {
  generateStructuredMock.mockReset()
})

describe("extractClauses", () => {
  it("returns an empty list for blank input without calling the LLM", async () => {
    const result = await extractClauses({ pdfText: "   \n\n   " })
    expect(result.clauses).toEqual([])
    expect(result.truncated).toBe(false)
    expect(generateStructuredMock).not.toHaveBeenCalled()
  })

  it("happy path: forwards LLM output as ContractClause[] and feeds the canonical analyzer", async () => {
    generateStructuredMock.mockResolvedValueOnce({
      output: {
        clauses: [
          { category: "PRICING", text: "Prices fixed for the initial term." },
          { category: "REBATE", text: "Tier 1: 2% on first $1M of spend." },
          {
            category: "TERM_AND_RENEWAL",
            text: "Three-year initial term.",
          },
          { category: "TERMINATION", text: "Either party may terminate for cause on 30 days notice." },
          { category: "AUDIT_RIGHTS", text: "Facility may audit twice per year." },
          { category: "INDEMNIFICATION", text: "Vendor indemnifies Facility for IP claims." },
          { category: "GOVERNING_LAW", text: "Governed by the laws of Delaware." },
          {
            category: "ANTI_KICKBACK",
            text:
              "Vendor represents the discount fits the Discount Safe Harbor.",
          },
          { category: "PRICE_PROTECTION", text: "Annual escalation capped at CPI." },
        ],
      },
      text: "",
      modelUsed: "primary",
    })

    const result = await extractClauses({
      pdfText: "Long PDF body about pricing, rebates, term, termination...",
      contractName: "Acme USAGE_SPEND Renewal",
    })

    expect(generateStructuredMock).toHaveBeenCalledTimes(1)
    const callArg = generateStructuredMock.mock.calls[0][0]
    expect(callArg.actionName).toBe("clause-extractor")
    expect(callArg.messages[0].role).toBe("system")
    expect(callArg.messages[1].role).toBe("user")
    expect(callArg.messages[1].content).toContain("Acme USAGE_SPEND Renewal")
    expect(callArg.messages[1].content).toContain(
      "Long PDF body about pricing",
    )

    expect(result.truncated).toBe(false)
    expect(result.modelUsed).toBe("primary")
    expect(result.clauses).toHaveLength(9)
    expect(result.clauses[0]).toEqual({
      category: "PRICING",
      text: "Prices fixed for the initial term.",
    })

    // The output must drop straight into the canonical analyzer.
    const analysis = analyzePDFContract(
      result.clauses,
      "FACILITY",
      "USAGE_SPEND",
      "Acme USAGE_SPEND Renewal",
    )
    expect(analysis.contractName).toBe("Acme USAGE_SPEND Renewal")
    expect(analysis.missingClauses).toHaveLength(0)
    expect(["LOW", "MEDIUM"]).toContain(analysis.overallRiskLevel)
  })

  it("truncates input over 50KB and tells the LLM the text was clipped", async () => {
    generateStructuredMock.mockResolvedValueOnce({
      output: { clauses: [] },
      text: "",
      modelUsed: "primary",
    })

    const huge = "A".repeat(60_000)
    const result = await extractClauses({ pdfText: huge })

    expect(result.truncated).toBe(true)
    const userMsg = generateStructuredMock.mock.calls[0][0].messages[1].content as string
    // Truncation marker should be present in the prompt.
    expect(userMsg).toContain("truncated to the first 50KB")
    // The prompt body should be capped at the configured max.
    expect(userMsg.length).toBeLessThan(60_000 + 1000)
  })

  it("drops MISSING entries (analyzer infers absence on its own)", async () => {
    generateStructuredMock.mockResolvedValueOnce({
      output: {
        clauses: [
          { category: "PRICING", text: "Prices..." },
          { category: "MISSING", text: "n/a" },
          { category: "OTHER", text: "Notice address..." },
        ],
      },
      text: "",
      modelUsed: "primary",
    })

    const result = await extractClauses({ pdfText: "body" })
    const cats = result.clauses.map((c) => c.category)
    expect(cats).toContain("PRICING")
    expect(cats).toContain("OTHER")
    expect(cats).not.toContain("MISSING")
  })

  it("preserves an LLM-supplied detectedRiskLevel override", async () => {
    generateStructuredMock.mockResolvedValueOnce({
      output: {
        clauses: [
          {
            category: "AUTO_RENEWAL",
            text: "5-day non-renewal window.",
            detectedRiskLevel: "CRITICAL",
          },
        ],
      },
      text: "",
      modelUsed: "primary",
    })

    const result = await extractClauses({ pdfText: "body" })
    expect(result.clauses[0].detectedRiskLevel).toBe("CRITICAL")
  })
})

describe("extractClausesResponseSchema", () => {
  it("rejects unknown categories", () => {
    const parsed = extractClausesResponseSchema.safeParse({
      clauses: [{ category: "PIZZA", text: "Pepperoni" }],
    })
    expect(parsed.success).toBe(false)
  })

  it("accepts a known-category clause without a risk override", () => {
    const parsed = extractClausesResponseSchema.safeParse({
      clauses: [{ category: "PRICING", text: "Prices fixed." }],
    })
    expect(parsed.success).toBe(true)
  })
})
