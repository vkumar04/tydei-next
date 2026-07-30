/**
 * Real-Postgres round trip for the benchmark columns added 2026-07-29:
 * `currentPrice` (Decimal 12,2) and `annualUnits` (INTEGER).
 *
 * Charles 2026-07-28 → Vick 2026-07-29 ("these should fill in from the loaded
 * benchmark file"): his workbook's Current Pricing and TRL 12 Units columns
 * were parsed and thrown away because the table had nowhere to put them, so
 * the Deal Scorer's Current and Volume cells rendered blank. Mock-based tests
 * can't catch what this one covers — Decimal→Number precision, INTEGER range,
 * and the fact that an unstorable value fails the transaction rather than the
 * single cell. That last one is the reason the file reader bounds values
 * before they ever reach Prisma.
 *
 * The chain under test is the real one: mapBenchmarkRows (parse) → Postgres
 * (store) → getVendorBenchmarks' row mapping (read) → seedConstructFromBenchmark
 * (what the vendor sees in the grid).
 *
 * Skipped unless RUN_INTEGRATION=1 — Docker startup is slow.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "@/lib/generated/prisma/client"
import { Pool } from "pg"
import { PrismaPg } from "@prisma/adapter-pg"
import {
  setupTestDb,
  teardownTestDb,
} from "@/tests/setup/postgres-testcontainer"
import { mapBenchmarkRows } from "@/app/vendor/prospective/sections/benchmark-file-reader"
import { seedConstructFromBenchmark } from "@/app/vendor/prospective/sections/construct-seed"

const skip = process.env.RUN_INTEGRATION !== "1"
const d = skip ? describe.skip : describe

let ctx: Awaited<ReturnType<typeof setupTestDb>>
let prisma: PrismaClient
let pool: Pool | undefined

/** Charles's real workbook, header for header (Benchmarks.xlsx). */
const HEADERS = [
  "Construct",
  "TRL 12 Units",
  "National ASP",
  "Hard Floor",
  "Current Pricing",
  "TRG",
  "5% admin fee removed",
  "Dual 80w/ 50%ZB",
  "Dual 80 W/ 90% ZB",
]

const WORKBOOK_ROWS = [
  ["Cemented Knee", "240", "3300", "2850", "3800", "2900", "2755", "2617", "2480"],
  ["Cemented knee with top Poly", "180", "3600", "3300", "4000", "3000", "2850", "2708", "2565"],
  ["Cemented with revision poly", "60", "3750", "3350", "4300", "3000", "2858", "2708", "2565"],
  ["Press fit knee", "95", "4200", "3915", "4400", "3400", "3240", "3080", "2907"],
]

function rowsFor(headers: string[], data: string[][]): Record<string, string>[] {
  return data.map((vals) => {
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = vals[i] ?? ""
    })
    return row
  })
}

/** Exactly getVendorBenchmarks' row mapping — NULL reads back as 0. */
function toBenchmarkRow(b: {
  vendorItemNo: string
  description: string | null
  nationalAvgPrice: unknown
  percentile25: unknown
  percentile50: unknown
  minPrice: unknown
  currentPrice: unknown
  annualUnits: number | null
}) {
  return {
    productName: b.description ?? b.vendorItemNo,
    itemNumber: b.vendorItemNo,
    nationalAvgPrice: Number(b.nationalAvgPrice ?? 0),
    percentile25: Number(b.percentile25 ?? 0),
    percentile50: Number(b.percentile50 ?? 0),
    minPrice: Number(b.minPrice ?? 0),
    currentPrice: Number(b.currentPrice ?? 0),
    annualUnits: Number(b.annualUnits ?? 0),
  }
}

