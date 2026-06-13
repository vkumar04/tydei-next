/**
 * importInChunks unit tests (uploader improvement 5, 2026-06-13).
 *
 * Sequential chunked import: aggregates inserted/replaced across chunks,
 * fires onProgress after each chunk, and on a mid-import failure throws a
 * message naming how many rows landed before the error (replace-safe retry).
 */

import { describe, expect, it, vi } from "vitest"
import { importInChunks } from "../chunked-import"

describe("importInChunks — aggregation", () => {
  it("sums inserted and replaced across all chunks", async () => {
    const items = Array.from({ length: 5 }, (_, i) => i)
    const res = await importInChunks({
      items,
      chunkSize: 2,
      importChunk: (chunk) => Promise.resolve({ inserted: chunk.length, replaced: 1 }),
    })
    // 3 chunks (2,2,1) → inserted 5, replaced 3 (one per chunk).
    expect(res).toEqual({ inserted: 5, replaced: 3 })
  })

  it("defaults replaced to 0 when a chunk omits it", async () => {
    const res = await importInChunks({
      items: [1, 2, 3],
      chunkSize: 10,
      importChunk: (chunk) => Promise.resolve({ inserted: chunk.length }),
    })
    expect(res).toEqual({ inserted: 3, replaced: 0 })
  })

  it("passes the correct (index, total) to importChunk", async () => {
    const seen: Array<{ index: number; total: number; size: number }> = []
    await importInChunks({
      items: [1, 2, 3, 4, 5],
      chunkSize: 2,
      importChunk: (chunk, index, total) => {
        seen.push({ index, total, size: chunk.length })
        return Promise.resolve({ inserted: chunk.length })
      },
    })
    expect(seen).toEqual([
      { index: 0, total: 3, size: 2 },
      { index: 1, total: 3, size: 2 },
      { index: 2, total: 3, size: 1 },
    ])
  })

  it("imports chunks strictly sequentially (never overlaps)", async () => {
    let active = 0
    let maxActive = 0
    await importInChunks({
      items: [1, 2, 3, 4],
      chunkSize: 1,
      importChunk: async (chunk) => {
        active++
        maxActive = Math.max(maxActive, active)
        await Promise.resolve()
        active--
        return { inserted: chunk.length }
      },
    })
    expect(maxActive).toBe(1)
  })
})

describe("importInChunks — onProgress", () => {
  it("reports cumulative done after each chunk, ending at total", async () => {
    const calls: Array<[number, number]> = []
    await importInChunks({
      items: [1, 2, 3, 4, 5],
      chunkSize: 2,
      importChunk: (chunk) => Promise.resolve({ inserted: chunk.length }),
      onProgress: (done, total) => calls.push([done, total]),
    })
    expect(calls).toEqual([
      [2, 5],
      [4, 5],
      [5, 5],
    ])
  })

  it("never calls onProgress for an empty input", async () => {
    const onProgress = vi.fn()
    const res = await importInChunks({
      items: [],
      chunkSize: 100,
      importChunk: () => Promise.resolve({ inserted: 0 }),
      onProgress,
    })
    expect(res).toEqual({ inserted: 0, replaced: 0 })
    expect(onProgress).not.toHaveBeenCalled()
  })
})

describe("importInChunks — mid-import failure", () => {
  it("throws naming how many rows landed before the error, with the cause", async () => {
    await expect(
      importInChunks({
        items: [1, 2, 3, 4, 5],
        chunkSize: 2,
        importChunk: (chunk, index) => {
          // First chunk (rows 1-2) succeeds; second chunk throws.
          if (index === 1) return Promise.reject(new Error("DB timeout"))
          return Promise.resolve({ inserted: chunk.length })
        },
      }),
    ).rejects.toThrow(
      /Imported 2 of 5 rows before the error — re-importing is safe \(replace semantics\)\. Cause: DB timeout/,
    )
  })

  it("reports 0 landed when the very first chunk fails", async () => {
    await expect(
      importInChunks({
        items: [1, 2, 3],
        chunkSize: 2,
        importChunk: () => Promise.reject(new Error("boom")),
      }),
    ).rejects.toThrow(/Imported 0 of 3 rows before the error/)
  })

  it("stops after the first failure (no further chunks attempted)", async () => {
    const importChunk = vi.fn((chunk: number[], index: number) =>
      index === 0
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ inserted: chunk.length }),
    )
    await expect(
      importInChunks({ items: [1, 2, 3, 4], chunkSize: 1, importChunk }),
    ).rejects.toThrow()
    expect(importChunk).toHaveBeenCalledTimes(1)
  })
})

describe("importInChunks — guards", () => {
  it("rejects a non-positive chunkSize", async () => {
    await expect(
      importInChunks({
        items: [1],
        chunkSize: 0,
        importChunk: () => Promise.resolve({ inserted: 1 }),
      }),
    ).rejects.toThrow(/chunkSize must be a positive integer/)
  })
})
