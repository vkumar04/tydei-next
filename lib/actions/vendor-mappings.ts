"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import { remapCOGVendorName } from "@/lib/actions/cog-vendor-mapping"

// ─── Get Vendor Name Mappings ───────────────────────────────────

export async function getVendorNameMappings(input: {
  isConfirmed?: boolean
  page?: number
  pageSize?: number
}) {
  const { facility } = await requireFacility()

  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 20
  // #1 (Vick 2026-05-31): mappings are per-facility — only ever list this
  // facility's rules.
  const where = {
    facilityId: facility.id,
    ...(input.isConfirmed !== undefined ? { isConfirmed: input.isConfirmed } : {}),
  }

  const [mappings, total] = await Promise.all([
    prisma.vendorNameMapping.findMany({
      where,
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.vendorNameMapping.count({ where }),
  ])

  return serialize({ mappings, total })
}

// ─── Confirm Vendor Name Mapping ────────────────────────────────

/**
 * Confirm a mapping AND apply it. #1 (Vick 2026-05-31): confirming now
 * routes through `remapCOGVendorName`, which re-maps existing COG rows,
 * recomputes match/metrics, and persists the confirmed per-facility rule
 * (so future imports auto-apply it). Per-facility → `requireFacility`
 * (was `requireAdmin` back when the table was global taxonomy).
 */
export async function confirmVendorNameMapping(
  id: string,
  mappedVendorId: string,
) {
  const { facility } = await requireFacility()

  const mapping = await prisma.vendorNameMapping.findFirstOrThrow({
    where: { id, facilityId: facility.id },
    select: { cogVendorName: true },
  })

  await remapCOGVendorName({
    vendorName: mapping.cogVendorName,
    newVendorId: mappedVendorId,
  })
}

// ─── Create Vendor Name Mapping ─────────────────────────────────

export async function createVendorNameMapping(input: {
  cogVendorName: string
  mappedVendorId?: string
  mappedVendorName?: string
  confidenceScore?: number
}) {
  const { facility } = await requireFacility()
  await requireCanMutate()

  // Upsert on the (facilityId, cogVendorName) unique — a plain create would
  // throw if a rule (e.g. an unconfirmed suggestion) already exists.
  const mapping = await prisma.vendorNameMapping.upsert({
    where: {
      facilityId_cogVendorName: {
        facilityId: facility.id,
        cogVendorName: input.cogVendorName,
      },
    },
    create: {
      facilityId: facility.id,
      cogVendorName: input.cogVendorName,
      mappedVendorId: input.mappedVendorId,
      mappedVendorName: input.mappedVendorName,
      confidenceScore: input.confidenceScore,
    },
    update: {
      mappedVendorId: input.mappedVendorId,
      mappedVendorName: input.mappedVendorName,
      confidenceScore: input.confidenceScore,
    },
  })
  return serialize(mapping)
}

// ─── Delete Mapping ─────────────────────────────────────────────

export async function deleteVendorNameMapping(id: string) {
  const { facility } = await requireFacility()
  await requireCanMutate()
  // Facility-scoped delete — deleteMany so a cross-facility id is a no-op
  // rather than an error.
  await prisma.vendorNameMapping.deleteMany({
    where: { id, facilityId: facility.id },
  })
}
