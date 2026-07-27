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
  /**
   * Characters left after scan furniture is stripped — what `hasTextLayer`
   * actually judged. Logged by callers so a misclassification is diagnosable
   * from the server log alone.
   */
  meaningfulChars: number
}

const MAX_TEXT_CHARS = 50_000

/**
 * A scanned PDF is not always text-EMPTY. E-signature platforms stamp an
 * envelope header onto every page as *real* text at signing time, and the
 * signer block they render is real text too, so a 4-page pure scan can carry
 * ~350 chars while every actual word of the contract is a bitmap.
 *
 * Charles 2026-07-27 ("COG ROSA .pdf"): a 4-page scanned Zimmer Biomet rebate
 * amendment extracted 358 chars — all of it DocuSign envelope IDs plus
 * "Chris Jepson / Capital Solutions Director". That cleared the old flat
 * 200-char bar, so `hasTextLayer` came back TRUE and the file took the
 * single-call vision path, which (a) never runs the Tesseract OCR pass and
 * (b) hands the model a "text layer for reference" that is pure envelope
 * noise. Ironic, because ocr-pdf.ts was built for exactly these ROSA scans.
 *
 * So: strip the furniture first, then require both an absolute floor AND a
 * per-page density. Density is what catches this class — a real text-layer
 * contract page runs to thousands of characters; the ROSA scan nets ~16.
 */
const TEXT_LAYER_MIN_CHARS = 200
const TEXT_LAYER_MIN_CHARS_PER_PAGE = 100

/**
 * Text a scanned PDF still carries despite having no readable text layer:
 * e-signature stamps, and pdf-parse's own "-- N of M --" page separators.
 */
const SCAN_FURNITURE: RegExp[] = [
  /DocuSign\s+Envelope\s+ID:\s*[A-Za-z0-9-]+/gi,
  /Envelope\s+Id:\s*\S+/gi,
  /Transaction\s+ID:\s*\S+/gi,
  /Certificate\s+Of\s+Completion/gi,
  /Powered\s+by\s+Adobe\s+Acrobat\s+Sign|Adobe\s+Sign|EchoSign/gi,
  // pdf-parse v2 page separator, e.g. "-- 2 of 4 --"
  /--\s*\d+\s+of\s+\d+\s*--/g,
]

/** Strip scan furniture and collapse whitespace, for density measurement only. */
export function meaningfulPdfText(raw: string): string {
  let t = raw
  for (const re of SCAN_FURNITURE) t = t.replace(re, " ")
  return t.replace(/\s+/g, " ").trim()
}

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
    const pageCount = result.pages?.length ?? 0

    const meaningful = meaningfulPdfText(raw)
    const perPage = pageCount > 0 ? meaningful.length / pageCount : meaningful.length
    const hasTextLayer =
      meaningful.length >= TEXT_LAYER_MIN_CHARS &&
      perPage >= TEXT_LAYER_MIN_CHARS_PER_PAGE

    if (!hasTextLayer && raw.length >= TEXT_LAYER_MIN_CHARS) {
      // Would have passed the old flat char count. Worth a line in the log —
      // this is the DocuSign-stamped-scan case.
      console.warn(
        `[pdf-text-helper] ${raw.length} raw chars but only ${meaningful.length} meaningful ` +
          `(${perPage.toFixed(0)}/page over ${pageCount} pages) — treating as scanned`,
      )
    }

    return {
      text: truncated ? raw.slice(0, MAX_TEXT_CHARS) : raw,
      hasTextLayer,
      pageCount,
      truncated,
      meaningfulChars: meaningful.length,
    }
  } catch (err) {
    console.warn("[pdf-text-helper] pdf-parse failed:", err)
    return {
      text: "",
      hasTextLayer: false,
      pageCount: 0,
      truncated: false,
      meaningfulChars: 0,
    }
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
