import { describe, it, expect } from "vitest"
import { normalizeSku } from "@/lib/contracts/normalize-sku"

describe("normalizeSku", () => {
  it("folds case and ALL whitespace (trailing/leading/internal)", () => {
    expect(normalizeSku("ABC-123")).toBe("abc-123")
    expect(normalizeSku("  ABC-123  ")).toBe("abc-123")
    expect(normalizeSku("ABC 123")).toBe("abc123")
    expect(normalizeSku("abc\t123")).toBe("abc123")
  })

  it("PRESERVES meaningful separators (hyphen/dot/underscore/slash) — they distinguish SKUs", () => {
    // Conservative: these must NOT all collapse to one key (false-match risk).
    expect(normalizeSku("ABC-123")).not.toBe(normalizeSku("ABC123"))
    expect(normalizeSku("abc.123")).toBe("abc.123")
    expect(normalizeSku("abc_123")).toBe("abc_123")
    expect(normalizeSku("abc/123")).toBe("abc/123")
    // "AB-12" vs "AB1-2" stay distinct (would collapse under separator folding).
    expect(normalizeSku("AB-12")).not.toBe(normalizeSku("AB1-2"))
  })

  it("lowercases a plain alphanumeric SKU", () => {
    expect(normalizeSku("AB12")).toBe("ab12")
  })

  it("returns empty string for null / undefined / blank", () => {
    expect(normalizeSku(null)).toBe("")
    expect(normalizeSku(undefined)).toBe("")
    expect(normalizeSku("")).toBe("")
    expect(normalizeSku("   ")).toBe("")
  })

  it("preserves leading zeros (no zero-stripping)", () => {
    expect(normalizeSku("00123")).toBe("00123")
  })

  it("keeps genuinely different SKUs different", () => {
    expect(normalizeSku("ABC-1")).not.toBe(normalizeSku("ABC-2"))
  })
})
