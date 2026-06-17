"use server"

import { prisma } from "@/lib/db"
import { requireAuth, requireAdmin, requireVendor } from "@/lib/actions/auth"
import { z } from "zod"
import { serialize } from "@/lib/serialize"
import { normalizeSku } from "@/lib/contracts/normalize-sku"

const benchmarkFiltersSchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  page: z.number().default(1),
  pageSize: z.number().default(25),
})

const createBenchmarkSchema = z.object({
  vendorId: z.string().optional(),
  vendorItemNo: z.string().min(1),
  description: z.string().optional(),
  category: z.string().optional(),
  nationalAvgPrice: z.number().optional(),
  percentile25: z.number().optional(),
  percentile50: z.number().optional(),
  percentile75: z.number().optional(),
  minPrice: z.number().optional(),
  maxPrice: z.number().optional(),
  sampleSize: z.number().int().optional(),
  // Benchmarks-tab import (Vick 2026-06-12): the file reader sends an ISO
  // date string; tolerate Date too. Unparseable values drop to undefined
  // rather than rejecting the whole batch.
  dataDate: z
    .union([z.string(), z.date()])
    .optional()
    .transform((v) => {
      if (v == null) return undefined
      const d = v instanceof Date ? v : new Date(v)
      return Number.isNaN(d.getTime()) ? undefined : d
    }),
  source: z.string().default("national_benchmark"),
})

type BenchmarkFilters = z.infer<typeof benchmarkFiltersSchema>
type CreateBenchmarkInput = z.input<typeof createBenchmarkSchema>

// What the vendor Benchmarks-tab import sends per row — vendorId/source are
// NOT caller-controlled; importVendorBenchmarks stamps them server-side.
export type VendorBenchmarkImportInput = Omit<
  CreateBenchmarkInput,
  "vendorId" | "source"
>

// ─── List Benchmarks ────────────────────────────────────────────

export async function getBenchmarks(input: BenchmarkFilters) {
  await requireAuth()
  const filters = benchmarkFiltersSchema.parse(input)

  const where = {
    ...(filters.category && { category: filters.category }),
    ...(filters.search && {
      OR: [
        { description: { contains: filters.search, mode: "insensitive" as const } },
        { vendorItemNo: { contains: filters.search, mode: "insensitive" as const } },
      ],
    }),
  }

  const [benchmarks, total] = await Promise.all([
    prisma.productBenchmark.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.productBenchmark.count({ where }),
  ])

  return serialize({ benchmarks, total, page: filters.page, pageSize: filters.pageSize })
}

// ─── Get Single Benchmark ───────────────────────────────────────

export async function getBenchmark(id: string) {
  await requireAuth()
  const benchmark = await prisma.productBenchmark.findUniqueOrThrow({ where: { id } })
  return serialize(benchmark)
}

// ─── Create Benchmark ───────────────────────────────────────────

// ProductBenchmark is a GLOBAL, cross-tenant reference table (national
// pricing) that feeds every facility's savings/benchmark surfaces. These
// admin-supplied mutations let the caller set `vendorId` and aren't tenant-
// scoped, so they must be requireAdmin — not requireAuth (which let ANY
// logged-in user overwrite/delete shared benchmark rows). 2026-06-17
// security fix. The vendor self-service path is `importVendorBenchmarks`
// (requireVendor, stamps the session vendorId).
export async function createBenchmark(input: CreateBenchmarkInput) {
  await requireAdmin()
  const data = createBenchmarkSchema.parse(input)
  const benchmark = await prisma.productBenchmark.create({ data })
  return serialize(benchmark)
}

// ─── Update Benchmark ───────────────────────────────────────────

export async function updateBenchmark(
  id: string,
  input: Partial<CreateBenchmarkInput>
) {
  await requireAdmin()
  const data = createBenchmarkSchema.partial().parse(input)
  const benchmark = await prisma.productBenchmark.update({ where: { id }, data })
  return serialize(benchmark)
}

// ─── Delete Benchmark ───────────────────────────────────────────

export async function deleteBenchmark(id: string) {
  await requireAdmin()
  const benchmark = await prisma.productBenchmark.delete({ where: { id } })
  return serialize(benchmark)
}

// ─── Bulk Import Benchmarks ─────────────────────────────────────

