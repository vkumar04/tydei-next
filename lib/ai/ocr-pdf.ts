/**
 * Scanned-PDF OCR for contract extraction.
 *
 * Why: many tie-in / capital contract PDFs are scanned images with no
 * text layer (`extractPdfText().hasTextLayer === false`). Claude's PDF
 * vision reads prose well but is unreliable on the dense financing /
 * Truth-in-Lending tables where the capital equipment value lives
 * ("Amount Financed $785,195"), so `tieInDetails.capitalEquipmentValue`
 * came back null and the tie-in had no capital structure (Vick
 * 2026-06-14 "Tie in is not seeing the capital with the AI").
 *
 * This runs a MarkItDown-style local OCR pass: rasterize each page with
 * mupdf (WASM) and OCR it with tesseract.js (WASM, no API key, no
 * external service). The resulting text is handed to the extraction
 * model ALONGSIDE the page image (hybrid: image for layout, OCR text for
 * the numbers). Proven on the Arthrex/ROSA scans to surface the dollar
 * figures vision was dropping.
 *
 * Server-only. mupdf + tesseract.js are `serverExternalPackages` in
 * next.config and imported dynamically here so they never reach the
 * client bundle. Best-effort: any failure returns "" so the caller
 * falls back to vision-only (the prior behavior) rather than 500-ing.
 */

export interface OcrPdfOptions {
  /** Cap pages OCR'd (OCR is ~1-3s/page). Default 10. */
  maxPages?: number
  /** Rasterization DPI. Higher = sharper text, slower. Default 200. */
  dpi?: number
  /** Abort cooperatively between pages. */
  signal?: AbortSignal
  /** Log prefix to correlate with the extraction call. */
  logPrefix?: string
}

/**
 * OCR a PDF buffer to plain text. Returns "" on any failure (caller
 * falls back to vision-only). Never throws.
 */
export async function ocrPdfBuffer(
  pdf: Uint8Array,
  opts: OcrPdfOptions = {},
): Promise<string> {
  const { maxPages = 10, dpi = 200, signal, logPrefix = "[ocr-pdf]" } = opts

  let worker: Awaited<
    ReturnType<typeof import("tesseract.js").createWorker>
  > | null = null
  // mupdf objects hold WebAssembly memory that the GC won't reclaim — the
  // docs are explicit that Document/Page/Pixmap MUST be destroy()'d or a
  // long-running server leaks. Track the doc so `finally` always frees it.
  let doc: Awaited<typeof import("mupdf")>["Document"]["prototype"] | null =
    null

  try {
    const mupdf = await import("mupdf")
    const { createWorker } = await import("tesseract.js")
    const os = await import("os")

    doc = mupdf.Document.openDocument(pdf, "application/pdf")
    const pageCount = Math.min(doc.countPages(), maxPages)
    if (pageCount <= 0) return ""

    // cachePath → a writable temp dir: Railway's standalone bundle dir can
    // be read-only, and the default cache write would throw. tesseract.js
    // fetches eng.traineddata from its CDN on first use and caches it here.
    worker = await createWorker("eng", undefined, {
      cachePath: os.tmpdir(),
    })
    const scale = mupdf.Matrix.scale(dpi / 72, dpi / 72)
    const parts: string[] = []

    for (let i = 0; i < pageCount; i++) {
      if (signal?.aborted) break
      const page = doc.loadPage(i)
      try {
        const pixmap = page.toPixmap(
          scale,
          mupdf.ColorSpace.DeviceRGB,
          false,
          true,
        )
        try {
          const png = pixmap.asPNG()
          const { data } = await worker.recognize(Buffer.from(png))
          const text = data.text?.trim()
          if (text) parts.push(`--- page ${i + 1} ---\n${text}`)
        } finally {
          pixmap.destroy()
        }
      } catch (pageErr) {
        console.warn(`${logPrefix} page ${i + 1} OCR failed:`, pageErr)
      } finally {
        page.destroy()
      }
    }

    return parts.join("\n\n")
  } catch (err) {
    console.warn(`${logPrefix} OCR pass failed, falling back to vision:`, err)
    return ""
  } finally {
    try {
      doc?.destroy()
    } catch {
      /* already freed */
    }
    if (worker) {
      try {
        await worker.terminate()
      } catch {
        /* worker already gone */
      }
    }
  }
}
