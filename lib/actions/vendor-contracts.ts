"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import type { ContractStatus, Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"

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

  // Charles audit round-1 vendor C4: aggregate the FULL period table
  // for lifetime totals so the vendor overview's Spend / Rebate
  // Earned don't truncate at 4 most-recent rows.
  // Charles audit round-2 vendor CONCERN 1: rebateCollected goes
  // through canonical sumCollectedRebates over the Rebate table
  // (not the period rollup), which enforces the
  // collectionDate != null invariant per the CLAUDE.md table.
  const [lifetimeAgg, rebateRows] = await Promise.all([
    prisma.contractPeriod.aggregate({
      where: { contractId: id },
      _sum: { totalSpend: true, rebateEarned: true },
    }),
    prisma.rebate.findMany({
      where: { contractId: id },
      select: { rebateCollected: true, collectionDate: true },
    }),
  ])
  const { sumCollectedRebates } = await import(
    "@/lib/contracts/rebate-collected-filter"
  )
  const lifetimeTotals = {
    spend: Number(lifetimeAgg._sum.totalSpend ?? 0),
    rebateEarned: Number(lifetimeAgg._sum.rebateEarned ?? 0),
    rebateCollected: sumCollectedRebates(rebateRows),
  }

  return serialize({ ...contract, lifetimeTotals })
}
