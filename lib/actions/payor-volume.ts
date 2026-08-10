"use server"

import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import { vendorRelatedFacilityWhere } from "@/lib/vendors/related-facilities"
import {
  parsePayorVolumeRows,
  type PayorProcedureGroup,
} from "@/lib/payor-volume/parse-payor-volume-rows"
import type { PayorVolumeDatasetView } from "@/lib/payor-volume/sample-dataset"
import {
  ingestPayorVolumeMetaSchema,
  payorProcedureGroupsSchema,
  type IngestPayorVolumeMeta,
} from "@/lib/validators/dividend-proposals"

// Vendor-owned payor-volume datasets for the Dividend/DCF tab. The vendor rep
// uploads a payor-reported procedure-volume file per facility (connected or
// ad-hoc prospect); rows never reach the facility portal. All reads/writes are
// scoped to the caller's vendor.

const MAX_ROWS = 50_000
const MAX_GROUPS = 500

function toView(row: {
  id: string
  facilityKey: string
  facilityId: string | null
  facilityLabel: string
  fileName: string
  periods: unknown
  groups: unknown
  totalAnnualizedVolume: number
  updatedAt: Date
}): PayorVolumeDatasetView {
  return {
    id: row.id,
    facilityKey: row.facilityKey,
    facilityLabel: row.facilityLabel,
    connected: row.facilityId !== null,
    fileName: row.fileName,
    periods: (row.periods as string[]) ?? [],
    groups: (row.groups as PayorProcedureGroup[]) ?? [],
    totalAnnualizedVolume: row.totalAnnualizedVolume,
    uploadedAt: row.updatedAt.toISOString(),
  }
}

export async function listPayorVolumeDatasets(): Promise<PayorVolumeDatasetView[]> {
  const { vendor } = await requireVendor()
  const rows = await prisma.payorVolumeDataset.findMany({
    where: { vendorId: vendor.id },
    orderBy: { facilityLabel: "asc" },
  })
  return serialize(rows.map(toView)) as PayorVolumeDatasetView[]
}

export interface IngestPayorVolumeResult {
  facilityKey: string
  facilityLabel: string
  groupCount: number
  totalAnnualizedVolume: number
}

/**
 * Parse + persist an uploaded payor volume file for one facility. Rows come
 * from the /api/import-payor-volume route (file bytes never cross the RSC
 * wire). Re-uploading for the same facility replaces the dataset.
 */
export async function ingestPayorVolumeRows(
  rows: Record<string, string>[],
  meta: IngestPayorVolumeMeta,
): Promise<IngestPayorVolumeResult> {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  const parsedMeta = ingestPayorVolumeMetaSchema.parse(meta)

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("The file contains no data rows")
  }
  if (rows.length > MAX_ROWS) {
    throw new Error(
      `The file has ${rows.length.toLocaleString()} rows; max is ${MAX_ROWS.toLocaleString()}`,
    )
  }

  let facilityId: string | null = null
  let facilityKey: string
  let facilityLabel: string
  if (parsedMeta.facilityId) {
    // The facility must be one this vendor legitimately works with — the same
    // visibility predicate that feeds the facility picker.
    const facility = await prisma.facility.findFirst({
      where: {
        id: parsedMeta.facilityId,
        status: "active",
        ...vendorRelatedFacilityWhere(vendor.id),
      },
      select: { id: true, name: true },
    })
    if (!facility) throw new Error("Facility not found")
    facilityId = facility.id
    facilityKey = `facility:${facility.id}`
    facilityLabel = facility.name
  } else {
    const name = (parsedMeta.adhocName ?? "").trim()
    facilityKey = `adhoc:${name.toLowerCase()}`
    facilityLabel = name
  }

  const parsed = parsePayorVolumeRows(rows)
  if (parsed.groups.length === 0) {
    throw new Error(
      "No procedure groups found. Expected columns: Procedure Group, Year, Quarter, Volume.",
    )
  }
  if (parsed.groups.length > MAX_GROUPS) {
    throw new Error(
      `The file has ${parsed.groups.length} procedure groups; max is ${MAX_GROUPS}`,
    )
  }

  // Write-time shape gate: the Json column only ever holds validated groups
  // (finite bounded volumes, sane years/quarters), so reads can cast.
  const validGroups = payorProcedureGroupsSchema.safeParse(parsed.groups)
  if (!validGroups.success) {
    throw new Error(
      "The file contains out-of-range values (volumes must be non-negative numbers).",
    )
  }

  try {
    const groupsJson = validGroups.data as unknown as Prisma.InputJsonValue
    const saved = await prisma.payorVolumeDataset.upsert({
      where: {
        vendorId_facilityKey: { vendorId: vendor.id, facilityKey },
      },
      create: {
        vendorId: vendor.id,
        facilityKey,
        facilityId,
        facilityLabel,
        fileName: parsedMeta.fileName,
        periods: parsed.periods,
        groups: groupsJson,
        totalAnnualizedVolume: parsed.totalAnnualizedVolume,
        uploadedBy: user.id,
      },
      update: {
        facilityId,
        facilityLabel,
        fileName: parsedMeta.fileName,
        periods: parsed.periods,
        groups: groupsJson,
        totalAnnualizedVolume: parsed.totalAnnualizedVolume,
        uploadedBy: user.id,
      },
    })
    return {
      facilityKey: saved.facilityKey,
      facilityLabel: saved.facilityLabel,
      groupCount: parsed.groups.length,
      totalAnnualizedVolume: parsed.totalAnnualizedVolume,
    }
  } catch (err) {
    console.error("[ingestPayorVolumeRows]", err, { vendorId: vendor.id })
    throw new Error("Failed to save the payor volume dataset")
  }
}

export async function deletePayorVolumeDataset(id: string): Promise<void> {
  const { vendor } = await requireVendor()
  await requireCanMutate()
  try {
    const existing = await prisma.payorVolumeDataset.findFirst({
      where: { id, vendorId: vendor.id },
      select: { id: true },
    })
    if (!existing) return
    // auth-scope-scanner-skip: row authorized via the vendor-scoped findFirst above
    await prisma.payorVolumeDataset.delete({
      where: { id: existing.id },
    })
  } catch (err) {
    console.error("[deletePayorVolumeDataset]", err, { vendorId: vendor.id })
    throw new Error("Failed to delete the payor volume dataset")
  }
}
