"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import type { ContractStatus, Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"

// ─── Vendor Contracts List ──────────────────────────────────────

export async function getVendorContracts(input: {
  vendorId: string
  status?: ContractStatus | "all"
  search?: string
  page?: number
  pageSize?: number
}) {
  await requireVendor()
  const { vendorId, status, search, page = 1, pageSize = 20 } = input

  const conditions: Prisma.ContractWhereInput[] = [{ vendorId }]

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

export async function getVendorContractDetail(id: string, vendorId: string) {
  await requireVendor()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id },
    include: {
      vendor: { select: { id: true, name: true, logoUrl: true } },
      facility: { select: { id: true, name: true } },
      productCategory: { select: { id: true, name: true } },
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      documents: { orderBy: { uploadDate: "desc" } },
      periods: { orderBy: { periodEnd: "desc" }, take: 4 },
    },
  })
  return serialize(contract)
}
