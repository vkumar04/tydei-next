/**
 * Regression tests for the vendor proposal-builder file uploads
 * (bugs 2026-06-13, screenshots: "Pricing file must have a product name
 * or reference number column" / "Usage file must have a product name
 * column" on the REAL price/usage files).
 *
 * Root cause: file-handlers.ts hand-rolled both the file parsing
 * (FileReader.readAsText — XLSX impossible, no BOM strip, no CRLF
 * normalization) and a third copy of the header-alias lists, which
 * missed "ReferenceNumber"-class SKU headers. Column resolution must go
 * through the canonical lists in lib/utils/parse-pricing-file.ts
 * (invariants table: "Pricing-file header detection") and file reading
 * through the shared readPricingRows.
 */

import { describe, expect, it } from "vitest"
import {
  mapPricingRows,
  mapUsageRows,
  MAX_USAGE_ROWS,
  handlePricingRowsImport,
  handleUsageRowsImport,
} from "../file-handlers"
import type { NewProposalState } from "../types"
import { readPricingRows } from "@/components/facility/analysis/prospective/pricing-file-reader"

function rowsFor(
  headers: string[],
  data: string[][],
): Record<string, string>[] {
  return data.map((vals) => {
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? ""
    })
    return row
  })
}

describe("mapPricingRows — canonical header detection", () => {
  it("parses the exact real-world header row (ReferenceNumber + ' Price')", () => {
    // The header row /api/parse-file returns for the Arthrex price file
    // — the one the 2026-06-13 screenshots show being rejected.
    const headers = ["ReferenceNumber", "Description", "Product Catgory", "UOM", " Price"]
    const result = mapPricingRows(
      headers,
      rowsFor(headers, [
        ["6-820-00", "NTI Gas Warmer", "Joints-Ortho", "EA", "3360.00"],
        ["AR-9835", "Apollo RF H50", "Joints-Ortho", "EA", "$260.00"],
      ]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products).toHaveLength(2)
    expect(result.products[0]).toMatchObject({
      productName: "NTI Gas Warmer",
      refNumber: "6-820-00",
      proposedPrice: 3360,
      fromPricingFile: true,
    })
    // "$260.00" → 260 ($/comma stripping preserved)
    expect(result.products[1].proposedPrice).toBe(260)
    // "Product Catgory" (real-world typo header) resolves via the
    // canonical CATEGORY_ALIASES and is counted + detected.
    expect(result.distinctCategories).toEqual(["Joints-Ortho"])
    expect(result.detectedCategory).toBe("Joints-Ortho")
  })

  it("falls back to the ref number as the product name when no description column exists", () => {
    const headers = ["SKU", "Price", "Quantity"]
    const result = mapPricingRows(
      headers,
      rowsFor(headers, [["AR-1", "100", "5"]]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products[0]).toMatchObject({
      productName: "AR-1",
      refNumber: "AR-1",
      proposedPrice: 100,
      projectedVolume: 5,
    })
    expect(result.totalSpend).toBe(500)
    expect(result.totalVolume).toBe(5)
  })

  it("resolves builder-specific secondary aliases (Product Name, Proposed Price, Cost Basis)", () => {
    const headers = ["Product Name", "Proposed Price", "Cost Basis", "Qty"]
    const result = mapPricingRows(
      headers,
      rowsFor(headers, [["Hip Stem", "1,200.50", "$800", "10"]]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products[0]).toMatchObject({
      productName: "Hip Stem",
      proposedPrice: 1200.5,
      costBasis: 800,
      projectedVolume: 10,
    })
  })

  it("returns ok:false when neither a name nor a ref column exists (toast path)", () => {
    const headers = ["Col A", "Col B"]
    const result = mapPricingRows(headers, rowsFor(headers, [["x", "y"]]))
    expect(result).toEqual({ ok: false, reason: "missing-name-and-ref" })
  })

  it("maps a Current Price column into ProposalProduct.currentPrice (Deal Scorer prefill)", () => {
    const headers = ["Product Name", "Current Price", "Proposed Price", "Qty"]
    const result = mapPricingRows(
      headers,
      rowsFor(headers, [["Hip Stem", "$1,500.00", "1,200", "10"]]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products[0]).toMatchObject({
      productName: "Hip Stem",
      currentPrice: 1500,
      proposedPrice: 1200,
      projectedVolume: 10,
    })
    // Spend is priced off the PROPOSED price, never the current one.
    expect(result.totalSpend).toBe(12_000)
  })

  it("does not let the contains-'price' fallback claim a Current Price column as the proposed price", () => {
    // No proposed-price column at all — the legacy contains-"price"
    // fallback must skip the column already resolved as current price.
    const headers = ["Product Name", "Current Price", "Qty"]
    const result = mapPricingRows(
      headers,
      rowsFor(headers, [["Hip Stem", "1500", "10"]]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products[0]).toMatchObject({
      currentPrice: 1500,
      proposedPrice: 0,
    })
  })

  it("mappingOverride routes currentPrice like every other field", () => {
    const headers = ["Product Name", "Facility $", "Quote $", "Qty"]
    const result = mapPricingRows(
      headers,
      rowsFor(headers, [["Widget", "50", "40", "2"]]),
      {
        name: "Product Name",
        ref: null,
        currentPrice: "Facility $",
        price: "Quote $",
        qty: "Qty",
        costBasis: null,
        category: null,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products[0]).toMatchObject({
      currentPrice: 50,
      proposedPrice: 40,
      projectedVolume: 2,
    })
  })
})

describe("mapUsageRows — usage-file columns", () => {
  it("parses a usage-style header row with vendor/date/qty/unit cost", () => {
    const headers = ["Vendor", "Date Ordered", "Product Description", "ReferenceNumber", "Quantity", "Unit Cost"]
    const result = mapUsageRows(
      headers,
      rowsFor(headers, [
        ["Arthrex", "3/15/2025", "Apollo RF H50", "AR-9835", "2", "$260.00"],
        ["Arthrex", "3/22/2025", "Apollo RF H50", "AR-9835", "3", "260.00"],
        ["Arthrex", "2025-04-02", "Apollo RF H50", "AR-9835", "1", "260.00"],
      ]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // One product aggregated by ref, two months of usage.
    expect(result.products).toHaveLength(1)
    const p = result.products[0]
    expect(p).toMatchObject({
      productName: "Apollo RF H50",
      refNumber: "AR-9835",
      projectedVolume: 6,
      historicalAvgVolume: 6,
    })
    expect(p.monthlyUsage?.map((m) => m.month)).toEqual(["2025-03", "2025-04"])
    // No extended-cost column → revenue = unitCost * qty per tx.
    expect(p.monthlyUsage?.[0]).toMatchObject({ volume: 5, revenue: 1300 })
    expect(result.totalVolume).toBe(6)
    expect(result.totalRevenue).toBe(1560)
    expect(result.processedRows).toBe(3)
    expect(result.truncated).toBe(false)
  })

  it("prefers the extended-cost column for revenue when present", () => {
    const headers = ["Product Name", "Qty", "Unit Cost", "Extended Cost"]
    const result = mapUsageRows(
      headers,
      rowsFor(headers, [["Widget", "4", "10", "45.00"]]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.totalRevenue).toBe(45)
  })

  it("returns ok:false when no product name column exists (toast path)", () => {
    // Ref-only usage files fail the gate, as before the rewrite.
    const headers = ["ReferenceNumber", "Quantity", "Unit Cost"]
    const result = mapUsageRows(headers, rowsFor(headers, [["AR-1", "1", "10"]]))
    expect(result).toEqual({ ok: false, reason: "missing-name" })
  })

  it("caps parsed rows at MAX_USAGE_ROWS and flags truncation", () => {
    const headers = ["Product Name", "Qty", "Unit Cost"]
    const rows = rowsFor(
      headers,
      Array.from({ length: MAX_USAGE_ROWS + 5 }, (_, i) => [`P${i % 10}`, "1", "1"]),
    )
    const result = mapUsageRows(headers, rows)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.truncated).toBe(true)
    expect(result.processedRows).toBe(MAX_USAGE_ROWS)
  })
})

describe("readPricingRows — CSV front-end the handlers now share", () => {
  it("strips the BOM and normalizes CRLF so the last column has no trailing \\r", async () => {
    const csv = "\uFEFFReferenceNumber,Description,Price\r\nAR-1,Widget,100\r\nAR-2,Gadget,200\r\n"
    const file = new File([csv], "usage.csv", { type: "text/csv" })
    const { headers, rows } = await readPricingRows(file)
    expect(headers).toEqual(["ReferenceNumber", "Description", "Price"])
    expect(rows[1]).toMatchObject({ Price: "200" })

    const mapped = mapPricingRows(headers, rows)
    expect(mapped.ok).toBe(true)
    if (!mapped.ok) return
    expect(mapped.products.map((p) => p.proposedPrice)).toEqual([100, 200])
  })

  it("parses .txt uploads as CSV (builder inputs accept .txt)", async () => {
    const file = new File(["Product Name,Price\nWidget,5\n"], "export.txt", { type: "text/plain" })
    const { headers, rows } = await readPricingRows(file)
    expect(headers).toEqual(["Product Name", "Price"])
    expect(rows).toHaveLength(1)
  })
})

describe("mapPricingRows / mapUsageRows — mappingOverride (uploader improvements 1, 2026-06-13)", () => {
  it("mapPricingRows: override wins over auto-detect", () => {
    // "Description" / "SKU" / "Price" would all auto-detect; the user's
    // mapping deliberately routes name to the oddball "Line Label"
    // column and price to "Quote $".
    const headers = ["Description", "SKU", "Price", "Line Label", "Quote $", "Ct"]
    const result = mapPricingRows(
      headers,
      rowsFor(headers, [["Auto Name", "WRONG-1", "1.00", "Manual Name", "$25.00", "4"]]),
      {
        name: "Line Label",
        ref: null,
        price: "Quote $",
        qty: "Ct",
        costBasis: null,
        category: null,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products[0]).toMatchObject({
      productName: "Manual Name",
      refNumber: undefined,
      proposedPrice: 25,
      projectedVolume: 4,
    })
    expect(result.totalSpend).toBe(100)
  })

  it("mapPricingRows: override with neither name nor ref fails like auto-detect", () => {
    const headers = ["Description", "Price"]
    const result = mapPricingRows(
      headers,
      rowsFor(headers, [["Widget", "9"]]),
      { name: null, ref: null, price: "Price", qty: null, costBasis: null, category: null },
    )
    expect(result).toEqual({ ok: false, reason: "missing-name-and-ref" })
  })

  it("mapUsageRows: override wins over auto-detect (the Inventory Number case)", () => {
    // Charles's invoice export: "Inventory Number" matches no canonical
    // alias, so auto-detect leaves ref unmapped — the mapping dialog
    // lets the user claim it manually.
    const headers = [
      "Inventory Description", "Inventory Number", "Invoice Date",
      "Invoice Quantity", "Invoice Price", "Item Extended Cost",
    ]
    const result = mapUsageRows(
      headers,
      rowsFor(headers, [
        ["NTI Gas Warmer", "INV-77", "03/15/2026", "2", "100.00", "200.00"],
      ]),
      {
        name: "Inventory Description",
        ref: "Inventory Number",
        vendor: null,
        date: "Invoice Date",
        qty: "Invoice Quantity",
        unitCost: "Invoice Price",
        extendedCost: "Item Extended Cost",
        category: null,
      },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products).toHaveLength(1)
    expect(result.products[0]).toMatchObject({
      productName: "NTI Gas Warmer",
      refNumber: "INV-77",
      projectedVolume: 2,
    })
    expect(result.totalRevenue).toBe(200)
    expect(result.products[0].monthlyUsage?.[0]).toMatchObject({
      month: "2026-03",
      volume: 2,
      revenue: 200,
    })
  })

  it("mapUsageRows: override with name null fails like auto-detect", () => {
    const headers = ["Inventory Description", "Qty"]
    const result = mapUsageRows(
      headers,
      rowsFor(headers, [["Widget", "1"]]),
      { name: null, ref: null, vendor: null, date: null, qty: "Qty", unitCost: null, extendedCost: null, category: null },
    )
    expect(result).toEqual({ ok: false, reason: "missing-name" })
  })
})

describe("invoice-line exports aggregate per SKU (Charles 2026-06-30, SYK Usage ONLY.xlsx)", () => {
  // The real facility export is a raw invoice-line dump: one row per
  // invoice LINE, the same SKU repeating across dates, 43 columns
  // (InvoicePrice / InvoiceQuantity / UnitCost / VoucheredTotal / …).
  // Before the fix, mapPricingRows emitted one product PER ROW and the
  // usage merge then stamped every duplicate row with the SKU's TOTAL
  // 12-month volume — measured $111M totalProposedCost from a $3.9M
  // book on the real file. Item count must equal DISTINCT SKUs, volume
  // Σ qty, spend Σ extended.
  const headers = [
    "InvoiceNo", "InvoiceDate", "VendorName", "InventoryDescription",
    "VendorItemNo", "InvoicePrice", "InvoiceQuantity", "UnitCost",
    "VoucheredQty", "VoucheredPrice", "VoucheredTotal",
  ]
  // 4 lines, 2 distinct SKUs. Row 3 carries SKU whitespace drift
  // ("5536 -B-500") that only normalizeSku folds.
  const data = [
    ["1001", "1/15/2025", "Stryker", "TRIATHLON BASEPLATE", "5536-B-500", "1400.00", "2", "1400.00", "2", "1400.00", "2800.00"],
    ["1002", "2/03/2025", "Stryker", "TRIATHLON BASEPLATE", "5536-B-500", "1400.00", "3", "1400.00", "3", "1400.00", "4200.00"],
    ["1003", "2/10/2025", "Stryker", "Triathlon Baseplate", "5536 -B-500", "1400.00", "1", "1400.00", "1", "1400.00", "1400.00"],
    ["1004", "3/01/2025", "Stryker", "ACCOLADE II", "6721-0435", "2000.00", "2", "2000.00", "2", "2000.00", "4000.00"],
  ]

  it("mapUsageRows: item count = distinct SKUs, volume = Σ qty, spend = Σ extended", () => {
    // Auto-detect path — the exact resolution the real file gets:
    // name→InventoryDescription (contains "description"), ref→VendorItemNo
    // (canonical exact), qty→InvoiceQuantity, unitCost→UnitCost.
    const result = mapUsageRows(headers, rowsFor(headers, data))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products).toHaveLength(2) // distinct SKUs, NOT 4 rows
    expect(result.totalVolume).toBe(8) // Σ InvoiceQuantity
    expect(result.totalRevenue).toBe(12_400) // Σ VoucheredTotal (= Σ unitCost×qty)
    expect(result.processedRows).toBe(4)

    const baseplate = result.products.find((p) => p.refNumber === "5536-B-500")
    expect(baseplate).toBeDefined()
    // All three baseplate lines (incl. the whitespace-drift SKU) fold
    // into ONE product via normalizeSku.
    expect(baseplate).toMatchObject({
      projectedVolume: 6,
      historicalAvgVolume: 6,
      historicalAvgPrice: 1400, // Σ extended ÷ Σ qty (8400 / 6)
    })
    expect(baseplate?.monthlyUsage?.map((m) => m.month)).toEqual([
      "2025-01",
      "2025-02",
    ])
  })

  it("mapPricingRows: aggregates duplicate SKU rows into one product (dialog-mapped qty)", () => {
    const result = mapPricingRows(headers, rowsFor(headers, data), {
      name: "InventoryDescription",
      ref: "VendorItemNo",
      currentPrice: null,
      price: "InvoicePrice",
      qty: "InvoiceQuantity",
      costBasis: null,
      category: null,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products).toHaveLength(2) // distinct SKUs, NOT 4 rows
    const baseplate = result.products.find((p) => p.refNumber === "5536-B-500")
    expect(baseplate).toMatchObject({
      proposedPrice: 1400, // spend-weighted: Σ price×qty ÷ Σ qty
      projectedVolume: 6, // Σ qty across the SKU's rows
    })
    expect(result.totalSpend).toBe(12_400) // Σ extended, file total
    expect(result.totalVolume).toBe(8)
  })

  it("mapPricingRows: still dedupes when no qty column maps (auto-detect on the real headers)", () => {
    // The real dropzone auto-resolution for this file leaves qty null
    // (no exact QTY alias) — item count must STILL be distinct SKUs,
    // with the unit price a simple average of the SKU's listed prices.
    const result = mapPricingRows(headers, rowsFor(headers, data))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products).toHaveLength(2)
    const baseplate = result.products.find((p) => p.refNumber === "5536-B-500")
    expect(baseplate?.proposedPrice).toBe(1400)
    expect(baseplate?.projectedVolume).toBe(0)
  })

  it("weights the unit price by quantity when duplicate rows priced differently", () => {
    const h = ["Description", "SKU", "Price", "Quantity"]
    const result = mapPricingRows(
      h,
      rowsFor(h, [
        ["Widget", "W-1", "100", "3"], // 300
        ["Widget", "W-1", "80", "1"], // 80
      ]),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products).toHaveLength(1)
    expect(result.products[0].proposedPrice).toBe(95) // 380 / 4
    expect(result.products[0].projectedVolume).toBe(4)
    expect(result.totalSpend).toBe(380)
  })

  it("end-to-end: usage upload then pricing upload of the SAME invoice export keeps the book at Σ extended (the $111M regression)", async () => {
    let state = makeBuilderState()
    const setState: React.Dispatch<React.SetStateAction<NewProposalState>> = (
      action,
    ) => {
      state =
        typeof action === "function"
          ? (action as (p: NewProposalState) => NewProposalState)(state)
          : action
    }
    const usageMapping = {
      name: "InventoryDescription", ref: "VendorItemNo", vendor: "VendorName",
      date: "InvoiceDate", qty: "InvoiceQuantity", unitCost: "UnitCost",
      extendedCost: null, category: null,
    }
    const pricingMapping = {
      name: "InventoryDescription", ref: "VendorItemNo", currentPrice: null,
      price: "InvoicePrice", qty: "InvoiceQuantity", costBasis: null, category: null,
    }
    await handleUsageRowsImport(headers, rowsFor(headers, data), usageMapping, () => {}, setState)
    await handlePricingRowsImport(headers, rowsFor(headers, data), pricingMapping, () => {}, setState)

    // What createProposal would persist: itemCount + Σ price × qty.
    const items = state.products.filter((p) => p.proposedPrice > 0)
    const totalCost = items.reduce(
      (s, p) => s + p.proposedPrice * (p.projectedVolume || 1),
      0,
    )
    expect(items).toHaveLength(2) // distinct SKUs
    expect(totalCost).toBe(12_400) // the true book — NOT duplicate-count × volume
  })
})

function makeBuilderState(overrides: Partial<NewProposalState> = {}): NewProposalState {
  return {
    proposalName: "",
    facilityId: "",
    facilityName: "",
    isMultiFacility: false,
    facilities: [],
    productCategory: "",
    productCategories: [],
    isGrouped: false,
    groupName: "",
    contractLength: 24,
    projectedSpend: 0,
    projectedVolume: 0,
    totalOpportunity: 0,
    terms: [],
    products: [],
    marketShareCommitment: 50,
    gpoFee: 3,
    aiNotes: "",
    ...overrides,
  }
}

describe("projectedSpend is a USER-OWNED assumption — files only SEED it", () => {
  // Vick: the proposals list showed a different number than the value he
  // typed into "Projected Annual Spend". Uploads used to overwrite (pricing)
  // or add to (usage / text-parse) the typed value; the rule is now
  // seed-when-0, never mutate.

  function makeState(overrides: Partial<NewProposalState> = {}): NewProposalState {
    return {
      proposalName: "",
      facilityId: "",
      facilityName: "",
      isMultiFacility: false,
      facilities: [],
      productCategory: "",
      productCategories: [],
      isGrouped: false,
      groupName: "",
      contractLength: 24,
      projectedSpend: 0,
      projectedVolume: 0,
      totalOpportunity: 0,
      terms: [],
      products: [],
      marketShareCommitment: 50,
      gpoFee: 3,
      aiNotes: "",
      ...overrides,
    }
  }

  /** Captures functional setState updates the handlers dispatch. */
  function stateHarness(initial: NewProposalState) {
    let state = initial
    const setState: React.Dispatch<React.SetStateAction<NewProposalState>> = (
      action,
    ) => {
      state =
        typeof action === "function"
          ? (action as (p: NewProposalState) => NewProposalState)(state)
          : action
    }
    return { get state() { return state }, setState }
  }

  const noopProgress = () => {}

  const pricingHeaders = ["Product Name", "Price", "Qty"]
  const pricingMapping = {
    name: "Product Name",
    ref: null,
    currentPrice: null,
    price: "Price",
    qty: "Qty",
    costBasis: null,
    category: null,
  }

  it("typed value survives a pricing upload", async () => {
    const harness = stateHarness(makeState({ projectedSpend: 250_000 }))
    await handlePricingRowsImport(
      pricingHeaders,
      rowsFor(pricingHeaders, [["Widget", "100", "5"]]), // catalog total 500
      pricingMapping,
      noopProgress,
      harness.setState,
    )
    expect(harness.state.products).toHaveLength(1)
    expect(harness.state.projectedSpend).toBe(250_000)
    // Volume is still derived from the file.
    expect(harness.state.projectedVolume).toBe(5)
  })

  it("pricing upload seeds projectedSpend when it is still 0", async () => {
    const harness = stateHarness(makeState())
    await handlePricingRowsImport(
      pricingHeaders,
      rowsFor(pricingHeaders, [["Widget", "100", "5"]]),
      pricingMapping,
      noopProgress,
      harness.setState,
    )
    expect(harness.state.projectedSpend).toBe(500)
  })

  const usageHeaders = ["Product Name", "Qty", "Unit Cost"]
  const usageMapping = {
    name: "Product Name",
    ref: null,
    vendor: null,
    date: null,
    qty: "Qty",
    unitCost: "Unit Cost",
    extendedCost: null,
    category: null,
  }

  it("typed value survives a usage upload (no more additive drift)", async () => {
    const harness = stateHarness(makeState({ projectedSpend: 250_000 }))
    await handleUsageRowsImport(
      usageHeaders,
      rowsFor(usageHeaders, [["Widget", "4", "10"]]), // revenue 40
      usageMapping,
      noopProgress,
      harness.setState,
    )
    expect(harness.state.projectedSpend).toBe(250_000)
  })

  it("usage upload seeds when 0, and a RE-upload no longer double-counts", async () => {
    const harness = stateHarness(makeState())
    const rows = rowsFor(usageHeaders, [["Widget", "4", "10"]])
    await handleUsageRowsImport(usageHeaders, rows, usageMapping, noopProgress, harness.setState)
    expect(harness.state.projectedSpend).toBe(40)
    // Re-upload the same file: used to become 80 (prev + totalRevenue).
    await handleUsageRowsImport(usageHeaders, rows, usageMapping, noopProgress, harness.setState)
    expect(harness.state.projectedSpend).toBe(40)
  })
})

describe("usage↔pricing merge matches SKUs EXACTLY (no substring cross-match)", () => {
  // Follow-up to the Charles round-3 aggregation fix: the old mutual
  // includes() match folded one SKU's volume onto a near-identical ref
  // (…500 vs …5000) or a name that merely contained another.

  function makeState(overrides: Partial<NewProposalState> = {}): NewProposalState {
    return {
      proposalName: "",
      facilityId: "",
      facilityName: "",
      isMultiFacility: false,
      facilities: [],
      productCategory: "",
      productCategories: [],
      isGrouped: false,
      groupName: "",
      contractLength: 24,
      projectedSpend: 0,
      projectedVolume: 0,
      totalOpportunity: 0,
      terms: [],
      products: [],
      marketShareCommitment: 50,
      gpoFee: 3,
      aiNotes: "",
      ...overrides,
    }
  }

  function stateHarness(initial: NewProposalState) {
    let state = initial
    const setState: React.Dispatch<React.SetStateAction<NewProposalState>> = (
      action,
    ) => {
      state =
        typeof action === "function"
          ? (action as (p: NewProposalState) => NewProposalState)(state)
          : action
    }
    return { get state() { return state }, setState }
  }

  const noopProgress = () => {}
  const headers = ["Product Name", "Ref", "Price", "Qty"]
  const mapping = {
    name: "Product Name",
    ref: "Ref",
    currentPrice: null,
    price: "Price",
    qty: "Qty",
    costBasis: null,
    category: null,
  }

  it("ABC-5000 does NOT inherit ABC-500's usage volume; exact ref still merges", async () => {
    const usageProduct = {
      benchmarkId: "",
      productName: "ACL Kit Standard",
      refNumber: "ABC-500",
      proposedPrice: 0,
      projectedVolume: 700,
      historicalAvgPrice: 120,
      fromPricingFile: false,
    }
    const harness = stateHarness(
      makeState({ products: [usageProduct] }),
    )
    await handlePricingRowsImport(
      headers,
      [
        { "Product Name": "ACL Kit Standard", Ref: "ABC-500", Price: "100", Qty: "1" },
        { "Product Name": "ACL Kit Deluxe", Ref: "ABC-5000", Price: "200", Qty: "1" },
      ],
      mapping,
      noopProgress as never,
      harness.setState,
      () => {},
    )
    const byRef = Object.fromEntries(
      harness.state.products
        .filter((p) => p.fromPricingFile)
        .map((p) => [p.refNumber, p]),
    )
    // Exact ref merged: gets the usage volume.
    expect(byRef["ABC-500"]?.projectedVolume).toBe(700)
    // Near-identical ref did NOT: keeps its own file quantity.
    expect(byRef["ABC-5000"]?.projectedVolume).toBe(1)
  })

  it("when both sides carry DIFFERENT refs, a containing name no longer merges", async () => {
    const usageProduct = {
      benchmarkId: "",
      productName: "Knee",
      refNumber: "K-1",
      proposedPrice: 0,
      projectedVolume: 300,
      historicalAvgPrice: 90,
      fromPricingFile: false,
    }
    const harness = stateHarness(makeState({ products: [usageProduct] }))
    await handlePricingRowsImport(
      headers,
      [{ "Product Name": "Knee Kit Complete", Ref: "K-2", Price: "50", Qty: "2" }],
      mapping,
      noopProgress as never,
      harness.setState,
      () => {},
    )
    const p = harness.state.products.find((x) => x.refNumber === "K-2")
    expect(p?.projectedVolume).toBe(2)
  })

  it("ref-less rows still merge on EXACT (case-insensitive) name", async () => {
    const usageProduct = {
      benchmarkId: "",
      productName: "Press Fit Knee",
      refNumber: "",
      proposedPrice: 0,
      projectedVolume: 450,
      historicalAvgPrice: 80,
      fromPricingFile: false,
    }
    const harness = stateHarness(makeState({ products: [usageProduct] }))
    await handlePricingRowsImport(
      ["Product Name", "Price", "Qty"],
      [{ "Product Name": "press fit knee", Price: "60", Qty: "3" }],
      { name: "Product Name", ref: null, currentPrice: null, price: "Price", qty: "Qty", costBasis: null, category: null },
      noopProgress as never,
      harness.setState,
      () => {},
    )
    const p = harness.state.products.find((x) => x.fromPricingFile)
    expect(p?.projectedVolume).toBe(450)
  })
})
