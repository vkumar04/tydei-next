/**
 * Split a PDF into N-page sub-PDFs so a single AI extraction call
 * doesn't exceed Claude's 1M-token context cap on large scanned
 * contracts.
 *
 * Why this matters: vision-only mode on a 30-page Mako tie-in
 * carve-out blew past 1M tokens (Vick prod report 2026-05-25 —
 * "Empty response from extractor"). pdf-parse's text-layer
 * fallback only helps when the PDF *has* a text layer; scanned
 * docs go straight to vision and hit the cap.
 *
 * Strategy: pdf-lib loads the original PDF, copies pages into
 * fresh PDF docs in N-page slices, and serializes each slice to
 * its own byte array. Each slice round-trips through the same
 * `streamObject` extract call the route already uses; the caller
 * merges the per-slice results via mergeExtractedContracts.
 *
 * pdf-lib was chosen over pdfjs-dist's getScreenshot route because
 * Anthropic's native PDF support reads BOTH text + visual layers
 * per page, which is more accurate than image-only chunks for tier
 * ladders and pricing tables.
 */

import { PDFDocument } from "pdf-lib"

export interface PdfChunk {
  pdf: Uint8Array
  pageStart: number // 1-indexed, inclusive
  pageEnd: number // 1-indexed, inclusive
}

export interface SplitOptions {
  maxPagesPerChunk: number
}

export async function splitPdfByPages(
  pdfBytes: Uint8Array | Buffer,
  opts: SplitOptions,
): Promise<PdfChunk[]> {
  if (opts.maxPagesPerChunk <= 0) {
    throw new Error("maxPagesPerChunk must be > 0")
  }

  // Defensive copy — same reason pdf-text-helper uses one. pdf-lib
  // also takes ownership of the underlying ArrayBuffer in some paths;
  // callers reusing the original bytes after this call shouldn't see
  // a zero-length buffer.
  const data = new Uint8Array(pdfBytes)

  // updateMetadata: false avoids pdf-lib's automatic ModDate bump,
  // which would invalidate any signed/notarized PDFs the user uploads.
  // ignoreEncryption: true is the common case for vendor contract PDFs
  // — Adobe Acrobat stamps a permissions dict ("Mako TIE in CARVE
  // OUT.pdf" hit this 2026-05-25) that pdf-lib treats as encryption
  // even though no actual decryption key is needed to read pages.
  const source = await PDFDocument.load(data, {
    updateMetadata: false,
    ignoreEncryption: true,
  })
  const totalPages = source.getPageCount()

  // Single chunk: still go through the slice path so the caller's
  // merge logic is exercised even for small docs (catches merge bugs
  // earlier than a 100-page repro would).
  if (totalPages <= opts.maxPagesPerChunk) {
    return [{ pdf: data, pageStart: 1, pageEnd: totalPages }]
  }

  const chunks: PdfChunk[] = []
  for (let start = 0; start < totalPages; start += opts.maxPagesPerChunk) {
    const end = Math.min(start + opts.maxPagesPerChunk, totalPages)
    const sliceDoc = await PDFDocument.create({ updateMetadata: false })
    const indices = Array.from({ length: end - start }, (_, i) => start + i)
    const copied = await sliceDoc.copyPages(source, indices)
    for (const page of copied) sliceDoc.addPage(page)
    const sliceBytes = await sliceDoc.save({ updateFieldAppearances: false })
    chunks.push({
      pdf: sliceBytes,
      pageStart: start + 1,
      pageEnd: end,
    })
  }
  return chunks
}
