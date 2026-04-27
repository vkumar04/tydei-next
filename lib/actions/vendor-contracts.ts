"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import type { ContractStatus, Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"

// ─── Vendor Contracts List ──────────────────────────────────────

export async function getVendorContracts(input: {
  vendorId?: string
  status?: ContractStatus | "all"
  search?: string
  page?: number
  pageSize?: number
}) {
  const { vendor } = await requireVendor()
  const { status, search, page = 1, pageSize = 20 } = input

  const conditions: Prisma.ContractWhereInput[] = [{ vendorId: vendor.id }]

  if (status && status !== "all") conditions.push({ status })
  if (search) {
    conditions.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { contractNumber: { contains: search, mode: "insensitive" } },
        { facility: { name: { contains: search, mode: "insensitive" } } },
      ],
    })
  }

  const where: Prisma.ContractWhereInput = { AND: conditions }

  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: {
        facility: { select: { id: true, name: true } },
        productCategory: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contract.count({ where }),
  ])

  return serialize({ contracts, total })
}

// ─── Vendor Contract Detail ─────────────────────────────────────

export async function getVendorContractDetail(id: string, _vendorId?: string) {
  const { vendor } = await requireVendor()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id, vendorId: vendor.id },
    include: {
      vendor: { select: { id: true, name: true, logoUrl: true } },
      facility: { select: { id: true, name: true } },
      productCategory: { select: { id: true, name: true } },
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      documents: { orderBy: { uploadDate: "desc" } },
      // `periods` is intentionally a recent-N slice for the ledger
      // tab; lifetime totals must come from `lifetimeTotals` below
      // (the prior code reduced over the truncated 4-row slice and
      // silently under-reported lifetime numbers — Charles audit
      // round-1 vendor C4).
      periods: { orderBy: { periodEnd: "desc" }, take: 4 },
      changeProposals: { orderBy: { submittedAt: "desc" } },
    },
  })

  // Charles audit round-1 vendor C4 + round-2 + round-3: lifetime
  // totals come from canonical helpers per the CLAUDE.md invariants
  // table. Rebate metrics come from sumEarnedRebatesLifetime +
  // sumCollectedRebates over the Rebate rows — same source the
  // facility surfaces use, no drift.
  //
  // Charles 2026-04-26 (Bug 3): Spend was being read from
  // `ContractPeriod._sum(totalSpend)` — but ContractPeriod is sparse
  // on prod (Stryker at Lighthouse has 0 period rows despite $1.7M+
  // of categorized COG), so the contract detail page rendered
  // "Spend to Date $0". Cascade now mirrors `getContract`:
  //   1. Prefer ContractPeriod._sum(totalSpend) when populated
  //      (persisted rollup is the canonical spend source when present).
  //   2. Fall back to cOGRecord.extendedPrice scoped to {contractId}.
  // CLAUDE.md hard rule: never use ContractPeriod as the SOLE source
  // of vendor spend.
  const [spendAgg, cogAgg, rebateRows] = await Promise.all([
    prisma.contractPeriod.aggregate({
      where: { contractId: id },
      _sum: { totalSpend: true },
    }),
    prisma.cOGRecord.aggregate({
      where: { contractId: id, vendorId: vendor.id },
      _sum: { extendedPrice: true },
    }),
    prisma.rebate.findMany({
      where: { contractId: id },
      select: {
        id: true,
        rebateEarned: true,
        rebateCollected: true,
        payPeriodStart: true,
        payPeriodEnd: true,
        collectionDate: true,
        notes: true,
        // tierAchieved lives on ContractPeriod, not Rebate — pull it
        // through the relation so the vendor-overview Tier column has
        // a value to render. Pre-fix this was selected as
        // `tierAchieved: true` directly on Rebate, which the
        // prisma-select-schema-scanner rightly flagged as a runtime
        // bug (Unknown field).
        period: { select: { tierAchieved: true } },
      },
      orderBy: { payPeriodEnd: "desc" },
    }),
  ])
  const periodSpend = Number(spendAgg._sum.totalSpend ?? 0)
  const cogSpend = Number(cogAgg._sum.extendedPrice ?? 0)
  const lifetimeTotals = {
    spend: periodSpend > 0 ? periodSpend : cogSpend,
    rebateEarned: sumEarnedRebatesLifetime(rebateRows),
    rebateCollected: sumCollectedRebates(rebateRows),
  }

  return serialize({ ...contract, lifetimeTotals, rebates: rebateRows })
}
