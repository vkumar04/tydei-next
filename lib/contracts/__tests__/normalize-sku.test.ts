import { describe, it, expect } from "vitest"
import { normalizeSku } from "@/lib/contracts/normalize-sku"

describe("normalizeSku", () => {
  it("folds case, whitespace, hyphen, dot, underscore to one canonical key", () => {
    const canonical = normalizeSku("ABC-123")
    expect(normalizeSku("abc 123")).toBe(canonical)
    expect(normalizeSku("ABC.123 ")).toBe(canonical)
    expect(normalizeSku("abc_123")).toBe(canonical)
    expect(normalizeSku(" abc/123 ")).toBe(canonical)
    expect(canonical).toBe("abc123")
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
