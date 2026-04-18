"use server"

/**
 * Bulk COG import.
 *
 * Extracted from lib/actions/cog-records.ts during subsystem-9 tech
 * debt split. Vendor resolution goes through the shared resolver
 * (lib/vendors/resolve) so we never add a parallel vendor-match path.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  bulkImportSchema,
  type BulkImportInput,
} from "@/lib/validators/cog-records"
import { logAudit } from "@/lib/audit"
import { resolveVendorIdsBulk } from "@/lib/vendors/resolve"

const BATCH_SIZE = 500

export async function bulkImportCOGRecords(input: BulkImportInput) {
  const session = await requireFacility()
  const data = bulkImportSchema.parse(input)

  let imported = 0
  let skipped = 0
  let errors = 0

  // Auto-create Vendor rows for any vendorName that doesn't already match an
  // existing vendor. The shared resolver runs exact → alias → fuzzy, then
  // creates vendors for names that still don't match (e.g. distributors
  // not in our catalog). Without this, imported COG data "loses" its
  // vendors and the Vendors list goes stale.
  const unmatchedNames = data.records
    .filter((r) => !r.vendorId && r.vendorName && r.vendorName.trim())
    .map((r) => r.vendorName!.trim())
  const nameToId = await resolveVendorIdsBulk(unmatchedNames)

  const resolveVendorId = (record: (typeof data.records)[number]) => {
    if (record.vendorId) return record.vendorId
    if (record.vendorName) {
      const id = nameToId.get(record.vendorName.trim().toLowerCase())
      if (id) return id
    }
    return record.vendorId
  }

  const toCreateData = (record: (typeof data.records)[number]) => ({
    facilityId: session.facility.id,
    vendorId: resolveVendorId(record),
    vendorName: record.vendorName,
    inventoryNumber: record.inventoryNumber,
    inventoryDescription: record.inventoryDescription,
    vendorItemNo: record.vendorItemNo,
    manufacturerNo: record.manufacturerNo,
    poNumber: record.poNumber,
    unitCost: record.unitCost,
    // Calculate extendedPrice from unitCost * quantity when not provided
    extendedPrice: record.extendedPrice ?? (record.unitCost * (record.quantity ?? 1)),
    quantity: record.quantity,
    transactionDate: new Date(record.transactionDate),
    category: record.category,
    createdBy: session.user.id,
  })

  for (let i = 0; i < data.records.length; i += BATCH_SIZE) {
    const batch = data.records.slice(i, i + BATCH_SIZE)

    try {
      if (data.duplicateStrategy === "keep_both") {
        const result = await prisma.cOGRecord.createMany({
          data: batch.map(toCreateData),
        })
        imported += result.count
        continue
      }

      // skip / overwrite — batch-lookup existing records first
      const existing = await prisma.cOGRecord.findMany({
        where: {
          facilityId: session.facility.id,
          OR: batch.map((r) => ({
            AND: [
              { inventoryNumber: r.inventoryNumber },
              { transactionDate: new Date(r.transactionDate) },
              ...(r.vendorItemNo ? [{ vendorItemNo: r.vendorItemNo }] : []),
            ],
          })),
        },
        select: {
          id: true,
          inventoryNumber: true,
          transactionDate: true,
          vendorItemNo: true,
        },
      })

      const existingKey = (inv: string, date: string, vItem: string | null) =>
        `${inv}|${date}|${vItem ?? ""}`
      const existingMap = new Map(
        existing.map((e) => [
          existingKey(
            e.inventoryNumber,
            e.transactionDate.toISOString().slice(0, 10),
            e.vendorItemNo,
          ),
          e.id,
        ]),
      )

      const newRecords: (typeof batch) = []
      const toOverwrite: { id: string; record: (typeof batch)[number] }[] = []

      for (const record of batch) {
        const key = existingKey(
          record.inventoryNumber,
          record.transactionDate,
          record.vendorItemNo ?? null,
        )
        const existingId = existingMap.get(key)

        if (existingId) {
          if (data.duplicateStrategy === "skip") {
            skipped++
          } else {
            toOverwrite.push({ id: existingId, record })
          }
        } else {
          newRecords.push(record)
        }
      }

      // Batch-overwrite existing records via transaction
      if (toOverwrite.length > 0) {
        try {
          await prisma.$transaction(
            toOverwrite.map(({ id, record }) =>
              prisma.cOGRecord.update({
                where: { id },
                data: {
                  vendorId: resolveVendorId(record),
                  vendorName: record.vendorName,
                  inventoryDescription: record.inventoryDescription,
                  manufacturerNo: record.manufacturerNo,
                  unitCost: record.unitCost,
                  extendedPrice: record.extendedPrice,
                  quantity: record.quantity,
                  category: record.category,
                },
              }),
            ),
          )
          imported += toOverwrite.length
        } catch {
          errors += toOverwrite.length
        }
      }

      // Batch-create all new records at once
      if (newRecords.length > 0) {
        const result = await prisma.cOGRecord.createMany({
          data: newRecords.map(toCreateData),
        })
        imported += result.count
      }
    } catch {
      errors += batch.length
    }
  }

  await logAudit({
    userId: session.user.id,
    action: "cog.imported",
    entityType: "cogRecord",
    metadata: { imported, skipped, errors, totalRecords: data.records.length },
  })

  return { imported, skipped, errors }
}
