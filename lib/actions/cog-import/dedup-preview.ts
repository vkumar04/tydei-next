"use server"

/**
 * COG duplicate-preview action — subsystem 3 of the COG data rewrite.
 *
 * Dry-run duplicate detection: the client passes parsed-but-unsaved
 * import rows, this action fetches every existing COG row at the
 * caller's facility and feeds the combined set into the pure
 * `detectDuplicates` helper. The returned report is used to render
 * conflict groups in the import UI before the user commits to a
 * duplicate-resolution strategy (`skip` / `overwrite` / `keep_both`).
 *
 * No writes. Safe to call repeatedly.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  detectDuplicates,
  type COGRecordForDedup,
  type DuplicateDetectionReport,
} from "@/lib/cog/duplicate-detection"

export interface PreviewCOGImportDuplicatesInput {
  records: Array<{
    inventoryNumber: string
    vendorItemNo: string | null
    /** ISO-formatted date; parsed into a Date before dedup. */
    transactionDate: string
    unitCost: number
    quantity: number
    vendorName?: string | null
  }>
}

/**
 * Dry-run — detect duplicates across pending import rows + existing
 * facility COG rows, returns the duplicate report WITHOUT persisting
 * anything. UI uses this to show the user the conflict groups before
 * they pick a resolution.
 */
export async function previewCOGImportDuplicates(
  input: PreviewCOGImportDuplicatesInput,
): Promise<DuplicateDetectionReport> {
  const { facility } = await requireFacility()

  const existing = await prisma.cOGRecord.findMany({
    where: { facilityId: facility.id },
    select: {
      id: true,
      inventoryNumber: true,
      vendorItemNo: true,
      transactionDate: true,
      unitCost: true,
      quantity: true,
      vendorName: true,
    },
  })

  const combined: COGRecordForDedup[] = [
    ...existing.map((r) => ({
      id: r.id,
      inventoryNumber: r.inventoryNumber,
      vendorItemNo: r.vendorItemNo,
      transactionDate: r.transactionDate,
      unitCost: Number(r.unitCost),
      quantity: r.quantity,
      vendorName: r.vendorName,
    })),
    ...input.records.map((r) => ({
      inventoryNumber: r.inventoryNumber,
      vendorItemNo: r.vendorItemNo,
      transactionDate: new Date(r.transactionDate),
      unitCost: r.unitCost,
      quantity: r.quantity,
      vendorName: r.vendorName ?? null,
    })),
  ]

  return detectDuplicates(combined)
}
