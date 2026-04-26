import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    contractPeriod: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    surgeonUsage: {
      findMany: vi.fn(),
    },
    alert: {
      findMany: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/db"
import {
  buildVendorChatTools,
  buildFacilityChatTools,
} from "@/lib/ai/tools"

const pr = prisma as unknown as {
  contract: {
    findFirst: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
    count: ReturnType<typeof vi.fn>
  }
  contractPeriod: {
    findFirst: ReturnType<typeof vi.fn>
    findMany: ReturnType<typeof vi.fn>
  }
  surgeonUsage: { findMany: ReturnType<typeof vi.fn> }
  alert: { findMany: ReturnType<typeof vi.fn> }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Helpers ───────────────────────────────────────────
type ToolWithExecute = {
  execute: (
    args: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<unknown>
}

async function callTool(
  t: unknown,
  args: Record<string, unknown>,
): Promise<unknown> {
  // The `tool()` factory from the AI SDK returns an object exposing
  // `execute(input, options?)`. We bypass the model and invoke it directly
  // with the tool's input schema's parsed shape.
  const exec = (t as ToolWithExecute).execute
  return await exec(args, { toolCallId: "t1", messages: [] })
}

// ─── Vendor tools ──────────────────────────────────────
describe("buildVendorChatTools — cross-tenant scope", () => {
  const ctx = { vendorId: "vendor-stryker", userId: "u1" }
  const tools = buildVendorChatTools(ctx)

  it("getContractPerformance: returns error for a contract owned by a different vendor", async () => {
    // Compound where { id, vendorId } silently misses → null.
    pr.contract.findFirst.mockResolvedValue(null)

    const result = await callTool(tools.getContractPerformance, {
      contractId: "medtronic-contract-cuid",
    })

    expect(result).toEqual({ error: "Contract not found" })
    // Critical assertion: the where clause MUST include vendorId from ctx.
    expect(pr.contract.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "medtronic-contract-cuid",
          vendorId: "vendor-stryker",
        }),
      }),
    )
  })

  it("getContractPerformance: returns full payload for the owner vendor", async () => {
    pr.contract.findFirst.mockResolvedValue({
      name: "Stryker MSO",
      vendor: { name: "Stryker" },
      status: "active",
      contractType: "rebate",
      effectiveDate: new Date("2024-01-01"),
      expirationDate: new Date("2026-12-31"),
      terms: [{ tiers: [] }],
      periods: [
        {
          periodStart: new Date("2024-01-01"),
          periodEnd: new Date("2024-12-31"),
          totalSpend: 1_000_000,
          rebateEarned: 30_000,
          tierAchieved: 2,
        },
      ],
    })

    const result = await callTool(tools.getContractPerformance, {
      contractId: "stryker-contract-cuid",
    })

    expect(result).toMatchObject({
      name: "Stryker MSO",
      vendor: "Stryker",
      status: "active",
      type: "rebate",
      termsCount: 1,
    })
  })

  it("getMarketShareAnalysis: rejects facilityId where the vendor has no relationship", async () => {
    pr.contract.count.mockResolvedValue(0)

    const result = await callTool(tools.getMarketShareAnalysis, {
      facilityId: "foreign-facility",
    })

    expect(result).toEqual({ error: "No relationship with that facility" })
    expect(pr.contract.count).toHaveBeenCalledWith({
      where: { vendorId: "vendor-stryker", facilityId: "foreign-facility" },
    })
    // findMany must NOT have been called once we reject
    expect(pr.contract.findMany).not.toHaveBeenCalled()
  })

  it("getMarketShareAnalysis: returns data when relationship exists", async () => {
    pr.contract.count.mockResolvedValue(1)
    pr.contract.findMany.mockResolvedValue([
      {
        name: "Stryker Spine MSO",
        productCategory: { name: "Spine" },
        periods: [{ totalSpend: 500_000 }],
      },
    ])

    const result = await callTool(tools.getMarketShareAnalysis, {
      facilityId: "lighthouse-id",
    })

    expect(result).toMatchObject({
      contractCount: 1,
      totalSpend: 500_000,
    })
    // Confirm findMany was scoped by vendorId
    expect(pr.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          vendorId: "vendor-stryker",
          facilityId: "lighthouse-id",
        }),
      }),
    )
  })

  it("getRebateProjection: scopes contractPeriod.findFirst by vendor", async () => {
    pr.contractPeriod.findFirst.mockResolvedValue(null)

    const result = await callTool(tools.getRebateProjection, {
      contractId: "medtronic-contract-cuid",
    })

    expect(result).toEqual({ error: "No performance period found" })
    expect(pr.contractPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contractId: "medtronic-contract-cuid",
          contract: { vendorId: "vendor-stryker" },
        }),
      }),
    )
  })

  it("vendor tool set does NOT include facility-only tools", () => {
    const keys = Object.keys(tools)
    expect(keys).not.toContain("getSpendAnalysis")
    expect(keys).not.toContain("getSurgeonPerformance")
    expect(keys).not.toContain("getOptimizationSuggestions")
  })
})

