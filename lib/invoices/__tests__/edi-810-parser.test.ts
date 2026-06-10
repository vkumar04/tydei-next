/**
 * Tests for the minimal X12 EDI 810 parser (lib/invoices/edi-810-parser.ts).
 *
 * Fixtures are synthetic but structurally faithful 810s:
 *   - single-invoice file with full envelope
 *   - multi-invoice file (two ST..SE transactions in one GS group)
 *   - missing-optional-segments file (no N1*VN, no PID, no TDS, no BIG date)
 *   - malformed files (truncated, non-810 transaction, garbage, bad numbers)
 */
import { describe, it, expect } from "vitest"
import { parseEdi810 } from "@/lib/invoices/edi-810-parser"

// ─── Fixtures ───────────────────────────────────────────────────

const SINGLE_INVOICE = [
  "ISA*00*          *00*          *ZZ*SENDERID       *ZZ*RECEIVERID     *260610*1200*U*00401*000000001*0*P*>",
  "GS*IN*SENDERID*RECEIVERID*20260610*1200*1*X*004010",
  "ST*810*0001",
  "BIG*20260601*INV-1001**PO-2026-042",
  "N1*VN*ACME MEDICAL SUPPLY",
  "N1*BT*LIGHTHOUSE SURGICAL CENTER",
  "IT1*1*10*EA*25.50**VP*SKU-100",
  "PID*F****SURGICAL GLOVES BOX",
  "IT1*2*2*CS*100*PE*VN*SKU-200*UP*012345678905",
  "PID*F****SUTURE KIT",
  "TDS*45500",
  "CTT*2",
  "SE*11*0001",
  "GE*1*1",
  "IEA*1*000000001",
].join("~\n") + "~\n"

const MULTI_INVOICE = [
  "ISA*00*          *00*          *ZZ*SENDERID       *ZZ*RECEIVERID     *260610*1200*U*00401*000000002*0*P*>",
  "GS*IN*SENDERID*RECEIVERID*20260610*1200*2*X*004010",
  "ST*810*0001",
  "BIG*20260520*INV-A1**PO-1",
  "N1*VN*VENDOR ONE",
  "IT1*1*5*EA*10**VN*ITEM-A",
  "TDS*5000",
  "SE*6*0001",
  "ST*810*0002",
  "BIG*20260521*INV-B2",
  "N1*VN*VENDOR TWO",
  "IT1*1*3*EA*7.25**VP*ITEM-B",
  "PID*F****WIDGET",
  "IT1*2*1*EA*2**VP*ITEM-C",
  "TDS*2375",
  "SE*8*0002",
  "GE*2*2",
  "IEA*1*000000002",
].join("~") + "~"

// No envelope, no N1*VN, no PID, no TDS, no PO number, no date.
const MISSING_OPTIONALS = [
  "ST*810*7777",
  "BIG**INV-MIN",
  "IT1*1*4*EA*12.5**VP*MIN-1",
  "SE*4*7777",
].join("~")

// ─── Happy paths ────────────────────────────────────────────────

describe("parseEdi810 — single invoice", () => {
  it("extracts header, vendor, PO, lines, descriptions and total", () => {
    const { invoices, errors } = parseEdi810(SINGLE_INVOICE)
    expect(errors).toEqual([])
    expect(invoices).toHaveLength(1)

    const inv = invoices[0]
    expect(inv.invoiceNumber).toBe("INV-1001")
    expect(inv.invoiceDate).toBe("2026-06-01")
    expect(inv.vendorName).toBe("ACME MEDICAL SUPPLY")
    expect(inv.poNumber).toBe("PO-2026-042")
    // TDS is cents.
    expect(inv.totalAmount).toBe(455)

    expect(inv.lineItems).toHaveLength(2)
    expect(inv.lineItems[0]).toEqual({
      vendorItemNo: "SKU-100",
      description: "SURGICAL GLOVES BOX",
      quantity: 10,
      unitPrice: 25.5,
    })
    // VN qualifier wins even with a trailing UP (UPC) pair.
    expect(inv.lineItems[1]).toEqual({
      vendorItemNo: "SKU-200",
      description: "SUTURE KIT",
      quantity: 2,
      unitPrice: 100,
    })
  })

  it("ignores non-vendor N1 parties (BT, ST, etc.)", () => {
    const { invoices } = parseEdi810(SINGLE_INVOICE)
    expect(invoices[0].vendorName).toBe("ACME MEDICAL SUPPLY")
  })

  it("tolerates trailing newlines after segment terminators", () => {
    const withNoise = SINGLE_INVOICE + "\n\n"
    const { invoices, errors } = parseEdi810(withNoise)
    expect(errors).toEqual([])
    expect(invoices).toHaveLength(1)
  })
})

