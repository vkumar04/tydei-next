/**
 * Sequential chunked import with progress (uploader improvement 5,
 * 2026-06-13).
 *
 * Splits a large item array into fixed-size chunks and imports them ONE
 * AT A TIME (never parallel — parallel writes to the same vendor/contract
 * race on the replace-then-insert delete and can deadlock or drop rows).
 * Aggregates inserted/replaced across chunks, reports progress after each
 * chunk, and throws on the FIRST failing chunk with a message naming how
 * many rows already landed — every import on these surfaces is
 * replace-safe, so re-running is idempotent.
 *
 * Pure TS (no React, no Prisma) so it's unit-testable in node and reusable
 * by both the benchmark and contract-pricing callers.
 */

export interface ChunkedImportResult {
  inserted: number
  replaced: number
}

export async function importInChunks<T>(opts: {
  items: T[]
  chunkSize: number
  importChunk: (
    chunk: T[],
    index: number,
    total: number,
  ) => Promise<{ inserted: number; replaced?: number }>
  onProgress?: (done: number, total: number) => void
}): Promise<ChunkedImportResult> {
  const { items, chunkSize, importChunk, onProgress } = opts
  const total = items.length
  if (chunkSize <= 0) {
    throw new Error("importInChunks: chunkSize must be a positive integer")
  }

  // Pre-compute the chunk count so importChunk gets an accurate `total`
  // even on the empty-input fast path below.
  const chunkCount = Math.ceil(total / chunkSize)

  let inserted = 0
  let replaced = 0
  let done = 0

  for (let index = 0; index < chunkCount; index++) {
    const chunk = items.slice(index * chunkSize, index * chunkSize + chunkSize)
    try {
      const res = await importChunk(chunk, index, chunkCount)
      inserted += res.inserted
      replaced += res.replaced ?? 0
    } catch (err) {
      // Name how many rows landed before the failure so the user knows the
      // import is partial but safe to retry (replace semantics).
      const reason = err instanceof Error ? err.message : "unknown error"
      throw new Error(
        `Imported ${done} of ${total} rows before the error — ` +
          `re-importing is safe (replace semantics). Cause: ${reason}`,
      )
    }
    done += chunk.length
    onProgress?.(done, total)
  }

  return { inserted, replaced }
}
