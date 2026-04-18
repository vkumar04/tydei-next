import { describe, it, expect } from "vitest"
import {
  computeInvoiceVariances,
  type InvoiceLineForVariance,
} from "../invoice-variance"

const CONTRACT_ID = "contract-1"
const OTHER_CONTRACT_ID = "contract-2"

const makeLookup = (
  entries: Array<[string, string, number]>,
): Map<string, number> => {
  const m = new Map<string, number>()
  for (const [contractId, vendorItemNo, price] of entries) {
    m.set(`${contractId}::${vendorItemNo}`, price)
  }
  return m
}

const line = (
  overrides: Partial<InvoiceLineForVariance> = {},
): InvoiceLineForVariance => ({
  id: "li-1",
  contractId: CONTRACT_ID,
  vendorItemNo: "SKU-1",
  invoicePrice: 100,
  invoiceQuantity: 10,
  ...overrides,
})

describe("computeInvoiceVariances", () => {
  it("returns [] for empty line items", () => {
    expect(
      computeInvoiceVariances({ lineItems: [], priceLookup: new Map() }),
    ).toEqual([])
  })

  it("skips a line with exact contract-price match (0% variance)", () => {
    const lineItems = [line({ invoicePrice: 100 })]
    const priceLookup = makeLookup([[CONTRACT_ID, "SKU-1", 100]])

    expect(computeInvoiceVariances({ lineItems, priceLookup })).toEqual([])
  })

  it("flags a 1% overcharge as minor with positive variance", () => {
    // contract 100, invoice 101 → +1%
    const lineItems = [
      line({ id: "li-a", invoicePrice: 101, invoiceQuantity: 10 }),
    ]
    const priceLookup = makeLookup([[CONTRACT_ID, "SKU-1", 100]])

    const rows = computeInvoiceVariances({ lineItems, priceLookup })
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.invoiceLineItemId).toBe("li-a")
    expect(row.contractId).toBe(CONTRACT_ID)
    expect(row.contractPrice).toBe(100)
    expect(row.actualPrice).toBe(101)
    expect(row.variancePercent).toBeCloseTo(1, 10)
    expect(row.variance).toBeCloseTo(10, 10) // (101-100) × 10
    expect(row.severity).toBe("minor")
  })

  it("flags a 5% overcharge as moderate", () => {
    const lineItems = [line({ invoicePrice: 105, invoiceQuantity: 4 })]
    const priceLookup = makeLookup([[CONTRACT_ID, "SKU-1", 100]])

    const rows = computeInvoiceVariances({ lineItems, priceLookup })
    expect(rows).toHaveLength(1)
    expect(rows[0].severity).toBe("moderate")
    expect(rows[0].variancePercent).toBeCloseTo(5, 10)
    expect(rows[0].variance).toBeCloseTo(20, 10) // (105-100) × 4
  })

  it("flags a 15% overcharge as major", () => {
    const lineItems = [line({ invoicePrice: 115, invoiceQuantity: 2 })]
    const priceLookup = makeLookup([[CONTRACT_ID, "SKU-1", 100]])

    const rows = computeInvoiceVariances({ lineItems, priceLookup })
    expect(rows).toHaveLength(1)
    expect(rows[0].severity).toBe("major")
    expect(rows[0].variancePercent).toBeCloseTo(15, 10)
    expect(rows[0].variance).toBeCloseTo(30, 10) // (115-100) × 2
  })

  it("handles an undercharge (negative variance) and uses |percent| for severity", () => {
    // -5% → moderate, variance negative
    const lineItems = [line({ invoicePrice: 95, invoiceQuantity: 8 })]
    const priceLookup = makeLookup([[CONTRACT_ID, "SKU-1", 100]])

    const rows = computeInvoiceVariances({ lineItems, priceLookup })
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.variancePercent).toBeCloseTo(-5, 10)
    expect(row.variance).toBeCloseTo(-40, 10) // (95-100) × 8
    expect(row.severity).toBe("moderate")
  })

  it("handles a -15% undercharge as major", () => {
    const lineItems = [line({ invoicePrice: 85, invoiceQuantity: 1 })]
    const priceLookup = makeLookup([[CONTRACT_ID, "SKU-1", 100]])

    const rows = computeInvoiceVariances({ lineItems, priceLookup })
    expect(rows).toHaveLength(1)
    expect(rows[0].severity).toBe("major")
    expect(rows[0].variancePercent).toBeCloseTo(-15, 10)
    expect(rows[0].variance).toBeCloseTo(-15, 10)
  })

  it("skips lines with no matching contract price entry", () => {
    const lineItems = [
      line({ id: "li-matched", vendorItemNo: "SKU-1", invoicePrice: 110 }),
      line({ id: "li-unmatched", vendorItemNo: "SKU-MISSING", invoicePrice: 200 }),
    ]
    const priceLookup = makeLookup([[CONTRACT_ID, "SKU-1", 100]])

    const rows = computeInvoiceVariances({ lineItems, priceLookup })
    expect(rows).toHaveLength(1)
    expect(rows[0].invoiceLineItemId).toBe("li-matched")
  })

  it("skips lines whose contractId does not match the lookup key", () => {
    // Lookup has entry for contract-2::SKU-1 but line is on contract-1
    const lineItems = [
      line({ contractId: CONTRACT_ID, vendorItemNo: "SKU-1", invoicePrice: 120 }),
    ]
    const priceLookup = makeLookup([[OTHER_CONTRACT_ID, "SKU-1", 100]])

    expect(computeInvoiceVariances({ lineItems, priceLookup })).toEqual([])
  })

  it("returns rows for every line when multiple lines have variance", () => {
    const lineItems: InvoiceLineForVariance[] = [
      line({ id: "li-a", vendorItemNo: "SKU-A", invoicePrice: 101, invoiceQuantity: 5 }), // minor +1%
      line({ id: "li-b", vendorItemNo: "SKU-B", invoicePrice: 55, invoiceQuantity: 2 }), // +10% → major (≥10)
      line({ id: "li-c", vendorItemNo: "SKU-C", invoicePrice: 95, invoiceQuantity: 10 }), // -5% moderate
    ]
    const priceLookup = makeLookup([
      [CONTRACT_ID, "SKU-A", 100],
      [CONTRACT_ID, "SKU-B", 50],
      [CONTRACT_ID, "SKU-C", 100],
    ])

    const rows = computeInvoiceVariances({ lineItems, priceLookup })
    expect(rows).toHaveLength(3)

    const byId = new Map(rows.map((r) => [r.invoiceLineItemId, r]))

    const a = byId.get("li-a")!
    expect(a.severity).toBe("minor")
    expect(a.variancePercent).toBeCloseTo(1, 10)
    expect(a.variance).toBeCloseTo(5, 10)

    const b = byId.get("li-b")!
    expect(b.severity).toBe("major")
    expect(b.variancePercent).toBeCloseTo(10, 10)
    expect(b.variance).toBeCloseTo(10, 10)

    const c = byId.get("li-c")!
    expect(c.severity).toBe("moderate")
    expect(c.variancePercent).toBeCloseTo(-5, 10)
    expect(c.variance).toBeCloseTo(-50, 10)
  })

  it("mixes matched, unmatched, and exact-price lines correctly", () => {
    const lineItems: InvoiceLineForVariance[] = [
      line({ id: "li-match", vendorItemNo: "SKU-A", invoicePrice: 110, invoiceQuantity: 1 }), // +10% major
      line({ id: "li-exact", vendorItemNo: "SKU-B", invoicePrice: 50, invoiceQuantity: 1 }), // exact — skipped
      line({ id: "li-missing", vendorItemNo: "SKU-Z", invoicePrice: 999, invoiceQuantity: 1 }), // unmatched — skipped
    ]
    const priceLookup = makeLookup([
      [CONTRACT_ID, "SKU-A", 100],
      [CONTRACT_ID, "SKU-B", 50],
    ])

    const rows = computeInvoiceVariances({ lineItems, priceLookup })
    expect(rows).toHaveLength(1)
    expect(rows[0].invoiceLineItemId).toBe("li-match")
    expect(rows[0].severity).toBe("major")
  })
})