describe("parseEdi810 — multi-invoice file", () => {
  it("returns one Edi810Invoice per ST..SE transaction", () => {
    const { invoices, errors } = parseEdi810(MULTI_INVOICE)
    expect(errors).toEqual([])
    expect(invoices).toHaveLength(2)

    expect(invoices[0].invoiceNumber).toBe("INV-A1")
    expect(invoices[0].vendorName).toBe("VENDOR ONE")
    expect(invoices[0].poNumber).toBe("PO-1")
    expect(invoices[0].totalAmount).toBe(50)
    expect(invoices[0].lineItems).toHaveLength(1)

    expect(invoices[1].invoiceNumber).toBe("INV-B2")
    expect(invoices[1].vendorName).toBe("VENDOR TWO")
    expect(invoices[1].poNumber).toBeNull()
    expect(invoices[1].totalAmount).toBe(23.75)
    expect(invoices[1].lineItems).toHaveLength(2)
    expect(invoices[1].lineItems[0].description).toBe("WIDGET")
    expect(invoices[1].lineItems[1].description).toBeNull()
  })
})

describe("parseEdi810 — missing optional segments", () => {
  it("still parses; optional fields are null", () => {
    const { invoices, errors } = parseEdi810(MISSING_OPTIONALS)
    expect(errors).toEqual([])
    expect(invoices).toHaveLength(1)

    const inv = invoices[0]
    expect(inv.invoiceNumber).toBe("INV-MIN")
    expect(inv.invoiceDate).toBeNull()
    expect(inv.vendorName).toBeNull()
    expect(inv.poNumber).toBeNull()
    expect(inv.totalAmount).toBeNull()
    expect(inv.lineItems).toEqual([
      { vendorItemNo: "MIN-1", description: null, quantity: 4, unitPrice: 12.5 },
    ])
  })
})

// ─── Malformed input ────────────────────────────────────────────

