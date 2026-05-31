import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { z } from "zod"
import { toSafeResult, humanizeActionError } from "@/lib/actions/safe-result"

describe("humanizeActionError", () => {
  it("formats a ZodError as path: message", () => {
    const err = z.object({ name: z.string() }).safeParse({})
    expect(err.success).toBe(false)
    if (!err.success) {
      expect(humanizeActionError(err.error)).toMatch(/name:/)
    }
  })

  it("returns the real Error.message (the value Next.js would otherwise redact)", () => {
    expect(humanizeActionError(new Error("carve out overflow"))).toBe(
      "carve out overflow",
    )
  })

  it("falls back to a string for non-Error throws", () => {
    expect(humanizeActionError("boom")).toBe("boom")
    expect(humanizeActionError(undefined)).toBe("Unknown error")
  })
})

describe("toSafeResult", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns { ok: true, data } on success", async () => {
    const res = await toSafeResult("op", {}, async () => ({ imported: 3 }))
    expect(res).toEqual({ ok: true, data: { imported: 3 } })
  })

  it("returns { ok: false, error } instead of throwing — the redaction fix", async () => {
    const res = await toSafeResult("op", { contractId: "c1" }, async () => {
      throw new Error("the real reason")
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe("the real reason")
  })

  it("surfaces a Prisma-style error code when present", async () => {
    const res = await toSafeResult("op", {}, async () => {
      const e = new Error("Unique constraint failed") as Error & { code?: string }
      e.code = "P2002"
      throw e
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.code).toBe("P2002")
  })

  it("logs the failure with its label + context for production debugging", async () => {
    const spy = vi.spyOn(console, "error")
    await toSafeResult("importContractPricing", { contractId: "c9" }, async () => {
      throw new Error("x")
    })
    expect(spy).toHaveBeenCalledWith(
      "[importContractPricing]",
      expect.any(Error),
      { contractId: "c9" },
    )
  })
})
