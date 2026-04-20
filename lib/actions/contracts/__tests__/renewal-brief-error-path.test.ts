/**
 * Regression tests for Charles W1.U-D — Renewal Brief error paths.
 *
 * Three invariants we care about, independent of the happy path covered by
 * `renewal-brief.test.ts`:
 *
 *   1. A contract with `terms.length === 0` must NOT call the AI and must
 *      return a safe fallback brief (empty asks, informative summary). This
 *      avoids burning tokens on "no data" contracts and guards the UI from
 *      whatever Claude decides to emit for an empty input.
 *
 *   2. When Claude returns a payload that fails `renewalBriefSchema`, the
 *      thrown Error's `message` must include the failing field paths — so the
 *      toast is actionable, not "An error occurred in the Server Components
 *      render". We assert a descriptive prefix + specific path mention.
 *
 *   3. When the AI call itself throws (e.g., the exact production failure we
 *      hit: Anthropic 400 from Zod's `.int()` emitting `minimum`/`maximum`),
 *      we surface a clear `AI request error` prefix — not a raw stack.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Mocks (same shape as renewal-brief.test.ts) ────────────────────

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

function emptyTermsContract() {
  return {
    id: "ctr-empty",
    name: "Empty-Terms Agreement",
    contractNumber: "EMPTY-1",
    vendorId: "v-1",
    facilityId: "fac-1",
    vendor: { id: "v-1", name: "Blank Vendor" },
    effectiveDate: new Date("2024-01-01"),
    expirationDate: new Date("2026-01-01"),
    totalValue: 100_000,
    annualValue: 50_000,
    performancePeriod: "quarterly",
    rebatePayPeriod: "quarterly",
    autoRenewal: false,
    terms: [], // ← the critical bit
    rebates: [],
    periods: [],
    changeProposals: [],
  }
}

function richContract() {
  return {
    ...emptyTermsContract(),
    id: "ctr-rich",
    name: "Rich Terms Agreement",
    terms: [
      {
        id: "t-1",
        termName: "Spend rebate",
        termType: "spend_rebate",
        baselineType: "spend_based",
        rebateMethod: "cumulative",
        effectiveStart: new Date("2024-01-01"),
        effectiveEnd: new Date("2026-01-01"),
        spendBaseline: 0,
        tiers: [
          {
            tierNumber: 1,
            tierName: "Base",
            spendMin: 0,
            spendMax: 500_000,
            rebateType: "percent_of_spend",
            rebateValue: 0.02,
          },
        ],
      },
    ],
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
      findFirst: vi.fn(async () => null),
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

// ─── Tests ──────────────────────────────────────────────────────────

describe("generateRenewalBrief — error paths (W1.U-D)", () => {
  beforeEach(() => {
    cacheRows = []
    aiBehaviour = { kind: "respond", value: null }
    contractFindFirstImpl = () => richContract()
  })

  it("returns a safe fallback brief when the contract has zero terms, without calling the AI", async () => {
    contractFindFirstImpl = () => emptyTermsContract()
    const { generateRenewalBrief } = await import(
      "@/lib/actions/contracts/renewal-brief"
    )
    const ai = await import("ai")

    const result = await generateRenewalBrief("ctr-empty")

    expect(result.contractId).toBe("ctr-empty")
    expect(result.primaryAsks).toHaveLength(0)
    expect(result.concessionsOnTable).toHaveLength(0)
    expect(result.performanceSummary.missedTiers).toHaveLength(0)
    expect(result.executiveSummary).toMatch(/no rebate terms/i)

    const aiCalls = (
      ai.generateText as unknown as { mock: { calls: unknown[] } }
    ).mock.calls.length
    expect(aiCalls).toBe(0)
    // No cache row either — there's nothing to cache when we didn't call.
    expect(cacheRows).toHaveLength(0)
  })

  it("surfaces a descriptive, field-citing error when the AI returns a payload that fails schema validation", async () => {
    aiBehaviour = {
      kind: "respond",
      value: {
        contractId: "ctr-rich",
        // Everything else missing / wrong type.
        primaryAsks: "not-an-array",
      },
    }
    const { generateRenewalBrief } = await import(
      "@/lib/actions/contracts/renewal-brief"
    )

    await expect(generateRenewalBrief("ctr-rich")).rejects.toThrow(
      /invalid payload/i,
    )
    // And the field path ("primaryAsks") should be mentioned — not a generic
    // "server components render" digest. This is what the toast surfaces.
    await expect(generateRenewalBrief("ctr-rich")).rejects.toThrow(
      /primaryAsks|executiveSummary|performanceSummary/,
    )
  })

  it("surfaces the AI request error clearly when generateText itself throws (e.g., Anthropic 400)", async () => {
    aiBehaviour = {
      kind: "throw",
      error: new Error(
        "output_config.format.schema: For 'integer' type, properties maximum, minimum are not supported",
      ),
    }
    const { generateRenewalBrief } = await import(
      "@/lib/actions/contracts/renewal-brief"
    )

    await expect(generateRenewalBrief("ctr-rich")).rejects.toThrow(
      /AI request error/i,
    )
    await expect(generateRenewalBrief("ctr-rich")).rejects.toThrow(
      /integer.*minimum/i,
    )
  })
})
