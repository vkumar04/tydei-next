"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

export interface PricingImportRow {
  id: string
  fileName: string
  uploadedAt: Date
  rowCount: number
  itemMatchCount: number | null
}

/**
 * Recent pricing-file imports for the current facility. Pricing-file imports
 * are stored in the unified `FileImport` model discriminated by
 * `fileType = "pricing"`.
 */
export async function getPricingImportHistory(
  limit = 20,
): Promise<PricingImportRow[]> {
  const { facility } = await requireFacility()

  const imports = await prisma.fileImport.findMany({
    where: { facilityId: facility.id, fileType: "pricing" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      fileName: true,
      createdAt: true,
      recordCount: true,
      matchedRecords: true,
    },
  })

  const rows: PricingImportRow[] = imports.map((i) => ({
    id: i.id,
    fileName: i.fileName,
    uploadedAt: i.createdAt,
    rowCount: i.recordCount ?? 0,
    itemMatchCount: i.matchedRecords ?? null,
  }))

  return serialize(rows)
}
