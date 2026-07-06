/**
 * Tenant isolation for the benchmark READ path (security audit 2026-07-05).
 *
 * Since 2026-06-12 `importVendorBenchmarks` writes vendor-PRIVATE rows
 * (`source: "vendor_upload"`, `vendorId: <that vendor>`) into ProductBenchmark,
 * so `getBenchmarks` / `getBenchmark` may no longer return the whole table to
 * any logged-in user. National rows (`vendorId: null`) are readable by
 * everyone; a vendor additionally reads its OWN uploads; a facility/admin
 * caller sees national rows only. We assert the WHERE carries that scope.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  benchmarkFindMany: vi.fn(),
  benchmarkCount: vi.fn(),
  benchmarkFindFirstOrThrow: vi.fn(),
  memberFindFirst: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    productBenchmark: {
      findMany: mocks.benchmarkFindMany,
      count: mocks.benchmarkCount,
      findFirstOrThrow: mocks.benchmarkFindFirstOrThrow,
    },
    member: { findFirst: mocks.memberFindFirst },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireAuth: vi.fn(async () => ({ user: { id: "u-1" } })),
}))

import { getBenchmarks, getBenchmark } from "@/lib/actions/benchmarks"

type WhereShape = { AND?: unknown[]; OR?: Array<{ vendorId: string | null }> }

function tenantOrOf(where: WhereShape): Array<{ vendorId: string | null }> {
  // getBenchmarks nests the tenant scope as the first AND clause; getBenchmark
  // puts the OR at the top level.
  const first = where.AND?.[0] as { OR?: Array<{ vendorId: string | null }> }
  return (first?.OR ?? where.OR ?? []) as Array<{ vendorId: string | null }>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.benchmarkFindMany.mockResolvedValue([])
  mocks.benchmarkCount.mockResolvedValue(0)
  mocks.benchmarkFindFirstOrThrow.mockResolvedValue({ id: "b-1", vendorId: null })
})

describe("getBenchmarks — tenant scope", () => {
  it("a vendor caller reads national rows + its OWN uploads only", async () => {
    mocks.memberFindFirst.mockResolvedValue({
      organization: { vendor: { id: "vend-1" } },
    })
    await getBenchmarks({ page: 1, pageSize: 25 })
    const where = mocks.benchmarkFindMany.mock.calls[0]![0].where as WhereShape
    const or = tenantOrOf(where)
    expect(or).toEqual(
      expect.arrayContaining([{ vendorId: null }, { vendorId: "vend-1" }]),
    )
    // Never an unscoped read.
    expect(or.length).toBe(2)
  })

  it("a facility/admin caller (no vendor) reads national rows ONLY", async () => {
    mocks.memberFindFirst.mockResolvedValue({
      organization: { vendor: null },
    })
    await getBenchmarks({ page: 1, pageSize: 25 })
    const where = mocks.benchmarkFindMany.mock.calls[0]![0].where as WhereShape
    expect(tenantOrOf(where)).toEqual([{ vendorId: null }])
  })
})

describe("getBenchmark(id) — tenant scope", () => {
  it("scopes the single-row read to national + own-vendor", async () => {
    mocks.memberFindFirst.mockResolvedValue({
      organization: { vendor: { id: "vend-1" } },
    })
    await getBenchmark("b-1")
    const where = mocks.benchmarkFindFirstOrThrow.mock.calls[0]![0]
      .where as WhereShape & { id: string }
    expect(where.id).toBe("b-1")
    expect(tenantOrOf(where)).toEqual(
      expect.arrayContaining([{ vendorId: null }, { vendorId: "vend-1" }]),
    )
  })

  it("a facility caller cannot read a vendor-private row by id", async () => {
    mocks.memberFindFirst.mockResolvedValue({ organization: { vendor: null } })
    await getBenchmark("b-1")
    const where = mocks.benchmarkFindFirstOrThrow.mock.calls[0]![0]
      .where as WhereShape
    // Only national rows in scope → a vendor_upload id findFirst-throws.
    expect(tenantOrOf(where)).toEqual([{ vendorId: null }])
  })
})
