import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * 2026-06-09 settings audit — ai-credits guards.
 *
 * - Tenant scoping (the original BLOCKER): creditId-based actions must
 *   reject credits owned by a different facility/vendor.
 * - Negative-amount guard: `useAICredits` with a negative creditsUsed
 *   previously passed the availability check and DECREMENTED usedCredits
 *   (self-served refunds).
 */

const {
  memberFindFirstMock,
  creditFindUniqueOrThrowMock,
  creditUpdateMock,
  usageCreateMock,
  transactionMock,
  authGetSessionMock,
} = vi.hoisted(() => ({
  memberFindFirstMock: vi.fn(),
  creditFindUniqueOrThrowMock: vi.fn(),
  creditUpdateMock: vi.fn(),
  usageCreateMock: vi.fn(),
  transactionMock: vi.fn(),
  authGetSessionMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    member: { findFirst: memberFindFirstMock },
    aICredit: {
      findUniqueOrThrow: creditFindUniqueOrThrowMock,
      update: creditUpdateMock,
    },
    aIUsageRecord: { create: usageCreateMock },
    $transaction: transactionMock,
  },
}))

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: authGetSessionMock } },
}))
vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import { useAICredits } from "@/lib/actions/ai-credits"

beforeEach(() => {
  vi.clearAllMocks()
  authGetSessionMock.mockResolvedValue({
    user: { id: "u-1", name: "User One", email: "u1@example.com" },
  })
  memberFindFirstMock.mockResolvedValue({
    organization: { facility: { id: "fac-1" }, vendor: null },
  })
})

describe("useAICredits", () => {
  it("rejects a credit row owned by a different tenant", async () => {
    creditFindUniqueOrThrowMock.mockResolvedValue({
      id: "cr-foreign",
      facilityId: "fac-OTHER",
      vendorId: null,
      monthlyCredits: 100,
      rolloverCredits: 0,
      usedCredits: 0,
    })

    await expect(
      useAICredits({
        creditId: "cr-foreign",
        action: "ai_chat_question",
        creditsUsed: 5,
        description: "x",
      }),
    ).rejects.toThrow(/not found for this organization/)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("rejects a NEGATIVE creditsUsed (self-served refund vector)", async () => {
    await expect(
      useAICredits({
        creditId: "cr-1",
        action: "ai_chat_question",
        creditsUsed: -500,
        description: "refund me",
      }),
    ).rejects.toThrow(/positive integer/)
    expect(transactionMock).not.toHaveBeenCalled()
    expect(creditUpdateMock).not.toHaveBeenCalled()
  })

  it("rejects zero and non-integer amounts", async () => {
    for (const bad of [0, 1.5, NaN]) {
      await expect(
        useAICredits({
          creditId: "cr-1",
          action: "ai_chat_question",
          creditsUsed: bad,
          description: "x",
        }),
      ).rejects.toThrow(/positive integer/)
    }
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("burns owned credits and attributes usage to the SESSION user", async () => {
    creditFindUniqueOrThrowMock.mockResolvedValue({
      id: "cr-1",
      facilityId: "fac-1",
      vendorId: null,
      monthlyCredits: 100,
      rolloverCredits: 0,
      usedCredits: 10,
    })
    transactionMock.mockResolvedValue([])

    const result = await useAICredits({
      creditId: "cr-1",
      action: "ai_chat_question",
      creditsUsed: 5,
      userId: "u-SPOOFED",
      userName: "Spoofy",
      description: "chat",
    })

    expect(result).toEqual({ success: true, remaining: 85 })
    expect(transactionMock).toHaveBeenCalledOnce()
    expect(usageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "u-1",
          userName: "User One",
        }),
      }),
    )
  })

  it("returns success:false (no write) when credits are insufficient", async () => {
    creditFindUniqueOrThrowMock.mockResolvedValue({
      id: "cr-1",
      facilityId: "fac-1",
      vendorId: null,
      monthlyCredits: 10,
      rolloverCredits: 0,
      usedCredits: 8,
    })

    const result = await useAICredits({
      creditId: "cr-1",
      action: "ai_chat_question",
      creditsUsed: 5,
      description: "chat",
    })

    expect(result).toEqual({ success: false, remaining: 2 })
    expect(transactionMock).not.toHaveBeenCalled()
  })
})
