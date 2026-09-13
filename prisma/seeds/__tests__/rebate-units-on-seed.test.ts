import { describe, it, expect, vi, beforeEach } from "vitest"

const { recomputeMock } = vi.hoisted(() => ({
  recomputeMock: vi.fn(),
}))

vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: (...args: unknown[]) => recomputeMock(...args),
}))

import type { PrismaClient } from "@/lib/generated/prisma/client"
import { seedCOGForContracts } from "../cog-for-contracts"

type RebateRow = {
  contractId: string
  rebateEarned: number
  rebateCollected: number
  collectionDate: Date | null
}

function makeFakePrisma(contracts: unknown[]) {
  const rebates: RebateRow[] = []
  const periods: Array<{ contractId: string; totalSpend: number }> = []
  const prisma = {
    cOGRecord: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
    },
    contract: {
      findMany: vi.fn().mockResolvedValue(contracts),
    },
    contractPeriod: {
      create: vi.fn(async ({ data }: { data: { contractId: string; totalSpend: number } }) => {
        periods.push({ contractId: data.contractId, totalSpend: data.totalSpend })
        return { id: `p-${periods.length}`, ...data }
      }),
    },
    rebate: {
      create: vi.fn(async ({ data }: { data: RebateRow }) => {
        rebates.push(data)
        return { id: `r-${rebates.length}`, ...data }
      }),
    },
  }
  return { prisma: prisma as unknown as PrismaClient, rebates, periods }
}

function contract(id: string, tiers: Array<{ tierNumber: number; spendMin: number; rebateValue: number; rebateType: string }>) {
  return {
    id,
    vendorId: "v-stryker",
    vendorName: "Stryker",
    vendor: { id: "v-stryker", name: "Stryker" },
    contractType: "rebate",
    facilityId: "fac-LS",
    effectiveDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 240),
    expirationDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 120),
    contractFacilities: [],
    terms: [{ tiers }],
  }
}

beforeEach(() => {
  recomputeMock.mockReset()
  recomputeMock.mockResolvedValue({})
})

describe("seedCOGForContracts — rebate rows use canonical tier units", () => {
  it("a fixed_rebate tier accrues its dollar amount, not amount × spend", async () => {
    const { prisma, rebates } = makeFakePrisma([
      contract("c-fixed", [
        { tierNumber: 1, spendMin: 0, rebateValue: 7500, rebateType: "fixed_rebate" },
        { tierNumber: 2, spendMin: 500000, rebateValue: 12500, rebateType: "fixed_rebate" },
      ]),
    ])

    await seedCOGForContracts(prisma)

    const earned = rebates.reduce((s, r) => s + r.rebateEarned, 0)
    expect(earned).toBe(7500)
    for (const r of rebates) expect(r.rebateEarned).toBeLessThanOrEqual(7500)
  })

  it("a percent_of_spend tier accrues rate × spend across the term", async () => {
    const { prisma, rebates, periods } = makeFakePrisma([
      contract("c-pct", [
        { tierNumber: 1, spendMin: 0, rebateValue: 0.02, rebateType: "percent_of_spend" },
      ]),
    ])

    await seedCOGForContracts(prisma)

    const spend = periods.reduce((s, p) => s + p.totalSpend, 0)
    const earned = rebates.reduce((s, r) => s + r.rebateEarned, 0)
    expect(spend).toBeGreaterThan(0)
    expect(earned).toBeCloseTo(spend * 0.02, 0)
  })

  it("every row with a collected amount carries a collectionDate", async () => {
    const { prisma, rebates } = makeFakePrisma([
      contract("c-pct", [
        { tierNumber: 1, spendMin: 0, rebateValue: 0.03, rebateType: "percent_of_spend" },
      ]),
    ])

    await seedCOGForContracts(prisma)

    expect(rebates.length).toBeGreaterThan(0)
    for (const r of rebates) {
      if (r.rebateCollected > 0) expect(r.collectionDate).toBeInstanceOf(Date)
    }
  })
})
