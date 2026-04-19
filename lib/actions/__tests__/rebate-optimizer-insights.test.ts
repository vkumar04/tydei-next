/**
 * Unit tests for `lib/actions/rebate-optimizer-insights.ts`.
 *
 * We mock:
 *   - `@/lib/actions/auth` so `requireFacility` returns a stable facility/user.
 *   - `@/lib/actions/rebate-optimizer-engine` so no Prisma hits are needed for
 *     the upstream engine calls.
 *   - `@/lib/db` for the COG spend read + the cache/flag tables.
 *   - `ai` (Vercel AI SDK) so the Claude call returns a fixture payload.
 *
 * We verify:
 *   - cache hit short-circuits the AI call
 *   - `forceFresh: true` bypasses the cache even when a non-expired row exists
 *   - a malformed AI response throws
 *   - `flagRebateInsight` persists + returns an id
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { RebateInsight } from "@/lib/ai/rebate-optimizer-schemas"

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    user: { id: "user-1" },
    facility: { id: "fac-1", name: "Test Facility" },
  })),
}))

vi.mock("@/lib/actions/rebate-optimizer-engine", () => ({
  getRebateOpportunities: vi.fn(async () => ({
    opportunities: [
      {
        contractId: "ctr-1",
        contractName: "Stryker Joint",
        vendorId: "v-1",
        vendorName: "Stryker",
        currentSpend: 1_000_000,
        currentTierNumber: 2,
        nextTierNumber: 3,
        nextTierThreshold: 1_200_000,
        additionalRebate: 22_400,
        daysRemaining: 47,
      },
    ],
    droppedContracts: [],
    rankedAlerts: [
      {
        id: "alert-1",
        kind: "approaching_tier",
        title: "Approaching tier 3",
        message: "…",
        contractId: "ctr-1",
        impactDollars: 22_400,
      },
    ],
  })),
}))

type CacheRow = {
  id: string
  facilityId: string
  inputHash: string
  response: unknown
  model: string
  expiresAt: Date
  createdAt: Date
}

type FlagRow = {
  id: string
  facilityId: string
  insightId: string
  title: string
  summary: string
  snapshot: unknown
  flaggedBy: string
  createdAt: Date
}

let cacheRows: CacheRow[] = []
let flagRows: FlagRow[] = []

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      groupBy: vi.fn(async () => [
        { vendorId: "v-1", _sum: { extendedPrice: 540_000 } },
      ]),
    },
    vendor: {
      findMany: vi.fn(async () => [{ id: "v-1", name: "Stryker" }]),
    },
    rebateInsightCache: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { facilityId: string; inputHash: string; expiresAt: { gt: Date } }
          orderBy?: unknown
        }) => {
          const row = cacheRows.find(
            (r) =>
              r.facilityId === where.facilityId &&
              r.inputHash === where.inputHash &&
              r.expiresAt > where.expiresAt.gt,
          )
          return row ?? null
        },
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<CacheRow, "id" | "createdAt">
        }) => {
          const row: CacheRow = {
            ...data,
            id: `cache-${cacheRows.length + 1}`,
            createdAt: new Date(),
          }
          cacheRows.push(row)
          return row
        },
      ),
    },
    rebateInsightFlag: {
      create: vi.fn(
        async ({ data }: { data: Omit<FlagRow, "id" | "createdAt"> }) => {
          const row: FlagRow = {
            ...data,
            id: `flag-${flagRows.length + 1}`,
            createdAt: new Date(),
          }
          flagRows.push(row)
          return row
        },
      ),
      findMany: vi.fn(async () =>
        [...flagRows].sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        ),
      ),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => {
        const before = flagRows.length
        flagRows = flagRows.filter((r) => r.id !== where.id)
        return { count: before - flagRows.length }
      }),
    },
  },
}))

// `ai` → generateText + Output.object. We stub generateText so the test
// controls what Claude returns; Output.object is a passthrough that returns
// an opaque marker — the action doesn't inspect it.
let aiResponse: unknown = null

vi.mock("ai", () => ({
  generateText: vi.fn(async () => ({ output: aiResponse })),
  Output: {
    object: vi.fn(() => ({ __type: "zod-object" })),
  },
}))

vi.mock("@/lib/ai/config", () => ({
  claudeModel: { __model: "stub" },
}))

// ─── Test body ──────────────────────────────────────────────────

describe("rebate-optimizer-insights server action", () => {
  beforeEach(() => {
    cacheRows = []
    flagRows = []
    aiResponse = null
  })

  function validResponsePayload() {
    return {
      facilityId: "fac-1",
      generatedAt: new Date().toISOString(),
      insights: [
        {
          id: "redirect-stryker-1",
          rank: 1,
          title: "Redirect spend to Stryker Tier 3",
          summary: "Shift $63K to unlock tier 3 rebate.",
          rationale:
            "Current spend is $1M vs $1.2M threshold. Recent spend trend supports reaching tier 3 by end of quarter.",
          impactDollars: 22_400,
          confidence: "high" as const,
          actionType: "redirect_spend" as const,
          citedContractIds: ["ctr-1"],
        },
      ],
    }
  }

  it("calls Claude and returns a validated response on first call", async () => {
    aiResponse = validResponsePayload()
    const { getRebateOptimizerInsights } = await import(
      "@/lib/actions/rebate-optimizer-insights"
    )

    const result = await getRebateOptimizerInsights("fac-1")
    expect(result.insights).toHaveLength(1)
    expect(result.insights[0].id).toBe("redirect-stryker-1")
    expect(cacheRows).toHaveLength(1)
  })

  it("returns the cached response on second call (no AI hit)", async () => {
    aiResponse = validResponsePayload()
    const { getRebateOptimizerInsights } = await import(
      "@/lib/actions/rebate-optimizer-insights"
    )
    const ai = await import("ai")

    const first = await getRebateOptimizerInsights("fac-1")
    expect(first.insights).toHaveLength(1)
    const callCountAfterFirst = (ai.generateText as unknown as { mock: { calls: unknown[] } }).mock
      .calls.length

    const second = await getRebateOptimizerInsights("fac-1")
    expect(second.insights).toHaveLength(1)
    expect(cacheRows).toHaveLength(1)
    const callCountAfterSecond = (ai.generateText as unknown as { mock: { calls: unknown[] } })
      .mock.calls.length
    expect(callCountAfterSecond).toBe(callCountAfterFirst)
  })

  it("bypasses the cache when forceFresh is true", async () => {
    aiResponse = validResponsePayload()
    const { getRebateOptimizerInsights } = await import(
      "@/lib/actions/rebate-optimizer-insights"
    )
    const ai = await import("ai")

    await getRebateOptimizerInsights("fac-1")
    const callsBefore = (ai.generateText as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length

    await getRebateOptimizerInsights("fac-1", { forceFresh: true })
    const callsAfter = (ai.generateText as unknown as { mock: { calls: unknown[] } }).mock.calls
      .length
    expect(callsAfter).toBe(callsBefore + 1)
    expect(cacheRows).toHaveLength(2)
  })

  it("throws when the AI response does not match the schema", async () => {
    aiResponse = { facilityId: "fac-1" } // missing required fields
    const { getRebateOptimizerInsights } = await import(
      "@/lib/actions/rebate-optimizer-insights"
    )

    await expect(getRebateOptimizerInsights("fac-1")).rejects.toThrow(
      /generation failed/i,
    )
  })

  it("persists a flagged insight", async () => {
    const { flagRebateInsight } = await import(
      "@/lib/actions/rebate-optimizer-insights"
    )
    const insight: RebateInsight = validResponsePayload().insights[0]
    const { id } = await flagRebateInsight({
      insightId: insight.id,
      snapshot: insight,
    })
    expect(id).toBe("flag-1")
    expect(flagRows).toHaveLength(1)
    expect(flagRows[0].title).toBe(insight.title)
  })

  it("listRebateInsightFlags returns the persisted flags for the caller's facility", async () => {
    const { flagRebateInsight, listRebateInsightFlags } = await import(
      "@/lib/actions/rebate-optimizer-insights"
    )
    const insight: RebateInsight = validResponsePayload().insights[0]
    await flagRebateInsight({ insightId: insight.id, snapshot: insight })
    const flags = await listRebateInsightFlags("fac-1")
    expect(flags).toHaveLength(1)
    expect(flags[0].title).toBe(insight.title)
    expect(flags[0].snapshot.id).toBe(insight.id)
  })

  it("clearRebateInsightFlag removes a flag", async () => {
    const { flagRebateInsight, clearRebateInsightFlag } = await import(
      "@/lib/actions/rebate-optimizer-insights"
    )
    const insight: RebateInsight = validResponsePayload().insights[0]
    const { id } = await flagRebateInsight({
      insightId: insight.id,
      snapshot: insight,
    })
    expect(flagRows).toHaveLength(1)
    await clearRebateInsightFlag(id)
    expect(flagRows).toHaveLength(0)
  })
})

/**
 * Integration test placeholder — real Anthropic API call tagged `@ai`, skipped
 * by default. To run: `bunx vitest run -t '@ai'` with `ANTHROPIC_API_KEY` set.
 */
describe.skip("@ai integration — live Claude call", () => {
  it("returns a schema-valid response for a fixture facility", async () => {
    // Intentionally skipped. Unskip locally when you want to burn tokens to
    // validate prompt structure against the live API. See
    // docs/superpowers/specs/2026-04-19-rebate-optimizer-ai-design.md §6.
    expect(true).toBe(true)
  })
})
