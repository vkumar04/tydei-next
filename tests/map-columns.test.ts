import { describe, it, expect, vi, beforeEach } from "vitest"
import { mapColumns } from "@/lib/map-columns"

// ─── Helpers ────────────────────────────────────────────────────────

// Mock fetch globally so the AI path always fails and we exercise the
// local‐fallback logic exclusively.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network disabled in tests")))
})

/** Shortcut — builds the TargetField[] array that mapColumns expects. */
function fields(defs: { key: string; label: string; required?: boolean }[]) {
  return defs.map((d) => ({
    key: d.key,
    label: d.label,
    required: d.required ?? false,
  }))
}

// ─── COG target fields (mirrors what the real upload flow sends) ─────
const COG_FIELDS = fields([
  { key: "vendorName", label: "Vendor Name", required: true },
  { key: "inventoryNumber", label: "Product Ref Number", required: true },
  { key: "inventoryDescription", label: "Product Name", required: true },
  { key: "transactionDate", label: "Date Ordered", required: true },
  { key: "quantity", label: "Quantity Ordered", required: true },
  { key: "unitCost", label: "Unit Cost", required: true },
  { key: "extendedPrice", label: "Extended Cost", required: true },
])

// ─── Pricing target fields ──────────────────────────────────────────
const PRICING_FIELDS = fields([
  { key: "vendorItemNo", label: "Vendor Item No" },
  { key: "productDescription", label: "Product Description" },
  { key: "contractPrice", label: "Contract Price" },
  { key: "listPrice", label: "List Price" },
  { key: "effectiveDate", label: "Effective Date" },
  { key: "expirationDate", label: "Expiration Date" },
])

// ─── Tests ──────────────────────────────────────────────────────────

describe("mapColumns – local fallback", () => {
  it("maps standard COG headers", async () => {
    const headers = [
      "Vendor",
      "Product ref number",
      "product name",
      "Date Ordered",
      "Quantity Ordered",
      "Unit Cost",
      "Extended Cost",
    ]

    const result = await mapColumns(headers, COG_FIELDS, [])

    expect(result.vendorName).toBe("Vendor")
    expect(result.inventoryNumber).toBe("Product ref number")
    expect(result.inventoryDescription).toBe("product name")
    expect(result.transactionDate).toBe("Date Ordered")
    expect(result.quantity).toBe("Quantity Ordered")
    expect(result.unitCost).toBe("Unit Cost")
    expect(result.extendedPrice).toBe("Extended Cost")
    expect(Object.keys(result)).toHaveLength(7)
  })

  it("maps underscore-style headers", async () => {
    const headers = [
      "vendor_item_no",
      "description",
      "unit_cost",
      "transaction_date",
    ]

    const target = fields([
      { key: "vendorItemNo", label: "Vendor Item No" },
      { key: "productDescription", label: "Product Description" },
      { key: "unitCost", label: "Unit Cost" },
      { key: "transactionDate", label: "Transaction Date" },
    ])

    const result = await mapColumns(headers, target, [])

    expect(result.vendorItemNo).toBe("vendor_item_no")
    expect(result.productDescription).toBe("description")
    expect(result.unitCost).toBe("unit_cost")
    expect(result.transactionDate).toBe("transaction_date")
  })

  it("maps spaced headers", async () => {
    const headers = ["Vendor Item No", "Product Description", "Unit Cost"]

    const target = fields([
      { key: "vendorItemNo", label: "Vendor Item No" },
      { key: "productDescription", label: "Product Description" },
      { key: "unitCost", label: "Unit Cost" },
    ])

    const result = await mapColumns(headers, target, [])

    expect(result.vendorItemNo).toBe("Vendor Item No")
    expect(result.productDescription).toBe("Product Description")
    expect(result.unitCost).toBe("Unit Cost")
  })

  it("maps pricing-specific headers", async () => {
    const headers = [
      "Contract Price",
      "List Price",
      "Effective Date",
      "Expiration Date",
    ]

    const result = await mapColumns(headers, PRICING_FIELDS, [])

    expect(result.contractPrice).toBe("Contract Price")
    expect(result.listPrice).toBe("List Price")
    expect(result.effectiveDate).toBe("Effective Date")
    expect(result.expirationDate).toBe("Expiration Date")
  })

  it("handles mixed-case headers", async () => {
    const headers = ["VENDOR", "sku", "Price"]

    const target = fields([
      { key: "vendorName", label: "Vendor Name" },
      { key: "vendorItemNo", label: "Vendor Item No" },
      { key: "contractPrice", label: "Contract Price" },
    ])

    const result = await mapColumns(headers, target, [])

    expect(result.vendorName).toBe("VENDOR")
    expect(result.vendorItemNo).toBe("sku")
    expect(result.contractPrice).toBe("Price")
  })

  it("returns empty mapping when no headers match", async () => {
    const headers = ["foo", "bar", "baz"]
    const result = await mapColumns(headers, COG_FIELDS, [])

    expect(result).toEqual({})
  })

  it("returns empty mapping for empty headers array", async () => {
    const result = await mapColumns([], COG_FIELDS, [])

    expect(result).toEqual({})
  })
})
