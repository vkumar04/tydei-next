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

// Postgres caps `IN (...)` parameters at 32,767; staying under 5k keeps
// the planner happy and leaves headroom for other WHERE params.
const INVENTORY_IN_CHUNK = 5_000
// Charles 2026-04-25: a hard 500-row cap on the result set was making
// the duplicate-check step claim "Found 500 duplicates" on imports that
// actually had 21k+ overlaps. Server still skipped them all on import,
// so the data was safe — but the UI was lying. Bumped to 50k as a
// reasonable safety ceiling; pathological re-imports beyond that point
// hit a "+more" indicator in the UI rather than truncating silently.
const MAX_REPORTED_DUPLICATES = 50_000

function sameDay(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
}

export async function checkCOGDuplicates(input: {
  facilityId?: string
  keys: DuplicateCheckKey[]
}): Promise<DuplicateMatch[]> {
  const { facility } = await requireFacility()

  if (input.keys.length === 0) return []

  // Bug 2026-05-18 (Vick "can't load XLS anymore"): prior impl ran one
  // 500-way OR query per batch of 500 keys (~99 queries for a 49k
  // import), each enumerating `facilityId + inventoryNumber + vendorItemNo`
  // per clause. Postgres handles the SQL but planner pathology + serial
  // round-trips blew past the Railway 300s function ceiling and surfaced
  // as the generic "Server Components render" overlay.
  //
  // Switch to one indexed `IN (...)` lookup per chunk of unique
  // inventoryNumbers (chunked at 5k to stay well under Postgres' 32,767
  // param ceiling), then do the full-key match in memory.
  const uniqueInventoryNumbers = Array.from(
    new Set(input.keys.map((k) => k.inventoryNumber).filter(Boolean)),
  )
  if (uniqueInventoryNumbers.length === 0) return []

  // Group keys by inventoryNumber for O(1) candidate match in the loop.
  const keysByInventory = new Map<string, DuplicateCheckKey[]>()
  for (const k of input.keys) {
    const list = keysByInventory.get(k.inventoryNumber) ?? []
    list.push(k)
    keysByInventory.set(k.inventoryNumber, list)
  }

  const allMatches: DuplicateMatch[] = []

  for (let i = 0; i < uniqueInventoryNumbers.length; i += INVENTORY_IN_CHUNK) {
    const chunk = uniqueInventoryNumbers.slice(i, i + INVENTORY_IN_CHUNK)

    const existing = await prisma.cOGRecord.findMany({
      where: {
        facilityId: facility.id,
        inventoryNumber: { in: chunk },
      },
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
    })

    for (const r of existing) {
      const candidates = keysByInventory.get(r.inventoryNumber)
      if (!candidates) continue
      for (const key of candidates) {
        if ((r.vendorItemNo ?? null) !== (key.vendorItemNo ?? null)) continue
        const keyDate = new Date(key.transactionDate)
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

        if (allMatches.length >= MAX_REPORTED_DUPLICATES) break
      }
      if (allMatches.length >= MAX_REPORTED_DUPLICATES) break
    }

    if (allMatches.length >= MAX_REPORTED_DUPLICATES) break
  }

  return serialize(allMatches.slice(0, MAX_REPORTED_DUPLICATES))
}