// ─── Facility tools ────────────────────────────────────
describe("buildFacilityChatTools — cross-tenant scope", () => {
  const ctx = { facilityId: "lighthouse-surgical", userId: "u2" }
  const tools = buildFacilityChatTools(ctx)

  it("getContractPerformance: scopes by facilityId from ctx (input cannot override)", async () => {
    pr.contract.findFirst.mockResolvedValue(null)

    const result = await callTool(tools.getContractPerformance, {
      contractId: "some-contract",
    })

    expect(result).toEqual({ error: "Contract not found" })
    expect(pr.contract.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "some-contract",
          facilityId: "lighthouse-surgical",
        }),
      }),
    )
  })

  it("getSpendAnalysis: input schema has no facilityId; scope comes from ctx", async () => {
    pr.contractPeriod.findMany.mockResolvedValue([
      {
        totalSpend: 100,
        contract: {
          vendor: { name: "Stryker" },
          productCategory: { name: "Spine" },
        },
      },
      {
        totalSpend: 50,
        contract: {
          vendor: { name: "Medtronic" },
          productCategory: null,
        },
      },
    ])

    const result = await callTool(tools.getSpendAnalysis, {
      startDate: "2024-01-01",
      endDate: "2024-12-31",
    })

    expect(result).toMatchObject({
      totalSpend: 150,
      byVendor: { Stryker: 100, Medtronic: 50 },
      byCategory: { Spine: 100, Uncategorized: 50 },
    })
    expect(pr.contractPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contract: { facilityId: "lighthouse-surgical" },
        }),
      }),
    )
  })

  it("getSurgeonPerformance: scopes by ctx.facilityId, not by any input facilityId", async () => {
    pr.surgeonUsage.findMany.mockResolvedValue([])

    await callTool(tools.getSurgeonPerformance, { surgeonName: null })

    expect(pr.surgeonUsage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          facilityId: "lighthouse-surgical",
        }),
      }),
    )
  })

  it("facility tool set does NOT include vendor-only tools (getMarketShareAnalysis)", () => {
    const keys = Object.keys(tools)
    expect(keys).not.toContain("getMarketShareAnalysis")
  })

  it("getOptimizationSuggestions: scopes by ctx.facilityId", async () => {
    pr.contract.findMany.mockResolvedValue([])

    const result = await callTool(tools.getOptimizationSuggestions, {})

    expect(result).toEqual({ suggestions: [] })
    expect(pr.contract.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          facilityId: "lighthouse-surgical",
          status: "active",
        }),
      }),
    )
  })
})

// ─── Pure-math tool ────────────────────────────────────
describe("calculateProspectiveRebate (no DB / no auth)", () => {
  it("returns yearly breakdown without any DB call", async () => {
    const tools = buildVendorChatTools({ vendorId: "v1", userId: "u1" })
    const result = await callTool(tools.calculateProspectiveRebate, {
      annualSpend: 1_000_000,
      rebateRate: 3,
      contractYears: 2,
      growthRate: null,
    })
    expect(result).toMatchObject({
      totalProjectedRebate: 60_000,
      averageAnnualRebate: 30_000,
    })
    expect(pr.contract.findFirst).not.toHaveBeenCalled()
  })
})

// ─── Route schema (message shape) ──────────────────────
describe("chat route schema accepts both content and parts shapes", () => {
  // Reconstruct the schema inline to test parsing without needing to
  // import the route (which has heavyweight dependencies on auth + prisma).
  // The shape MUST stay in sync with route.ts — see the assertion notes.
  const { z } = require("zod") as typeof import("zod")
  const schema = z.object({
    messages: z.array(
      z
        .object({
          id: z.string(),
          role: z.enum(["user", "assistant", "system"]),
          content: z.string().optional(),
          parts: z
            .array(z.object({ type: z.string() }).passthrough())
            .optional(),
        })
        .passthrough()
        .refine(
          (m: { content?: string; parts?: unknown[] }) =>
            typeof m.content === "string" || Array.isArray(m.parts),
          { message: "message must have content or parts" },
        ),
    ),
    portalType: z.enum(["facility", "vendor"]),
  })

  it("accepts messages with only `parts` (AI SDK v6 useChat shape)", () => {
    const result = schema.safeParse({
      messages: [
        {
          id: "m1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
      ],
      portalType: "vendor",
    })
    expect(result.success).toBe(true)
  })

  it("accepts messages with only `content` (legacy shape)", () => {
    const result = schema.safeParse({
      messages: [{ id: "m1", role: "user", content: "hello" }],
      portalType: "facility",
    })
    expect(result.success).toBe(true)
  })

  it("accepts messages with both `content` and `parts`", () => {
    const result = schema.safeParse({
      messages: [
        {
          id: "m1",
          role: "user",
          content: "hello",
          parts: [{ type: "text", text: "hello" }],
        },
      ],
      portalType: "vendor",
    })
    expect(result.success).toBe(true)
  })

  it("rejects messages with neither `content` nor `parts`", () => {
    const result = schema.safeParse({
      messages: [{ id: "m1", role: "user" }],
      portalType: "vendor",
    })
    expect(result.success).toBe(false)
  })
})
