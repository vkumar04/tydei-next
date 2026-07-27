import { describe, it, expect } from "vitest"
import { meaningfulPdfText } from "@/lib/ai/pdf-text-helper"

/**
 * Charles 2026-07-27, "COG ROSA .pdf": a 4-page scanned Zimmer Biomet rebate
 * amendment whose ONLY real text is the DocuSign envelope stamp on each page
 * plus the DocuSign-rendered signer block. Verbatim `pdf-parse` output.
 */
const COG_ROSA_TEXT = [
  "DocuSign Envelope ID: 2EB3A1A8-1B95-4A18-A24D-09F2FB114570",
  "",
  "-- 1 of 4 --",
  "",
  "DocuSign Envelope ID: 2EB3A1A8-1B95-4A18-A24D-09F2FB114570",
  "Chris Jepson",
  "20-Jan-2023 | 1:07 PM EST",
  "Capital Solutions Director",
  "",
  "-- 2 of 4 --",
  "",
  "DocuSign Envelope ID: 2EB3A1A8-1B95-4A18-A24D-09F2FB114570",
  "",
  "-- 3 of 4 --",
  "",
  "DocuSign Envelope ID: 2EB3A1A8-1B95-4A18-A24D-09F2FB114570",
  "",
  "-- 4 of 4 --",
  "",
].join("\n")

// Mirrors the thresholds in pdf-text-helper.ts.
const TEXT_LAYER_MIN_CHARS = 200
const TEXT_LAYER_MIN_CHARS_PER_PAGE = 100

function classify(raw: string, pageCount: number) {
  const meaningful = meaningfulPdfText(raw)
  const perPage = pageCount > 0 ? meaningful.length / pageCount : meaningful.length
  return {
    meaningfulChars: meaningful.length,
    hasTextLayer:
      meaningful.length >= TEXT_LAYER_MIN_CHARS &&
      perPage >= TEXT_LAYER_MIN_CHARS_PER_PAGE,
  }
}

describe("meaningfulPdfText", () => {
  it("strips DocuSign envelope stamps", () => {
    expect(
      meaningfulPdfText(
        "DocuSign Envelope ID: 2EB3A1A8-1B95-4A18-A24D-09F2FB114570\nHello",
      ),
    ).toBe("Hello")
  })

  it("strips pdf-parse page separators", () => {
    expect(meaningfulPdfText("Alpha\n\n-- 2 of 17 --\n\nBeta")).toBe("Alpha Beta")
  })

  it("leaves real contract prose intact", () => {
    const prose =
      "During the Term of the Agreement, Customer will owe a quarterly payment to Provider."
    expect(meaningfulPdfText(prose)).toBe(prose)
  })
})

describe("scanned-PDF detection (COG ROSA regression)", () => {
  it("clears the raw 200-char bar that used to misclassify it", () => {
    // This is precisely why the old flat `raw.length >= 200` check failed.
    expect(COG_ROSA_TEXT.trim().length).toBeGreaterThanOrEqual(TEXT_LAYER_MIN_CHARS)
  })

  it("is classified as SCANNED once envelope furniture is discounted", () => {
    const { hasTextLayer, meaningfulChars } = classify(COG_ROSA_TEXT, 4)
    expect(hasTextLayer).toBe(false)
    // Only the signer block survives — nothing of the actual agreement.
    expect(meaningfulChars).toBeLessThan(TEXT_LAYER_MIN_CHARS)
  })

  it("still classifies a genuine text-layer contract as text", () => {
    const page =
      "Section 2 is deleted and replaced with the following: During the Term of " +
      "the Agreement, Customer will owe a quarterly payment to Provider in exchange " +
      "for placement of the Equipment with Customer and Customer's use of the " +
      "Equipment. The quarterly payment will be $37,009.00 for year 1. "
    const raw = [1, 2, 3, 4]
      .map((n) => `DocuSign Envelope ID: ABC-123\n${page.repeat(4)}\n-- ${n} of 4 --`)
      .join("\n")
    expect(classify(raw, 4).hasTextLayer).toBe(true)
  })

  it("does not let one stamped text page carry a long scan", () => {
    // 1 real page of text inside a 40-page scan: passes the absolute floor,
    // fails on density — which is the point of the per-page rule.
    const raw = "Real contract prose. ".repeat(30) // ~630 chars
    const { hasTextLayer } = classify(raw, 40)
    expect(hasTextLayer).toBe(false)
  })
})
