"use server"

/**
 * Pricing file ingest.
 *
 * Extracted from lib/actions/mass-upload.ts during F16 tech debt split.
 * Vendor resolution: filename hint (code → full name) → Manufacturer
 * column → Unknown fallback.
 */
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import {
  parseMoney,
  mapColumnsWithAI,
  get,
  findOrCreateVendorByName,
} from "./shared"

export async function ingestPricingFile(input: {
  rows: Record<string, string>[]
  fileName?: string
  vendorHint?: string | null
}): Promise<{ imported: number; failed: number; vendorUsed: string | null }> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  // Vendor resolution: filename hint first (match vendor.code + full name),
  // then Manufacturer column, then Unknown fallback.
  const hint = input.vendorHint ?? input.fileName ?? ""
  let vendorId: string | null = null

  if (hint) {
    const vendors = await prisma.vendor.findMany({
      select: { id: true, name: true, displayName: true, code: true },
    })
    const lowerHint = hint.toLowerCase()

    // Pass 1: match vendor.code (e.g. "ART" → Arthrex, "MDT" → Medtronic).
    for (const v of vendors) {
      if (!v.code) continue
      const code = v.code.toLowerCase()
      if (code.length >= 2 && lowerHint.includes(code)) {
        vendorId = v.id
        break
      }
    }

    // Pass 2: fallback to full-name token match.
    if (!vendorId) {
      const SKIP_TOKENS = new Set(["cog", "the", "inc", "llc", "corp", "co"])
      for (const v of vendors) {
        const candidates = [v.name, v.displayName].filter(Boolean) as string[]
        for (const c of candidates) {
          const token = c.toLowerCase().split(/\s+/)[0]
          if (SKIP_TOKENS.has(token)) continue
          if (token.length >= 4 && lowerHint.includes(token)) {
            vendorId = v.id
            break
          }
        }
        if (vendorId) break
      }
    }
  }

  if (!vendorId && input.rows.length > 0) {
    const firstRow = input.rows[0]
    const maybeVendor =
      firstRow["Manufacturer"] ??
      firstRow["Vendor"] ??
      firstRow["manufacturer"] ??
      ""
    if (maybeVendor.trim()) {
      vendorId = await findOrCreateVendorByName(maybeVendor.trim())
    }
  }

  if (!vendorId) {
    vendorId = await findOrCreateVendorByName(null)
  }

  let imported = 0
  let failed = 0

  const headers = input.rows.length > 0 ? Object.keys(input.rows[0]) : []
  const mapping = await mapColumnsWithAI(
    headers,
    [
      {
        key: "vendorItemNo",
        label: "Vendor Item Number / Catalog Number / Reference",
        required: true,
      },
      {
        key: "productDescription",
        label: "Product Description / Item Name",
        required: false,
      },
      {
        key: "contractPrice",
        label: "Contract Price / Unit Price / Net Cost",
        required: false,
      },
      { key: "listPrice", label: "List Price / MSRP", required: false },
      {
        key: "manufacturerNo",
        label: "Manufacturer Item Number",
        required: false,
      },
      { key: "uom", label: "Unit of Measure / UOM", required: false },
      { key: "category", label: "Category / Product Category", required: false },
    ],
    input.rows,
  )

  const today = new Date()
  for (const row of input.rows) {
    try {
      const vendorItemNo = get(row, mapping, "vendorItemNo")
      if (!vendorItemNo) {
        failed++
        continue
      }

      const contractPrice = parseMoney(get(row, mapping, "contractPrice"))
      const listPrice =
        parseMoney(get(row, mapping, "listPrice")) || contractPrice
      const productDescription =
        get(row, mapping, "productDescription") || vendorItemNo
      const manufacturerNo = get(row, mapping, "manufacturerNo") || undefined
      const uom = get(row, mapping, "uom") || undefined
      const category = get(row, mapping, "category") || undefined

      await prisma.pricingFile.create({
        data: {
          vendorId,
          facilityId,
          vendorItemNo,
          manufacturerNo,
          productDescription,
          listPrice: listPrice || 0,
          contractPrice: contractPrice || 0,
          effectiveDate: today,
          category,
          uom,
        },
      })
      imported++
    } catch {
      failed++
    }
  }

  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { name: true },
  })

  await logAudit({
    userId,
    action: "pricing.imported_via_mass_upload",
    entityType: "pricingFile",
    metadata: {
      imported,
      failed,
      vendorId,
      vendorName: vendor?.name,
      fileName: input.fileName ?? null,
      rowCount: input.rows.length,
    },
  })

  revalidatePath("/dashboard/cog-data")
  return { imported, failed, vendorUsed: vendor?.name ?? null }
}
