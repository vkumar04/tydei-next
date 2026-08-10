"use server"

import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import { parseMedicareRateRows } from "@/lib/financial-analysis/parse-medicare-rate-rows"
import {
  medicareAscRatesSchema,
  ingestMedicareRatesMetaSchema,
  type IngestMedicareRatesMeta,
} from "@/lib/validators/dividend-proposals"
import type { MedicareAscRate } from "@/lib/financial-analysis/medicare-asc-rates"

// Vendor-owned uploaded CMS ASC rate tables. These shadow the built-in
// CY2025 national snapshot when selected; absent, the built-in applies.

/** Must not exceed `medicareAscRatesSchema`'s 2,000-entry cap, or a file
 *  between the two limits parses fine and then dies at the write with a
 *  message about "out-of-range rate values". */
const MAX_ROWS = 2_000

export interface MedicareRateSetView {
  id: string
  name: string
  fileName: string
  rates: MedicareAscRate[]
  uploadedAt: string
}

export async function listMedicareRateSets(): Promise<MedicareRateSetView[]> {
  const { vendor } = await requireVendor()
  const rows = await prisma.medicareRateSet.findMany({
    where: { vendorId: vendor.id },
    orderBy: { name: "asc" },
  })
  return serialize(
    rows.flatMap((row) => {
      const parsed = medicareAscRatesSchema.safeParse(row.rates)
      if (!parsed.success) {
        console.error("[listMedicareRateSets] stale rates shape", {
          vendorId: vendor.id,
          rateSetId: row.id,
        })
        return []
      }
      return [
        {
          id: row.id,
          name: row.name,
          fileName: row.fileName,
          rates: parsed.data,
          uploadedAt: row.updatedAt.toISOString(),
        },
      ]
    }),
  )
}

export interface IngestMedicareRatesResult {
  id: string
  name: string
  rateCount: number
  skipped: number
}

/**
 * Parse + persist an uploaded CMS ASC rate table under a user-given name.
 * Re-uploading under the same name replaces that set.
 */
export async function ingestMedicareRateRows(
  rows: Record<string, string>[],
  meta: IngestMedicareRatesMeta,
): Promise<IngestMedicareRatesResult> {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  const parsedMeta = ingestMedicareRatesMetaSchema.parse(meta)

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("The file contains no data rows")
  }
  if (rows.length > MAX_ROWS) {
    throw new Error(
      `The file has ${rows.length.toLocaleString()} rows; max is ${MAX_ROWS.toLocaleString()}`,
    )
  }

  const parsed = parseMedicareRateRows(rows)
  if (parsed.rates.length === 0) {
    throw new Error(
      "No rates were recognized. Expected columns: Procedure Group, CPT/HCPCS code, Rate.",
    )
  }

  if (parsed.rates.length > MAX_ROWS) {
    throw new Error(
      `The file yielded ${parsed.rates.length.toLocaleString()} distinct procedure groups; max is ${MAX_ROWS.toLocaleString()}`,
    )
  }

  const validRates = medicareAscRatesSchema.safeParse(parsed.rates)
  if (!validRates.success) {
    throw new Error("The file contains out-of-range rate values.")
  }

  try {
    const saved = await prisma.medicareRateSet.upsert({
      where: {
        vendorId_name: { vendorId: vendor.id, name: parsedMeta.name },
      },
      create: {
        vendorId: vendor.id,
        name: parsedMeta.name,
        fileName: parsedMeta.fileName,
        rates: validRates.data as unknown as Prisma.InputJsonValue,
        uploadedBy: user.id,
      },
      update: {
        fileName: parsedMeta.fileName,
        rates: validRates.data as unknown as Prisma.InputJsonValue,
        uploadedBy: user.id,
      },
    })
    return {
      id: saved.id,
      name: saved.name,
      rateCount: validRates.data.length,
      skipped: parsed.skipped,
    }
  } catch (err) {
    console.error("[ingestMedicareRateRows]", err, { vendorId: vendor.id })
    throw new Error("Failed to save the Medicare rate set")
  }
}

export async function deleteMedicareRateSet(id: string): Promise<void> {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  try {
    const existing = await prisma.medicareRateSet.findFirst({
      where: { id, vendorId: vendor.id },
      select: { id: true },
    })
    if (!existing) return
    // auth-scope-scanner-skip: row authorized via the vendor-scoped findFirst above
    await prisma.medicareRateSet.delete({ where: { id: existing.id } })
  } catch (err) {
    console.error("[deleteMedicareRateSet]", err, { vendorId: vendor.id })
    throw new Error("Failed to delete the Medicare rate set")
  }
}
