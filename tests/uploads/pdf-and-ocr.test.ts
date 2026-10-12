import { describe, expect, it, beforeAll } from "vitest"
import { extractPdfText } from "@/lib/ai/pdf-text-helper"
import { ocrPdfBuffer } from "@/lib/ai/ocr-pdf"
import {
  CONTRACT_FIXTURE,
  buildTextPdf,
  contractPdfLines,
  rasterizeToScannedPdf,
} from "../support/upload-fixtures"

let textPdf: Uint8Array
let scannedPdf: Uint8Array

beforeAll(async () => {
  textPdf = await buildTextPdf(contractPdfLines())
  scannedPdf = await rasterizeToScannedPdf(textPdf)
})

describe("contract PDF text layer", () => {
  it("reads a digital PDF as text, with every key figure present", async () => {
    const result = await extractPdfText(textPdf)
    expect(result.hasTextLayer).toBe(true)
    expect(result.pageCount).toBe(2)
    for (const needle of [
      CONTRACT_FIXTURE.contractNumber,
      CONTRACT_FIXTURE.vendor,
      CONTRACT_FIXTURE.capitalValue,
      CONTRACT_FIXTURE.totalValue,
    ]) {
      expect(result.text).toContain(needle)
    }
  })

  it("does not detach the caller's buffer", async () => {
    const bytes = new Uint8Array(textPdf)
    await extractPdfText(bytes)
    expect(bytes.byteLength).toBe(textPdf.byteLength)
  })

  it("classifies an image-only scan as having no text layer", async () => {
    const result = await extractPdfText(scannedPdf)
    expect(result.hasTextLayer).toBe(false)
    expect(result.pageCount).toBe(2)
  })

  it("degrades a corrupt PDF to an empty, scan-classified result instead of throwing", async () => {
    const result = await extractPdfText(Buffer.from("%PDF-1.7 this is not a pdf"))
    expect(result).toMatchObject({ text: "", hasTextLayer: false, pageCount: 0 })
  })
})

describe("scanned PDF OCR", () => {
  it(
    "recovers the contract number and the financing figure from the image-only scan",
    async () => {
      const text = await ocrPdfBuffer(scannedPdf, { logPrefix: "[ocr-test]" })
      expect(text, "OCR returned nothing — the worker or language data failed to load").not.toBe("")
      expect(text).toMatch(/--- page 1 ---/)
      expect(text).toMatch(/--- page 2 ---/)
      expect(text.replace(/\s+/g, " ")).toContain(CONTRACT_FIXTURE.contractNumber)
      expect(text.replace(/\s+/g, "")).toContain(CONTRACT_FIXTURE.capitalValue.replace(/\s+/g, ""))
    },
    180_000,
  )

  it("honors maxPages", async () => {
    const text = await ocrPdfBuffer(scannedPdf, { maxPages: 1 })
    expect(text).toMatch(/--- page 1 ---/)
    expect(text).not.toMatch(/--- page 2 ---/)
  }, 180_000)

  it("stops between pages when aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await ocrPdfBuffer(scannedPdf, { signal: controller.signal })).toBe("")
  }, 180_000)

  it("returns an empty string for a non-PDF instead of throwing", async () => {
    expect(await ocrPdfBuffer(Buffer.from("not a pdf"))).toBe("")
  }, 60_000)
})
