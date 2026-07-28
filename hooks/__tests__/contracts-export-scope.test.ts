import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Contracts CSV export — the file must describe the whole filtered set,
 * not the page the table happens to be showing.
 *
 * Before 2026-07-28 `handleDownloadCsv` serialized the rows already in
 * memory (the first `getContracts` page, `pageSize` 20) and named the file
 * `contracts-<date>.csv`, so a 45-contract facility silently downloaded 20
 * rows with nothing on screen or in the filename saying so.
 *
 * `fetchContractsForExport` pages the full match instead, and reports
 * `capped` when the hard row ceiling bites so the caller can label it.
 */

const { getContractsMock } = vi.hoisted(() => ({
  getContractsMock: vi.fn(),
}))

vi.mock("@/lib/actions/contracts", () => ({
  getContracts: getContractsMock,
  getContract: vi.fn(),
  getContractStats: vi.fn(),
  createContractSafe: vi.fn(),
  updateContract: vi.fn(),
  deleteContract: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import {
  CONTRACTS_EXPORT_ROW_CAP,
  fetchContractsForExport,
  summarizeContractsExport,
} from "@/hooks/use-contracts"

/** Fake server: `total` rows, served in pages of `pageSize`. */
function serve(total: number) {
  getContractsMock.mockImplementation(
    ({ page = 1, pageSize = 20 }: { page?: number; pageSize?: number }) => {
      const start = (page - 1) * pageSize
      const count = Math.max(0, Math.min(pageSize, total - start))
      return Promise.resolve({
        contracts: Array.from({ length: count }, (_, i) => ({
          id: `c-${start + i}`,
        })),
        total,
      })
    },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("fetchContractsForExport", () => {
  it("returns every matching contract, not the first list page", async () => {
    serve(45)
    const { rows, total, capped } = await fetchContractsForExport("fac-1")
    expect(rows).toHaveLength(45)
    expect(total).toBe(45)
    expect(capped).toBe(false)
  })

  it("pages past the first request when the match is larger", async () => {
    serve(250)
    const { rows, total, capped } = await fetchContractsForExport("fac-1")
    expect(rows).toHaveLength(250)
    expect(total).toBe(250)
    expect(capped).toBe(false)
    // page 1 + page 2 + a short page 3 — never a single truncated read.
    expect(getContractsMock).toHaveBeenCalledTimes(3)
    expect(getContractsMock.mock.calls.map((c) => c[0].page)).toEqual([1, 2, 3])
  })

  it("reports the truncation instead of hiding it when the cap bites", async () => {
    serve(CONTRACTS_EXPORT_ROW_CAP + 500)
    const { rows, total, capped } = await fetchContractsForExport("fac-1")
    expect(rows).toHaveLength(CONTRACTS_EXPORT_ROW_CAP)
    expect(total).toBe(CONTRACTS_EXPORT_ROW_CAP + 500)
    expect(capped).toBe(true)
  })

  it("exports the same filtered set the table is showing", async () => {
    serve(10)
    await fetchContractsForExport("fac-1", {
      status: "active",
      search: "ortho",
      facilityScope: "shared",
      pageSize: 100,
    })
    const call = getContractsMock.mock.calls[0][0]
    expect(call).toMatchObject({
      facilityId: "fac-1",
      status: "active",
      search: "ortho",
      facilityScope: "shared",
    })
  })

  it("survives an empty result set", async () => {
    serve(0)
    const { rows, total, capped } = await fetchContractsForExport("fac-1")
    expect(rows).toEqual([])
    expect(total).toBe(0)
    expect(capped).toBe(false)
    expect(getContractsMock).toHaveBeenCalledTimes(1)
  })

  it("reports `capped` whenever rows are missing, not only when the cap bit", async () => {
    // Server claims 300 matches but stops sending after a short page (a
    // concurrent delete, a stale count). The file is still incomplete, and
    // `capped` is what makes the caller say so.
    getContractsMock.mockImplementation(({ page = 1 }: { page?: number }) =>
      Promise.resolve({
        contracts:
          page === 1
            ? Array.from({ length: 40 }, (_, i) => ({ id: `c-${i}` }))
            : [],
        total: 300,
      }),
    )
    const { rows, total, capped } = await fetchContractsForExport("fac-1")
    expect(rows).toHaveLength(40)
    expect(total).toBe(300)
    expect(capped).toBe(true)
  })
})

/**
 * The export toast/filename is the other half of the same defect: three
 * counts live in this flow and only two of them share a scope.
 *
 *   total         — rows the SERVER matched for the filters it saw
 *   fetchedCount  — rows pulled back (≤ CONTRACTS_EXPORT_ROW_CAP)
 *   exportedCount — rows in the file, AFTER the client-side facility narrowing
 *
 * "Exported 12 of 143 matching contracts" pairs the narrowed numerator with
 * the un-narrowed denominator and reads as a 12/143 coverage claim it never
 * earned. Each number has to carry its own scope.
 */
describe("summarizeContractsExport", () => {
  const stamp = "2026-07-28"

  it("labels the cap in BOTH the toast and the filename", () => {
    const s = summarizeContractsExport({
      exportedCount: CONTRACTS_EXPORT_ROW_CAP,
      fetchedCount: CONTRACTS_EXPORT_ROW_CAP,
      total: 4200,
      capped: true,
      narrowed: false,
      stamp,
    })
    expect(s.tone).toBe("warning")
    expect(s.filename).toBe(
      `contracts-${stamp}-first-${CONTRACTS_EXPORT_ROW_CAP}-of-4200.csv`,
    )
    expect(s.message).toContain("4200")
    expect(s.message).toContain(String(CONTRACTS_EXPORT_ROW_CAP))
  })

  it("keeps the filename's two numbers on ONE scope when a facility narrowing is active", () => {
    const s = summarizeContractsExport({
      exportedCount: 12,
      fetchedCount: CONTRACTS_EXPORT_ROW_CAP,
      total: 4200,
      capped: true,
      narrowed: true,
      stamp,
    })
    // "first 12 of 4200" would be a lie — 12 is post-narrowing.
    expect(s.filename).not.toContain("first-12-of")
    expect(s.filename).toBe(
      `contracts-${stamp}-first-${CONTRACTS_EXPORT_ROW_CAP}-of-4200.csv`,
    )
    // The toast may name 12, but only against the facility it describes.
    expect(s.message).toMatch(/12 contracts for the selected facility/)
    expect(s.message).toContain("not in the file")
  })

  it("says the narrowing out loud when it shrinks a complete result set", () => {
    const s = summarizeContractsExport({
      exportedCount: 3,
      fetchedCount: 40,
      total: 40,
      capped: false,
      narrowed: true,
      stamp,
    })
    expect(s.tone).toBe("success")
    expect(s.filename).toBe(`contracts-${stamp}.csv`)
    expect(s.message).toMatch(/narrowed to the selected facility/)
  })

  it("makes no coverage claim when nothing is capped or narrowed", () => {
    const s = summarizeContractsExport({
      exportedCount: 40,
      fetchedCount: 40,
      total: 40,
      capped: false,
      narrowed: false,
      stamp,
    })
    expect(s.tone).toBe("success")
    expect(s.message).toBe("Exported 40 contracts.")
    expect(s.filename).toBe(`contracts-${stamp}.csv`)
  })

  it("never claims a successful export of zero rows", () => {
    const s = summarizeContractsExport({
      exportedCount: 0,
      fetchedCount: 40,
      total: 40,
      capped: false,
      narrowed: true,
      stamp,
    })
    expect(s.tone).toBe("info")
    expect(s.message).toMatch(/nothing to export/)
  })
})
