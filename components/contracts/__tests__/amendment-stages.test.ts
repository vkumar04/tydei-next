import { describe, it, expect, vi } from "vitest"

// The amendment-extractor module is a client component whose import chain
// touches server actions (which transitively pull in Stripe). Mock those
// boundaries so the pure `nextStage` helper can be imported in isolation.
vi.mock("@/lib/actions/contracts/update", () => ({
  updateContract: vi.fn(),
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

import {
  nextStage,
  sanitizeInteger,
  sanitizeNumeric,
  isAutoApplicableField,
  isPayPeriodRelated,
  partitionChanges,
  AUTO_APPLICABLE_FIELDS,
  type Stage,
} from "@/components/contracts/amendment-extractor"
import type { AmendmentChange } from "@/app/api/ai/extract-amendment/route"

function change(over: Partial<AmendmentChange>): AmendmentChange {
  return {
    field: "x",
    label: "X",
    oldValue: "a",
    newValue: "b",
    type: "modified",
    ...over,
  }
}

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

describe("isAutoApplicableField", () => {
  it("accepts allow-listed scalar fields", () => {
    expect(isAutoApplicableField("effectiveDate")).toBe(true)
    expect(isAutoApplicableField("totalValue")).toBe(true)
    expect(isAutoApplicableField("autoRenewal")).toBe(true)
    expect(isAutoApplicableField("contractNumber")).toBe(true)
  })

  it("rejects term/tier/pricing structure fields", () => {
    expect(
      isAutoApplicableField("term:spend_rebate:tier_1_rebatePercent"),
    ).toBe(false)
    expect(isAutoApplicableField("pricing:item_42_unitPrice")).toBe(false)
    expect(isAutoApplicableField("rebatePayPeriod")).toBe(false)
    expect(isAutoApplicableField("spendBaseline")).toBe(false)
  })

  it("matches the switch cases in handleApply", () => {
    // Guard against drift: these are exactly the keys the apply switch writes.
    expect([...AUTO_APPLICABLE_FIELDS].sort()).toEqual(
      [
        "annualValue",
        "autoRenewal",
        "contractNumber",
        "description",
        "effectiveDate",
        "expirationDate",
        "gpoAffiliation",
        "name",
        "notes",
        "terminationNoticeDays",
        "totalValue",
      ].sort(),
    )
  })
})

describe("isPayPeriodRelated", () => {
  it("flags pay-period / payment-timing fields", () => {
    expect(
      isPayPeriodRelated(change({ field: "rebatePayPeriod", label: "Rebate Pay Period" })),
    ).toBe(true)
    expect(
      isPayPeriodRelated(change({ field: "term:x:paymentTiming", label: "Payment Timing" })),
    ).toBe(true)
    expect(
      isPayPeriodRelated(change({ field: "x", label: "Performance Period" })),
    ).toBe(true)
  })

  it("does not flag unrelated fields", () => {
    expect(
      isPayPeriodRelated(change({ field: "totalValue", label: "Total Value" })),
    ).toBe(false)
    expect(
      isPayPeriodRelated(change({ field: "expirationDate", label: "Expiration Date" })),
    ).toBe(false)
  })
})

describe("partitionChanges", () => {
  it("auto-applies allow-listed scalars and surfaces the rest", () => {
    const changes: AmendmentChange[] = [
      change({ field: "totalValue", label: "Total Value" }),
      change({ field: "term:spend:tier_1_rebatePercent", label: "Tier 1 Rebate %" }),
      change({ field: "expirationDate", label: "Expiration Date" }),
      change({ field: "pricing:item_1", label: "Item 1 Price", type: "added" }),
    ]
    const { autoApplied, notAutoApplied } = partitionChanges(changes)
    expect(autoApplied.map((c) => c.field)).toEqual([
      "totalValue",
      "expirationDate",
    ])
    expect(notAutoApplied.map((c) => c.field)).toEqual([
      "term:spend:tier_1_rebatePercent",
      "pricing:item_1",
    ])
  })

  it("never auto-applies removed changes even on allow-listed fields", () => {
    const { autoApplied, notAutoApplied } = partitionChanges([
      change({ field: "totalValue", label: "Total Value", type: "removed" }),
    ])
    expect(autoApplied).toHaveLength(0)
    expect(notAutoApplied.map((c) => c.field)).toEqual(["totalValue"])
  })

  it("collects pay-period flags from any bucket", () => {
    const { payPeriodFlags } = partitionChanges([
      change({ field: "rebatePayPeriod", label: "Rebate Pay Period" }),
      change({ field: "totalValue", label: "Total Value" }),
    ])
    expect(payPeriodFlags.map((c) => c.field)).toEqual(["rebatePayPeriod"])
  })
})
