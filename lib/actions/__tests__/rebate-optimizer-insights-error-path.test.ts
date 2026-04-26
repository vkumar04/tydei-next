/**
 * Regression tests for the CLAUDE.md "AI-action error path" contract on
 * `getRebateOptimizerInsights`.
 *
 * Three invariants:
 *
 *   1. When `generateText` itself throws, we log the raw exception with the
 *      `[getRebateOptimizerInsights]` tag + `{ facilityId }` context BEFORE
 *      re-throwing — so server logs in prod still have a debug trail.
 *   2. The user-facing message names the action ("AI Smart Recommendations
 *      generation failed") and the failure kind ("AI request error: …") for
 *      `generateText` failures.
 *   3. When the AI returns a payload that fails Zod validation, the user-facing
 *      message uses the "AI returned an invalid payload: <path>: <issue>"
 *      pattern — never a generic "Server Components render" digest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    user: { id: "user-1" },
    facility: { id: "fac-1", name: "Test Facility" },
  })),
}))

vi.mock("@/lib/actions/rebate-optimizer-engine", () => ({
  getRebateOpportunities: vi.fn(async () => ({
    opportunities: [],
    droppedContracts: [],
    rankedAlerts: [],
  })),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      groupBy: vi.fn(async () => []),
    },
    vendor: {
      findMany: vi.fn(async () => []),
    },
    rebateInsightCache: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "cache-1" })),
    },
  },
}))

let aiBehaviour:
  | { kind: "respond"; value: unknown }
  | { kind: "throw"; error: Error } = {
  kind: "respond",
  value: null,
}

vi.mock("ai", () => ({
  generateText: vi.fn(async () => {
    if (aiBehaviour.kind === "throw") throw aiBehaviour.error
    return { output: aiBehaviour.value }
  }),
  Output: {
    object: vi.fn(() => ({ __type: "zod-object" })),
  },
}))

vi.mock("@/lib/ai/config", () => ({
  claudeModel: { __model: "stub" },
}))

describe("getRebateOptimizerInsights — AI-action error path", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    aiBehaviour = { kind: "respond", value: null }
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("logs with the action tag + facility context and surfaces 'AI request error' when generateText throws", async () => {
    aiBehaviour = {
      kind: "throw",
      error: new Error(
        "output_config.format.schema: For 'integer' type, properties maximum, minimum are not supported",
      ),
    }
    const { getRebateOptimizerInsights } = await import(
      "@/lib/actions/rebate-optimizer-insights"
    )

    await expect(getRebateOptimizerInsights("fac-1")).rejects.toThrow(
      /AI request error/i,
    )
    await expect(getRebateOptimizerInsights("fac-1")).rejects.toThrow(
      /integer.*minimum/i,
    )

    // The console.error tag is the only debug trail in prod (the user sees a
    // generic digest); make sure the tag + context survived the refactor.
    const tagged = consoleErrorSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "[getRebateOptimizerInsights]",
    )
    expect(tagged).toBeTruthy()
    expect(tagged?.[2]).toMatchObject({ facilityId: "fac-1" })
  })

  it("surfaces 'AI returned an invalid payload: <path>: <issue>' when the response fails schema validation", async () => {
    aiBehaviour = {
      kind: "respond",
      value: { facilityId: "fac-1" }, // missing insights[]
    }
    const { getRebateOptimizerInsights } = await import(
      "@/lib/actions/rebate-optimizer-insights"
    )

    await expect(getRebateOptimizerInsights("fac-1")).rejects.toThrow(
      /invalid payload/i,
    )
    await expect(getRebateOptimizerInsights("fac-1")).rejects.toThrow(
      /insights|generatedAt/,
    )

    const tagged = consoleErrorSpy.mock.calls.find(
      (c: unknown[]) => c[0] === "[getRebateOptimizerInsights]",
    )
    expect(tagged).toBeTruthy()
    expect(tagged?.[2]).toMatchObject({ facilityId: "fac-1" })
  })
})
