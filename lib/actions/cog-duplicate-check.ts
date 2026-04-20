"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

/**
 * Duplicate-check key — full business-column set (Charles W1.W-A2).
 *
 * A row is considered a duplicate of an existing DB row only when every
 * compared column matches. Matches the in-memory rule in
 * `lib/cog/duplicate-detection.ts`.
 *
 * Callers that don't know a column (legacy mappers missing
 * `extendedPrice`, etc.) can omit it; the filter treats `undefined` as
 * "don't constrain this column". That preserves backward compat but
 * callers should pass as many columns as they have for the tightest
 * match.
 */
export interface DuplicateCheckKey {
  inventoryNumber: string
  vendorItemNo?: string | null
  transactionDate: string
  quantity?: number
  unitCost?: number
  extendedPrice?: number | null
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

function sameDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
}

export async function checkCOGDuplicates(input: {
  facilityId?: string
  keys: DuplicateCheckKey[]
}): Promise<DuplicateMatch[]> {
  const { facility } = await requireFacility()

  if (input.keys.length === 0) return []

  const allMatches: DuplicateMatch[] = []

  for (let i = 0; i < input.keys.length; i += DUPLICATE_BATCH_SIZE) {
    const batch = input.keys.slice(i, i + DUPLICATE_BATCH_SIZE)

    // First-pass SQL filter narrows candidates by the cheap/indexed
    // columns (facilityId + inventoryNumber + vendorItemNo). Full-key
    // comparison (date, quantity, unitCost, extendedPrice) happens in
    // memory after the fetch so we don't explode Postgres param count
    // with 6-column OR conditions.
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
        quantity: true,
        unitCost: true,
        extendedPrice: true,
        inventoryDescription: true,
        vendorName: true,
      },
      take: 2000,
    })

    // In-memory strict filter: every compared field must match.
    for (const key of batch) {
      const keyDate = new Date(key.transactionDate)
      for (const r of existing) {
        if (r.inventoryNumber !== key.inventoryNumber) continue
        if ((r.vendorItemNo ?? null) !== (key.vendorItemNo ?? null)) continue
        if (!sameDay(r.transactionDate, keyDate)) continue
        if (key.quantity !== undefined && r.quantity !== key.quantity) continue
        if (
          key.unitCost !== undefined &&
          Number(r.unitCost) !== key.unitCost
        ) {
          continue
        }
        if (key.extendedPrice !== undefined) {
          const rExt = r.extendedPrice === null ? null : Number(r.extendedPrice)
          if (rExt !== key.extendedPrice) continue
        }

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
    }

    if (allMatches.length >= 500) break
  }

  return serialize(allMatches.slice(0, 500))
}
