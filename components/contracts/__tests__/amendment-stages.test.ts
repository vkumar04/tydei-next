import { describe, it, expect, vi } from "vitest"

// The amendment-extractor module is a client component whose import chain
// touches server actions (which transitively pull in Stripe). Mock those
// boundaries so the pure `nextStage` helper can be imported in isolation.
vi.mock("@/lib/actions/contracts", () => ({
  updateContract: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import {
  nextStage,
  sanitizeInteger,
  sanitizeNumeric,
  type Stage,
} from "@/components/contracts/amendment-extractor"

describe("amendment-extractor stage progression", () => {
  it("advances upload → review → confirm → applying → done", () => {
    let s: Stage = "upload"
    const seen: Stage[] = [s]
    let next = nextStage(s)
    while (next !== null) {
      s = next
      seen.push(s)
      next = nextStage(s)
    }
    expect(seen).toEqual([
      "upload",
      "review",
      "confirm",
      "applying",
      "done",
    ])
  })

  it("returns null at terminal stage", () => {
    expect(nextStage("done")).toBeNull()
  })
})

describe("sanitizeNumeric", () => {
  it("strips $ and commas", () => {
    expect(sanitizeNumeric("$350,000")).toBe(350000)
    expect(sanitizeNumeric("1,234.56")).toBe(1234.56)
  })

  it("strips whitespace and currency suffixes", () => {
    expect(sanitizeNumeric("  $1,000.00 USD ")).toBe(1000)
    expect(sanitizeNumeric("500 USD")).toBe(500)
    expect(sanitizeNumeric("25%")).toBe(25)
  })

  it("parses plain numbers", () => {
    expect(sanitizeNumeric("42")).toBe(42)
    expect(sanitizeNumeric("3.14")).toBe(3.14)
  })

  it("preserves leading minus", () => {
    expect(sanitizeNumeric("-250.5")).toBe(-250.5)
    expect(sanitizeNumeric("-$1,200")).toBe(-1200)
  })

  it("throws on unparseable input", () => {
    expect(() => sanitizeNumeric("three hundred")).toThrow()
    expect(() => sanitizeNumeric("")).toThrow()
    expect(() => sanitizeNumeric("   ")).toThrow()
    expect(() => sanitizeNumeric("$")).toThrow()
    expect(() => sanitizeNumeric("abc")).toThrow()
  })
})

describe("sanitizeInteger", () => {
  it("truncates sanitized numeric values toward zero", () => {
    expect(sanitizeInteger("42")).toBe(42)
    expect(sanitizeInteger("42.9")).toBe(42)
    expect(sanitizeInteger("-3.7")).toBe(-3)
    expect(sanitizeInteger("$1,234.56")).toBe(1234)
  })

  it("throws on unparseable input", () => {
    expect(() => sanitizeInteger("not a number")).toThrow()
  })
})
