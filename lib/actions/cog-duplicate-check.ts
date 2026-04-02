"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

export interface DuplicateCheckKey {
  inventoryNumber: string
  vendorItemNo?: string | null
  transactionDate: string
}

export interface DuplicateMatch {
  inventoryNumber: string
  vendorItemNo: string | null
  transactionDate: string
  existingId: string
  existingDescription: string | null
  existingVendor: string | null
  existingUnitCost: number
}

const DUPLICATE_BATCH_SIZE = 500

export async function checkCOGDuplicates(input: {
  facilityId?: string
  keys: DuplicateCheckKey[]
}): Promise<DuplicateMatch[]> {
  const { facility } = await requireFacility()

  if (input.keys.length === 0) return []

  // Process keys in batches to avoid massive OR queries
  const allMatches: DuplicateMatch[] = []

  for (let i = 0; i < input.keys.length; i += DUPLICATE_BATCH_SIZE) {
    const batch = input.keys.slice(i, i + DUPLICATE_BATCH_SIZE)

    const orConditions = batch.map((key) => ({
      facilityId: facility.id,
      inventoryNumber: key.inventoryNumber,
      ...(key.vendorItemNo ? { vendorItemNo: key.vendorItemNo } : {}),
    }))

    const existing = await prisma.cOGRecord.findMany({
      where: { OR: orConditions },
      select: {
        id: true,
        inventoryNumber: true,
        vendorItemNo: true,
        transactionDate: true,
        inventoryDescription: true,
        vendorName: true,
        unitCost: true,
      },
      take: 500,
    })

    for (const r of existing) {
      allMatches.push({
        inventoryNumber: r.inventoryNumber,
        vendorItemNo: r.vendorItemNo,
        transactionDate:
          r.transactionDate instanceof Date
            ? r.transactionDate.toISOString()
            : String(r.transactionDate),
        existingId: r.id,
        existingDescription: r.inventoryDescription,
        existingVendor: r.vendorName,
        existingUnitCost: Number(r.unitCost),
      })
    }

    // Cap total matches to avoid huge responses
    if (allMatches.length >= 500) break
  }

  return serialize(allMatches.slice(0, 500))
}
