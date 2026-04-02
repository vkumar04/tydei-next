import { describe, it, expect } from "vitest"
import { serialize } from "@/lib/serialize"

// ─── Minimal Decimal stand-in ───────────────────────────────────────
// Prisma's Decimal class is a wrapper around decimal.js. We import the
// real class so `instanceof Decimal` works inside serialize().
import { Decimal } from "@prisma/client/runtime/client"

// ─── Tests ──────────────────────────────────────────────────────────

describe("serialize", () => {
  // ── Null / undefined ────────────────────────────────────────────
  it("returns null for null input", () => {
    expect(serialize(null)).toBeNull()
  })

  it("returns undefined for undefined input", () => {
    expect(serialize(undefined)).toBeUndefined()
  })

  // ── Primitives ──────────────────────────────────────────────────
  it("preserves plain numbers", () => {
    expect(serialize(42)).toBe(42)
    expect(serialize(0)).toBe(0)
    expect(serialize(-3.14)).toBe(-3.14)
  })

  it("preserves strings", () => {
    expect(serialize("hello")).toBe("hello")
    expect(serialize("")).toBe("")
  })

  it("preserves booleans", () => {
    expect(serialize(true)).toBe(true)
    expect(serialize(false)).toBe(false)
  })

  // ── BigInt ──────────────────────────────────────────────────────
  it("converts BigInt to number", () => {
    const result = serialize(BigInt(123))
    expect(result).toBe(123)
    expect(typeof result).toBe("number")
  })

  // ── Date ────────────────────────────────────────────────────────
  it("converts Date to ISO string", () => {
    const date = new Date("2025-06-15T12:00:00.000Z")
    const result = serialize(date)
    expect(result).toBe("2025-06-15T12:00:00.000Z")
    expect(typeof result).toBe("string")
  })

  // ── Prisma Decimal ──────────────────────────────────────────────
  it("converts Prisma Decimal to number", () => {
    const dec = new Decimal("19.99")
    const result = serialize(dec)
    expect(result).toBe(19.99)
    expect(typeof result).toBe("number")
  })

  // ── Nested objects ──────────────────────────────────────────────
  it("handles nested objects with special types", () => {
    const input = {
      id: BigInt(1),
      name: "Widget",
      price: new Decimal("9.95"),
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
    }

    const result = serialize(input)

    expect(result).toEqual({
      id: 1,
      name: "Widget",
      price: 9.95,
      createdAt: "2025-01-01T00:00:00.000Z",
    })
  })

  // ── Arrays ──────────────────────────────────────────────────────
  it("handles arrays of objects", () => {
    const input = [
      { amount: new Decimal("100.50"), qty: BigInt(5) },
      { amount: new Decimal("200.75"), qty: BigInt(10) },
    ]

    const result = serialize(input)

    expect(result).toEqual([
      { amount: 100.5, qty: 5 },
      { amount: 200.75, qty: 10 },
    ])
  })

  it("handles arrays of primitives", () => {
    const input = [1, "two", true, null]
    expect(serialize(input)).toEqual([1, "two", true, null])
  })

  // ── Mixed nested ────────────────────────────────────────────────
  it("handles deeply nested mixed structures", () => {
    const input = {
      vendor: {
        id: BigInt(42),
        name: "Acme",
        contracts: [
          {
            price: new Decimal("55.00"),
            startDate: new Date("2025-03-01T00:00:00.000Z"),
            items: [
              { sku: "A1", cost: new Decimal("10.25") },
              { sku: "B2", cost: new Decimal("20.50") },
            ],
          },
        ],
      },
      total: BigInt(999),
    }

    const result = serialize(input)

    expect(result).toEqual({
      vendor: {
        id: 42,
        name: "Acme",
        contracts: [
          {
            price: 55,
            startDate: "2025-03-01T00:00:00.000Z",
            items: [
              { sku: "A1", cost: 10.25 },
              { sku: "B2", cost: 20.5 },
            ],
          },
        ],
      },
      total: 999,
    })
  })

  // ── Edge: plain object with no special types ────────────────────
  it("passes through plain objects unchanged", () => {
    const input = { a: 1, b: "two", c: true, d: null }
    expect(serialize(input)).toEqual({ a: 1, b: "two", c: true, d: null })
  })
})
