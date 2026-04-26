/**
 * Pre-extract text from a PDF before sending to Claude.
 *
 * Why: Claude's PDF vision is good but accuracy drops on scanned
 * documents and very long contracts. Feeding the text layer (when
 * it exists) alongside the file part gives Claude a fast-path
 * lookup table for tables / line items / numbers — improves
 * extraction quality on tier ladders + pricing especially.
 *
 * Returns:
 *   - text: extracted plain text (best-effort, capped at 50k chars
 *     to keep prompt size reasonable)
 *   - hasTextLayer: false → likely scanned, vision-only mode is the
 *     only option (tesseract.js could OCR but the 50MB lang data
 *     load makes it impractical for an interactive upload flow —
 *     defer to a background batch job for scan-only contracts).
 *   - pageCount: useful for cost / latency budgeting.
 */

import { PDFParse } from "pdf-parse"

export interface PdfTextResult {
  text: string
  hasTextLayer: boolean
  pageCount: number
  truncated: boolean
}

const MAX_TEXT_CHARS = 50_000
const SCANNED_THRESHOLD_CHARS = 200

export async function extractPdfText(
  pdfBytes: Uint8Array | Buffer,
): Promise<PdfTextResult> {
  let parser: PDFParse | null = null
  try {
    // Defensive copy: pdf-parse transfers the underlying ArrayBuffer to a
    // worker, which detaches the caller's view. Without this copy, anyone
    // reusing `pdfBytes` after this helper sees a zero-length buffer —
    // the streaming extract route hit exactly that and Anthropic 400'd
    // with "PDF cannot be empty".
    const data = new Uint8Array(pdfBytes)
    parser = new PDFParse({ data })
    const result = await parser.getText()
    const raw = (result.text ?? "").trim()
    const truncated = raw.length > MAX_TEXT_CHARS
    return {
      text: truncated ? raw.slice(0, MAX_TEXT_CHARS) : raw,
      hasTextLayer: raw.length >= SCANNED_THRESHOLD_CHARS,
      pageCount: result.pages?.length ?? 0,
      truncated,
    }
  } catch (err) {
    console.warn("[pdf-text-helper] pdf-parse failed:", err)
    return { text: "", hasTextLayer: false, pageCount: 0, truncated: false }
  } finally {
    if (parser) {
      try {
        await parser.destroy()
      } catch {
        // ignore
      }
    }
  }
}
