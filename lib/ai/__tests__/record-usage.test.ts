import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({
  prisma: {
    aICredit: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    aIUsageRecord: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { prisma } from "@/lib/db"
import { recordClaudeUsage } from "@/lib/ai/record-usage"

const pr = prisma as unknown as {
  aICredit: {
    findFirst: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  aIUsageRecord: { create: ReturnType<typeof vi.fn> }
  $transaction: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("recordClaudeUsage", () => {
  it("records usage and debits existing AICredit row", async () => {
    pr.aICredit.findFirst.mockResolvedValue({
      id: "credit-1",
      facilityId: "f1",
      vendorId: null,
      tierId: "enterprise",
      monthlyCredits: 1_000_000,
      usedCredits: 0,
      rolloverCredits: 0,
    })
    pr.$transaction.mockImplementation(async (ops: unknown[]) => {
      // Return shape: [createResult, updateResult]
      void ops
      return [
        { id: "usage-1" },
        {
          id: "credit-1",
          monthlyCredits: 1_000_000,
          rolloverCredits: 0,
          usedCredits: 3,
        },
      ]
    })

    const result = await recordClaudeUsage({
      facilityId: "f1",
      userId: "u1",
      userName: "Test User",
      action: "ai_chat_question",
      description: "test chat",
    })

    expect(pr.aICredit.findFirst).toHaveBeenCalledWith({
      where: { facilityId: "f1" },
      orderBy: { billingPeriodEnd: "desc" },
    })
    expect(pr.aICredit.create).not.toHaveBeenCalled()
    expect(pr.$transaction).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      recorded: true,
      creditsUsed: 3,
      remaining: 999_997,
    })
  })

  it("lazily provisions a default AICredit row when none exists", async () => {
    pr.aICredit.findFirst.mockResolvedValue(null)
    pr.aICredit.create.mockResolvedValue({
      id: "credit-new",
      facilityId: "f1",
      vendorId: null,
      tierId: "enterprise",
      monthlyCredits: 1_000_000,
      usedCredits: 0,
      rolloverCredits: 0,
    })
    pr.$transaction.mockResolvedValue([
      { id: "usage-1" },
      {
        id: "credit-new",
        monthlyCredits: 1_000_000,
        rolloverCredits: 0,
        usedCredits: 10,
      },
    ])

    const result = await recordClaudeUsage({
      facilityId: "f1",
      userId: "u1",
      userName: "Test",
      action: "ai_recommendation",
      description: "rebate insight",
    })

    expect(pr.aICredit.create).toHaveBeenCalledTimes(1)
    const createArgs = pr.aICredit.create.mock.calls[0][0]
    expect(createArgs.data.facilityId).toBe("f1")
    expect(createArgs.data.tierId).toBe("enterprise")
    expect(createArgs.data.monthlyCredits).toBe(1_000_000)
    expect(result.recorded).toBe(true)
    expect(result.creditsUsed).toBe(10)
  })

  it("returns recorded:false when prisma throws (never throws)", async () => {
    pr.aICredit.findFirst.mockRejectedValue(new Error("db down"))
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await recordClaudeUsage({
      facilityId: "f1",
      userId: "u1",
      userName: "Test",
      action: "ai_chat_question",
      description: "x",
    })

    expect(result).toEqual({
      recorded: false,
      creditsUsed: 3,
      remaining: null,
    })
    expect(errorSpy).toHaveBeenCalledWith(
      "[recordClaudeUsage]",
      expect.any(Error),
      expect.objectContaining({ facilityId: "f1", action: "ai_chat_question" }),
    )
    errorSpy.mockRestore()
  })

  it("no-ops when neither facilityId nor vendorId provided", async () => {
    const result = await recordClaudeUsage({
      userId: "u1",
      userName: "Test",
      action: "ai_chat_question",
      description: "x",
    })

    expect(pr.aICredit.findFirst).not.toHaveBeenCalled()
    expect(result.recorded).toBe(false)
    expect(result.creditsUsed).toBe(3)
  })
})
