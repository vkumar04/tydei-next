"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import { z } from "zod"
import { serialize } from "@/lib/serialize"

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
  sampleSize: z.number().optional(),
  source: z.string().default("national_benchmark"),
})

type BenchmarkFilters = z.infer<typeof benchmarkFiltersSchema>
type CreateBenchmarkInput = z.infer<typeof createBenchmarkSchema>

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

export async function createBenchmark(input: CreateBenchmarkInput) {
  await requireAuth()
  const data = createBenchmarkSchema.parse(input)
  const benchmark = await prisma.productBenchmark.create({ data })
  return serialize(benchmark)
}

// ─── Update Benchmark ───────────────────────────────────────────

export async function updateBenchmark(
  id: string,
  input: Partial<CreateBenchmarkInput>
) {
  await requireAuth()
  const benchmark = await prisma.productBenchmark.update({ where: { id }, data: input })
  return serialize(benchmark)
}

// ─── Delete Benchmark ───────────────────────────────────────────

export async function deleteBenchmark(id: string) {
  await requireAuth()
  const benchmark = await prisma.productBenchmark.delete({ where: { id } })
  return serialize(benchmark)
}

// ─── Bulk Import Benchmarks ─────────────────────────────────────

export async function bulkImportBenchmarks(items: CreateBenchmarkInput[]) {
  await requireAuth()
  const validated = items.map((item) => createBenchmarkSchema.parse(item))
  const result = await prisma.productBenchmark.createMany({ data: validated, skipDuplicates: true })
  return serialize(result)
}