describe("parseEdi810 — malformed input", () => {
  it("empty input → error, no invoices, no throw", () => {
    expect(parseEdi810("")).toEqual({
      invoices: [],
      errors: ["File is empty."],
    })
    expect(parseEdi810("   \n  ").invoices).toEqual([])
  })

  it("non-EDI garbage → honest 'no ST segment' error", () => {
    const { invoices, errors } = parseEdi810("%PDF-1.4 not an edi file at all")
    expect(invoices).toEqual([])
    expect(errors.some((e) => e.includes("No ST"))).toBe(true)
  })

  it("non-810 transaction type is skipped with an error", () => {
    const file = [
      "ST*850*0001",
      "BEG*00*NE*PO-1**20260601",
      "SE*3*0001",
    ].join("~")
    const { invoices, errors } = parseEdi810(file)
    expect(invoices).toEqual([])
    expect(errors.some((e) => e.includes("ST*850"))).toBe(true)
  })

  it("missing BIG → transaction skipped with error", () => {
    const file = [
      "ST*810*0001",
      "IT1*1*1*EA*5**VP*X",
      "SE*3*0001",
    ].join("~")
    const { invoices, errors } = parseEdi810(file)
    expect(invoices).toEqual([])
    expect(errors.some((e) => e.includes("missing BIG"))).toBe(true)
  })

  it("invoice with zero parseable IT1 lines is skipped with error", () => {
    const file = [
      "ST*810*0001",
      "BIG*20260601*INV-EMPTY",
      "IT1*1*abc*EA*xyz**VP*BAD",
      "TDS*100",
      "SE*5*0001",
    ].join("~")
    const { invoices, errors } = parseEdi810(file)
    expect(invoices).toEqual([])
    expect(errors.some((e) => e.includes("non-numeric"))).toBe(true)
    expect(errors.some((e) => e.includes("no IT1 line items"))).toBe(true)
  })

  it("truncated file (no SE) closes implicitly and still returns the invoice", () => {
    const file = [
      "ST*810*0001",
      "BIG*20260601*INV-TRUNC",
      "IT1*1*2*EA*3**VP*T-1",
      "TDS*600",
    ].join("~")
    const { invoices, errors } = parseEdi810(file)
    expect(invoices).toHaveLength(1)
    expect(invoices[0].invoiceNumber).toBe("INV-TRUNC")
    expect(errors.some((e) => e.includes("ended before SE"))).toBe(true)
  })

  it("back-to-back ST without SE closes the previous transaction", () => {
    const file = [
      "ST*810*0001",
      "BIG*20260601*INV-1",
      "IT1*1*1*EA*1**VP*A",
      "ST*810*0002",
      "BIG*20260602*INV-2",
      "IT1*1*1*EA*2**VP*B",
      "SE*4*0002",
    ].join("~")
    const { invoices, errors } = parseEdi810(file)
    expect(invoices.map((i) => i.invoiceNumber)).toEqual(["INV-1", "INV-2"])
    expect(errors.some((e) => e.includes("missing SE"))).toBe(true)
  })

  it("bad BIG date and bad TDS produce errors but keep the invoice", () => {
    const file = [
      "ST*810*0001",
      "BIG*June 1*INV-BAD-DATE",
      "IT1*1*1*EA*9**VP*D-1",
      "TDS*notanumber",
      "SE*5*0001",
    ].join("~")
    const { invoices, errors } = parseEdi810(file)
    expect(invoices).toHaveLength(1)
    expect(invoices[0].invoiceDate).toBeNull()
    expect(invoices[0].totalAmount).toBeNull()
    expect(errors.some((e) => e.includes("unparseable BIG date"))).toBe(true)
    expect(errors.some((e) => e.includes("unparseable TDS amount"))).toBe(true)
  })

  it("SE segment-count mismatch is reported but non-fatal", () => {
    const file = [
      "ST*810*0001",
      "BIG*20260601*INV-COUNT",
      "IT1*1*1*EA*1**VP*A",
      "SE*99*0001",
    ].join("~")
    const { invoices, errors } = parseEdi810(file)
    expect(invoices).toHaveLength(1)
    expect(errors.some((e) => e.includes("declares 99 segments"))).toBe(true)
  })

  it("non-standard element separator from ISA is honored", () => {
    const file = [
      "ISA|00|          |00|          |ZZ|S              |ZZ|R              |260610|1200|U|00401|000000001|0|P|>",
      "GS|IN|S|R|20260610|1200|1|X|004010",
      "ST|810|0001",
      "BIG|20260601|INV-PIPE||PO-9",
      "N1|VN|PIPE VENDOR",
      "IT1|1|2|EA|4||VP|P-1",
      "TDS|800",
      "SE|6|0001",
      "GE|1|1",
      "IEA|1|000000001",
    ].join("~")
    const { invoices, errors } = parseEdi810(file)
    expect(errors).toEqual([])
    expect(invoices).toHaveLength(1)
    expect(invoices[0].invoiceNumber).toBe("INV-PIPE")
    expect(invoices[0].vendorName).toBe("PIPE VENDOR")
    expect(invoices[0].lineItems[0].vendorItemNo).toBe("P-1")
  })
})
