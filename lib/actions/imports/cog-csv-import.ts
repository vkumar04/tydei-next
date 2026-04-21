"use server"

/**
 * COG records CSV ingest.
 *
 * Extracted from lib/actions/mass-upload.ts during F16 tech debt split.
 * Delegates heavy lifting to lib/actions/cog-import::bulkImportCOGRecords
 * (which owns the vendor find-or-create + dedup pipeline).
 */
import { revalidatePath } from "next/cache"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { bulkImportCOGRecords } from "@/lib/actions/cog-import"
import { parseCSV, parseMoney, parseDate, mapColumnsWithAI, get } from "./shared"

export async function ingestCOGRecordsCSV(
  csvText: string,
  fileName?: string,
): Promise<{
  imported: number
  skipped: number
  errors: number
  matched?: number
  unmatched?: number
  onContractRate?: number
}> {
  const rows = parseCSV(csvText)
  if (rows.length === 0)
    return {
      imported: 0,
      skipped: 0,
      errors: 0,
      matched: 0,
      unmatched: 0,
      onContractRate: 0,
    }

  const headers = Object.keys(rows[0])
  const mapping = await mapColumnsWithAI(
    headers,
    [
      { key: "vendorName", label: "Vendor / Supplier Name", required: true },
      {
        key: "transactionDate",
        label: "Date Ordered / Transaction Date",
        required: true,
      },
      {
        key: "description",
        label: "Product Name / Item Description",
        required: false,
      },
      {
        key: "refNumber",
        label: "Catalog / Product Reference / Vendor Item Number",
        required: false,
      },
      { key: "quantity", label: "Quantity Ordered", required: false },
      { key: "unitCost", label: "Unit Cost / Unit Price", required: false },
      {
        key: "extended",
        label: "Extended Cost / Total Line Cost",
        required: false,
      },
      { key: "poNumber", label: "Purchase Order Number", required: false },
      // Charles iMessage 2026-04-20 N6: "The multiplier is not in the
      // mapping screens and everything is x1 when I know on the COGs
      // many are not just x1." When mapped, the parser multiplies the
      // extended-price computation by this value so the COG table's
      // Multiplier column (which computes extended / (unitCost × qty))
      // renders the real multiplier. No schema change needed; lives in
      // extendedPrice.
      {
        key: "multiplier",
        label: "Multiplier / Case Pack / Units per Line",
        required: false,
      },
    ],
    rows,
  )

  const records = rows
    .map((row) => {
      const vendorName = get(row, mapping, "vendorName")
      const transactionDate = parseDate(get(row, mapping, "transactionDate"))
      if (!vendorName || !transactionDate) return null

      const description = get(row, mapping, "description")
      const refNumber = get(row, mapping, "refNumber")
      const quantity = parseInt(get(row, mapping, "quantity") || "1", 10) || 1
      const unitCost = parseMoney(get(row, mapping, "unitCost"))
      // Charles N6: apply multiplier when the source file has one. If
      // the file ALSO has an explicit Extended column, the explicit
      // value wins (already a multiplier-inclusive total from the
      // source). Otherwise extended = unitCost × quantity × multiplier.
      const rawMultiplier = get(row, mapping, "multiplier")
      const multiplier = rawMultiplier
        ? parseFloat(rawMultiplier.replace(/[^0-9.]/g, "")) || 1
        : 1
      const explicitExtended = parseMoney(get(row, mapping, "extended"))
      const extended =
        explicitExtended > 0
          ? explicitExtended
          : unitCost * quantity * multiplier

      const poNumber = get(row, mapping, "poNumber") || undefined

      return {
        vendorName,
        inventoryNumber: refNumber || description || vendorName || "Unknown",
        inventoryDescription: description || refNumber || "Unknown item",
        vendorItemNo: refNumber || undefined,
        poNumber,
        unitCost,
        extendedPrice: extended,
        quantity,
        transactionDate: transactionDate.toISOString(),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  if (records.length === 0) {
    return {
      imported: 0,
      skipped: rows.length,
      errors: 0,
      matched: 0,
      unmatched: 0,
      onContractRate: 0,
    }
  }

  const session = await requireFacility()
  const result = await bulkImportCOGRecords({
    facilityId: session.facility.id,
    records,
    duplicateStrategy: "skip",
  })
  await logAudit({
    userId: session.user.id,
    action: "cog.imported_via_mass_upload",
    entityType: "cog_record",
    metadata: { ...result, fileName: fileName ?? null, rowCount: rows.length },
  })
  revalidatePath("/dashboard/cog-data")
  return result
}
