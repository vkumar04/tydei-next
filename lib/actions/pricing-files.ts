"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  pricingFiltersSchema,
  bulkImportPricingSchema,
  type PricingFilters,
  type BulkImportPricingInput,
} from "@/lib/validators/pricing-files"
import type { Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"

// ─── List Pricing Files ─────────────────────────────────────────

export async function getPricingFiles(input: PricingFilters) {
  const { facility } = await requireFacility()
  const filters = pricingFiltersSchema.parse(input)

  const conditions: Prisma.PricingFileWhereInput[] = [
    { facilityId: facility.id },
  ]

  if (filters.vendorId) conditions.push({ vendorId: filters.vendorId })

  const where: Prisma.PricingFileWhereInput = { AND: conditions }
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20

  const [files, total] = await Promise.all([
    prisma.pricingFile.findMany({
      where,
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.pricingFile.count({ where }),
  ])

  return serialize({ files, total })
}

// ─── Bulk Import Pricing File Entries ───────────────────────────

export async function bulkImportPricingFiles(input: BulkImportPricingInput) {
  const { facility } = await requireFacility()
  const data = bulkImportPricingSchema.parse(input)

  let imported = 0
  let errors = 0

  for (const record of data.records) {
    try {
      await prisma.pricingFile.create({
        data: {
          vendorId: data.vendorId,
          facilityId: facility.id,
          vendorItemNo: record.vendorItemNo,
          manufacturerNo: record.manufacturerNo,
          productDescription: record.productDescription,
          listPrice: record.listPrice,
          contractPrice: record.contractPrice,
          effectiveDate: new Date(record.effectiveDate),
          expirationDate: record.expirationDate
            ? new Date(record.expirationDate)
            : null,
          category: record.category,
          uom: record.uom,
        },
      })
      imported++
    } catch {
      errors++
    }
  }

  return { imported, errors }
}

// ─── Delete Pricing Files by Vendor ─────────────────────────────

export async function deletePricingFilesByVendor(
  vendorId: string,
  facilityId: string
) {
  await requireFacility()

  await prisma.pricingFile.deleteMany({
    where: { vendorId, facilityId },
  })
}

// ─── Import Contract Pricing (linked to a specific contract) ───

export interface ContractPricingItem {
  vendorItemNo: string
  description?: string
  category?: string
  unitPrice: number
  listPrice?: number
  uom?: string
  effectiveDate?: string
  expirationDate?: string
}

export async function importContractPricing(input: {
  contractId: string
  items: ContractPricingItem[]
}) {
  await requireFacility()

  if (input.items.length === 0) return { imported: 0 }

  const BATCH = 500
  let imported = 0

  for (let i = 0; i < input.items.length; i += BATCH) {
    const batch = input.items.slice(i, i + BATCH)
    const result = await prisma.contractPricing.createMany({
      data: batch.map((item) => ({
        contractId: input.contractId,
        vendorItemNo: item.vendorItemNo,
        description: item.description,
        category: item.category,
        unitPrice: item.unitPrice,
        listPrice: item.listPrice,
        uom: item.uom ?? "EA",
        effectiveDate: item.effectiveDate ? new Date(item.effectiveDate) : null,
        expirationDate: item.expirationDate ? new Date(item.expirationDate) : null,
      })),
    })
    imported += result.count
  }

  return { imported }
}
