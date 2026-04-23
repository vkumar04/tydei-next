/**
 * Tests for `localFallbackMap` in lib/actions/imports/shared.ts
 * (Charles W2.C-C). The mass-upload path uses this fallback when the
 * AI mapper is unavailable.
 *
 * Bug: the original match test was `n.includes(k) || n.includes(l)`
 * — asymmetric. When the header is SHORT ("Vendor", "Date Ordered")
 * and the target label is LONG ("Vendor / Supplier Name", "Catalog /
 * Product Reference / Vendor Item Number"), the normalised header
 * doesn't include the normalised label (the long string doesn't fit
 * into the short one). The reverse check — label.includes(header) —
 * was missing, so common real-world CSVs dropped through to no match.
 */
import { describe, it, expect } from "vitest"
import { localFallbackMap } from "@/lib/actions/imports/shared"

describe("localFallbackMap — symmetric includes (W2.C-C)", () => {
  it("maps a short header 'Vendor' to a target with long label 'Vendor / Supplier Name'", () => {
    const headers = ["Vendor", "Date Ordered"]
    const targets = [
      { key: "vendorName", label: "Vendor / Supplier Name", required: true },
    ]
    const mapping = localFallbackMap(headers, targets)
    expect(mapping.vendorName).toBe("Vendor")
  })

  it("maps a short header 'Date Ordered' against the real cog-csv-import label 'Date Ordered / Transaction Date'", () => {
    const headers = ["Vendor", "Date Ordered"]
    // This is the *exact* target-field label used by
    // lib/actions/imports/cog-csv-import.ts — grepping the codebase
    // for real production labels is the only reproducer that matters.
    const targets = [
      {
        key: "transactionDate",
        label: "Date Ordered / Transaction Date",
        required: true,
      },
    ]
    const mapping = localFallbackMap(headers, targets)
    expect(mapping.transactionDate).toBe("Date Ordered")
  })

  it("maps 'Vendor Item Number' to a target whose label is the superset 'Catalog / Product Reference / Vendor Item Number'", () => {
    const headers = ["Vendor Item Number", "Inventory Description"]
    const targets = [
      {
        key: "refNumber",
        label: "Catalog / Product Reference / Vendor Item Number",
        required: true,
      },
    ]
    const mapping = localFallbackMap(headers, targets)
    expect(mapping.refNumber).toBe("Vendor Item Number")
  })

  it("still matches when header is longer than label (pre-existing direction)", () => {
    const headers = ["Transaction Date (posted)"]
    const targets = [
      { key: "transactionDate", label: "Transaction Date", required: true },
    ]
    const mapping = localFallbackMap(headers, targets)
    expect(mapping.transactionDate).toBe("Transaction Date (posted)")
  })
})