d("benchmark currentPrice / annualUnits round trip (real Postgres)", () => {
  beforeAll(async () => {
    ctx = await setupTestDb()
    pool = new Pool({ connectionString: ctx.databaseUrl })
    const adapter = new PrismaPg(pool)
    prisma = new PrismaClient({ adapter })
  }, 90_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    await pool?.end()
    if (ctx) await teardownTestDb(ctx)
  })

  it("survives parse → store → read → seed with the values the vendor typed", async () => {
    const vendor = await prisma.vendor.create({
      data: { name: "Round Trip Ortho", status: "active" },
    })
    const parsed = mapBenchmarkRows(HEADERS, rowsFor(HEADERS, WORKBOOK_ROWS))
    expect(parsed.items).toHaveLength(4)

    await prisma.productBenchmark.createMany({
      data: parsed.items.map((it) => ({
        ...it,
        dataDate: it.dataDate ? new Date(it.dataDate) : undefined,
        vendorId: vendor.id,
        source: "vendor_upload",
      })),
    })

    const stored = await prisma.productBenchmark.findMany({
      where: { vendorId: vendor.id },
      orderBy: { vendorItemNo: "asc" },
    })
    expect(stored).toHaveLength(4)

    const knee = stored.find((b) => b.vendorItemNo === "Cemented Knee")!
    // Decimal(12,2) and INTEGER must give the numbers back unchanged — a
    // Decimal read as a string or an object is the classic way these land in
    // the UI as "[object Object]" or NaN.
    const row = toBenchmarkRow(knee)
    expect(row.currentPrice).toBe(3800)
    expect(row.annualUnits).toBe(240)
    expect(row.nationalAvgPrice).toBe(3300)
    expect(row.minPrice).toBe(2850)

    // …and what the grid shows for it, with no price or usage file loaded.
    expect(seedConstructFromBenchmark(row)).toEqual({
      current: "3800",
      floor: "2850",
      target: "3300",
      annualVolume: "240",
    })
  })

  it("stores cents exactly — a Decimal read as a float would drift", async () => {
    const vendor = await prisma.vendor.create({
      data: { name: "Cents Ortho", status: "active" },
    })
    await prisma.productBenchmark.create({
      data: {
        vendorItemNo: "CENTS-1",
        vendorId: vendor.id,
        source: "vendor_upload",
        currentPrice: 3800.57,
        nationalAvgPrice: 3300.05,
        annualUnits: 1,
      },
    })
    const stored = await prisma.productBenchmark.findFirstOrThrow({
      where: { vendorItemNo: "CENTS-1" },
    })
    expect(Number(stored.currentPrice)).toBe(3800.57)
    expect(Number(stored.nationalAvgPrice)).toBe(3300.05)
  })

  it("REJECTS an out-of-range units value — which is why the reader bounds them", async () => {
    // This is the failure the bound exists to prevent. In the import path the
    // insert is a single transaction over the whole file, so one junk cell
    // (e.g. a "Units" column holding dollar spend) took every row down with
    // it. Asserted against real Postgres so the bound can never be "cleaned
    // up" as unnecessary.
    const vendor = await prisma.vendor.create({
      data: { name: "Overflow Ortho", status: "active" },
    })
    await expect(
      prisma.productBenchmark.create({
        data: {
          vendorItemNo: "OVERFLOW-1",
          vendorId: vendor.id,
          source: "vendor_upload",
          annualUnits: 3_900_000_000,
        },
      }),
    ).rejects.toThrow()

    // The reader turns that same cell into "not supplied", so the row imports.
    const headers = ["Item Number", "National Avg Price", "Units"]
    const { items, outOfRange } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["OVERFLOW-1", "3300", "3900000000"]]),
    )
    expect(outOfRange).toBe(1)
    const safe = await prisma.productBenchmark.create({
      data: {
        ...items[0]!,
        dataDate: undefined,
        vendorId: vendor.id,
        source: "vendor_upload",
      },
    })
    expect(safe.annualUnits).toBeNull()
    expect(Number(safe.nationalAvgPrice)).toBe(3300)
  })

  it("leaves the columns NULL for a market-only file, and the cells blank", async () => {
    // Every vendor whose benchmark file has no current-price or units column
    // must be unaffected by the new columns.
    const vendor = await prisma.vendor.create({
      data: { name: "Market Only Ortho", status: "active" },
    })
    const headers = ["Item Number", "National Avg Price", "P25"]
    const { items } = mapBenchmarkRows(
      headers,
      rowsFor(headers, [["MKT-1", "3300", "3100"]]),
    )
    const stored = await prisma.productBenchmark.create({
      data: {
        ...items[0]!,
        dataDate: undefined,
        vendorId: vendor.id,
        source: "vendor_upload",
      },
    })
    expect(stored.currentPrice).toBeNull()
    expect(stored.annualUnits).toBeNull()

    const seeded = seedConstructFromBenchmark(toBenchmarkRow(stored))
    expect(seeded.current).toBe("")
    expect(seeded.annualVolume).toBe("")
    expect(seeded.floor).toBe("3100") // P25, since there is no Min column
    expect(seeded.target).toBe("3300")
  })
})