export async function bulkImportBenchmarks(items: CreateBenchmarkInput[]) {
  await requireAdmin()
  const validated = items.map((item) => createBenchmarkSchema.parse(item))
  const result = await prisma.productBenchmark.createMany({ data: validated, skipDuplicates: true })
  return serialize(result)
}

// ─── Vendor-portal Benchmark Import ─────────────────────────────
// "Need to be able to add data for the benchmarks" (Vick 2026-06-12):
// the Benchmarks tab's CSV/XLSX upload lands here. Unlike
// bulkImportBenchmarks (admin-ish, caller supplies vendorId), this entry
// point is vendor-scoped: requireVendor() and every row is stamped with
// the SESSION vendor's id + source "vendor_upload" — a vendor can never
// write rows tagged to another vendor.

const VENDOR_BENCHMARK_BATCH_SIZE = 500
const VENDOR_UPLOAD_SOURCE = "vendor_upload"

export async function importVendorBenchmarks(
  items: VendorBenchmarkImportInput[],
) {
  const { vendor } = await requireVendor()
  try {
    if (items.length === 0) return serialize({ inserted: 0, replaced: 0 })

    // Stamp AFTER the caller's fields so a forged vendorId/source in the
    // payload is always overwritten, then validate.
    const validated = items.map((item) =>
      createBenchmarkSchema.parse({
        ...item,
        vendorId: vendor.id,
        source: VENDOR_UPLOAD_SOURCE,
      }),
    )

    // Within-batch dedupe: last row wins per normalized SKU (re-uploading a
    // corrected file with a duplicate row should keep the later correction).
    // SKU-class rule (project_sku_and_cadence_gotchas): compare via
    // normalizeSku, never raw ===.
    const bySku = new Map<string, (typeof validated)[number]>()
    for (const row of validated) {
      const key = normalizeSku(row.vendorItemNo)
      if (key) bySku.set(key, row)
    }
    const deduped = [...bySku.values()]
    const incomingSkus = new Set(bySku.keys())

    // Replace semantics: ProductBenchmark has no unique constraint on
    // (vendorId, vendorItemNo), so a blind createMany would duplicate rows
    // on every re-import. Delete this vendor's PRIOR vendor_upload rows for
    // the SKUs in the batch (matched via normalizeSku in JS — Prisma `in`
    // is case/whitespace-sensitive), then insert. National-benchmark rows
    // and other vendors' rows are untouched.
    const existing = await prisma.productBenchmark.findMany({
      where: { vendorId: vendor.id, source: VENDOR_UPLOAD_SOURCE },
      select: { id: true, vendorItemNo: true },
    })
    const staleIds = existing
      .filter((r) => incomingSkus.has(normalizeSku(r.vendorItemNo)))
      .map((r) => r.id)

    // Delete + insert atomically so a mid-import failure can't leave the
    // vendor's prior rows deleted with nothing inserted in their place.
    const inserted = await prisma.$transaction(
      async (tx) => {
        if (staleIds.length > 0) {
          await tx.productBenchmark.deleteMany({
            where: { id: { in: staleIds } },
          })
        }
        // Chunked insert (prod-volume lesson: never unbounded single calls).
        let count = 0
        for (let i = 0; i < deduped.length; i += VENDOR_BENCHMARK_BATCH_SIZE) {
          const chunk = deduped.slice(i, i + VENDOR_BENCHMARK_BATCH_SIZE)
          const result = await tx.productBenchmark.createMany({ data: chunk })
          count += result.count
        }
        return count
      },
      // Vick 2026-06-13 "Adding price file here not working": Prisma's
      // default interactive-transaction timeout is 5s — a 10k-row price
      // file (≈21 createMany batches against Railway Postgres) aborts
      // mid-flight with P2028 and the import fails. Same prod-volume
      // lesson + numbers as importContractPricing (pricing-files.ts:603).
      { maxWait: 10_000, timeout: 120_000 },
    )

    return serialize({ inserted, replaced: staleIds.length })
  } catch (err) {
    // Error-path convention: log with scope before re-throwing so prod
    // digests are debuggable; surface a named, user-readable message.
    console.error("[importVendorBenchmarks]", err, { vendorId: vendor.id })
    if (err instanceof z.ZodError) {
      const first = err.issues[0]
      throw new Error(
        `Benchmark import rejected an invalid row: ${first?.path.join(".")}: ${first?.message}`,
      )
    }
    throw new Error(
      `Benchmark import failed: ${err instanceof Error ? err.message : "unknown error"}`,
    )
  }
}
