/**
 * Unit tests for `lib/actions/contracts/renewal-brief.ts`.
 *
 * Strategy mirrors the Wave 1 `rebate-optimizer-insights` suite:
 *   - `@/lib/actions/auth` stubbed so `requireFacility` returns a stable facility.
 *   - `@/lib/db` stubbed with `contract.findFirst` + cache CRUD.
 *   - `ai` (Vercel AI SDK) stubbed so `generateText` returns a controlled
 *     payload; `Output.object` is a passthrough.
 *
 * We assert:
 *   - Happy path: Claude is called once, cache row persisted, response returned.
 *   - Cache hit: second call reuses the row (no extra `generateText` call).
 *   - forceFresh: bypasses cache even when a non-expired row exists.
 *   - Zod validation: malformed AI payloads throw "generation failed".
 *   - Facility ownership: `contract.findFirst` returns null → throws.
 *   - Missing contract: same ownership guard branch as above.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    user: { id: "user-1" },
    facility: { id: "fac-1", name: "Test Facility" },
  })),
}))

type CacheRow = {
  id: string
  contractId: string
  inputHash: string
  response: unknown
  model: string
  expiresAt: Date
  createdAt: Date
}

let cacheRows: CacheRow[] = []
let contractFindFirstImpl: (args: {
  where: unknown
  include?: unknown
}) => unknown | Promise<unknown> = () => null

function sampleContract() {
  return {
    id: "ctr-1",
    name: "Arthrex Arthroscopy",
    contractNumber: "ARX-2024",
    vendorId: "v-1",
    facilityId: "fac-1",
    vendor: { id: "v-1", name: "Arthrex" },
    effectiveDate: new Date("2024-07-01"),
    expirationDate: new Date("2026-07-01"),
    totalValue: 3_800_000,
    annualValue: 1_900_000,
    performancePeriod: "quarterly",
    rebatePayPeriod: "quarterly",
    autoRenewal: true,
    terms: [
      {
        id: "t-1",
        termName: "Spend rebate",
        termType: "spend_rebate",
        baselineType: "spend_based",
        rebateMethod: "cumulative",
        effectiveStart: new Date("2024-07-01"),
        effectiveEnd: new Date("2026-07-01"),
        spendBaseline: 0,
        tiers: [
          {
            tierNumber: 1,
            tierName: "Base",
            spendMin: 0,
            spendMax: 500_000,
            rebateType: "percent_of_spend",
            rebateValue: 0.01,
          },
          {
            tierNumber: 2,
            tierName: "Growth",
            spendMin: 500_000,
            spendMax: 1_000_000,
            rebateType: "percent_of_spend",
            rebateValue: 0.02,
          },
        ],
      },
    ],
    rebates: [
      {
        id: "r-1",
        periodId: "p-1",
        rebateEarned: 22_000,
        rebateCollected: 22_000,
        payPeriodStart: new Date("2025-01-01"),
        payPeriodEnd: new Date("2025-03-31"),
        collectionDate: new Date("2025-04-30"),
      },
    ],
    periods: [
      {
        id: "p-1",
        periodStart: new Date("2025-01-01"),
        periodEnd: new Date("2025-03-31"),
        totalSpend: 440_000,
        rebateEarned: 22_000,
        rebateCollected: 22_000,
        tierAchieved: 2,
      },
    ],
    changeProposals: [],
  }
}

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn((args: { where: unknown; include?: unknown }) =>
        Promise.resolve(contractFindFirstImpl(args)),
      ),
    },
    renewalBriefCache: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { contractId: string; inputHash: string; expiresAt: { gt: Date } }
          orderBy?: unknown
        }) => {
          const row = cacheRows.find(
            (r) =>
              r.contractId === where.contractId &&
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
  },
}))

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

describe("generateRenewalBrief server action", () => {
  beforeEach(() => {
    cacheRows = []
    aiResponse = null
    contractFindFirstImpl = () => sampleContract()
  })

  function validBriefPayload() {
    return {
      contractId: "ctr-1",
      generatedAt: new Date().toISOString(),
      executiveSummary:
        "The contract has captured 60% of available rebate; tier recalibration is the highest-value ask.",
      performanceSummary: {
        termMonths: 24,
        totalSpend: 3_200_000,
        projectedFullSpend: 3_800_000,
        captureRate: 0.6,
        missedTiers: [
          {
            quarter: "2025-Q2",
            tierMissed: 3,
            shortfallDollars: 58_000,
            estimatedLostRebate: 14_500,
          },
        ],
      },
      primaryAsks: [
        {
          rank: 1,
          ask: "Lower Tier 3 threshold by 10%",
          rationale:
            "Would have captured Tier 3 in 8/8 quarters if the threshold had been 10% lower.",
          quantifiedImpact: "+$62K retroactive",
        },
      ],
      concessionsOnTable: [
        {
          concession: "Extend term to 3 years",
          estimatedCost: "~$32K over 3 years",
        },
      ],
    }
  }

  it("calls Claude and persists a cache row on the first call", async () => {
    aiResponse = validBriefPayload()
    const { generateRenewalBrief } = await import(
      "@/lib/actions/contracts/renewal-brief"
    )

    const result = await generateRenewalBrief("ctr-1")
    expect(result.contractId).toBe("ctr-1")
    expect(result.primaryAsks).toHaveLength(1)
    expect(cacheRows).toHaveLength(1)
  })

  it("returns the cached response on second call (no AI hit)", async () => {
    aiResponse = validBriefPayload()
    const { generateRenewalBrief } = await import(
      "@/lib/actions/contracts/renewal-brief"
    )
    const ai = await import("ai")

    await generateRenewalBrief("ctr-1")
    const callsAfterFirst = (
      ai.generateText as unknown as { mock: { calls: unknown[] } }
    ).mock.calls.length

    const second = await generateRenewalBrief("ctr-1")
    expect(second.contractId).toBe("ctr-1")
    expect(cacheRows).toHaveLength(1)
    const callsAfterSecond = (
      ai.generateText as unknown as { mock: { calls: unknown[] } }
    ).mock.calls.length
    expect(callsAfterSecond).toBe(callsAfterFirst)
  })

  it("bypasses the cache when forceFresh is true", async () => {
    aiResponse = validBriefPayload()
    const { generateRenewalBrief } = await import(
      "@/lib/actions/contracts/renewal-brief"
    )
    const ai = await import("ai")

    await generateRenewalBrief("ctr-1")
    const callsBefore = (
      ai.generateText as unknown as { mock: { calls: unknown[] } }
    ).mock.calls.length

    await generateRenewalBrief("ctr-1", { forceFresh: true })
    const callsAfter = (
      ai.generateText as unknown as { mock: { calls: unknown[] } }
    ).mock.calls.length
    expect(callsAfter).toBe(callsBefore + 1)
    expect(cacheRows).toHaveLength(2)
  })

  it("throws when the AI response does not match the schema", async () => {
    aiResponse = { contractId: "ctr-1" } // missing required fields
    const { generateRenewalBrief } = await import(
      "@/lib/actions/contracts/renewal-brief"
    )

    await expect(generateRenewalBrief("ctr-1")).rejects.toThrow(
      /generation failed/i,
    )
  })

  it("throws when the contract is not owned by the caller's facility", async () => {
    // The ownership predicate lives in the `where` clause of contract.findFirst,
    // so when the row resolves null we know the guard fired.
    contractFindFirstImpl = () => null
    const { generateRenewalBrief } = await import(
      "@/lib/actions/contracts/renewal-brief"
    )

    await expect(generateRenewalBrief("ctr-other")).rejects.toThrow(
      /not found|not owned/i,
    )
  })

  it("passes a contractOwnershipWhere-shaped where clause to Prisma", async () => {
    aiResponse = validBriefPayload()
    const { prisma } = await import("@/lib/db")
    const { generateRenewalBrief } = await import(
      "@/lib/actions/contracts/renewal-brief"
    )

    await generateRenewalBrief("ctr-1")

    const findFirst = prisma.contract.findFirst as unknown as {
      mock: { calls: Array<[{ where: { id: string; OR: unknown[] } }]> }
    }
    const lastCall = findFirst.mock.calls[findFirst.mock.calls.length - 1]
    const where = lastCall[0].where
    expect(where.id).toBe("ctr-1")
    // contractOwnershipWhere always emits an OR with facility-scope branches.
    expect(Array.isArray(where.OR)).toBe(true)
    expect(where.OR.length).toBeGreaterThanOrEqual(1)
  })
})

/**
 * Integration test placeholder — real Anthropic API call tagged `@ai`, skipped
 * by default. To run: `bunx vitest run -t '@ai'` with `ANTHROPIC_API_KEY` set.
 */
describe.skip("@ai integration — live Claude call", () => {
  it("returns a schema-valid response for a real contract fixture", async () => {
    // Intentionally skipped. Unskip locally when you want to burn tokens to
    // validate the prompt + schema against the live API. See
    // docs/superpowers/specs/2026-04-19-rebate-optimizer-ai-design.md §6.
    expect(true).toBe(true)
  })
})
