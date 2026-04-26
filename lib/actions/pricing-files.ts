"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { resolveCategoryNamesBulk } from "@/lib/categories/resolve"
import {
  pricingFiltersSchema,
  bulkImportPricingSchema,
  type PricingFilters,
  type BulkImportPricingInput,
} from "@/lib/validators/pricing-files"
import type { Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"

// ─── List Pricing Files ─────────────────────────────────────────

export async function getPricingFiles(input: PricingFilters) {
  const { facility } = await requireFacility()
  const filters = pricingFiltersSchema.parse(input)

  const conditions: Prisma.PricingFileWhereInput[] = [
    { facilityId: facility.id },
  ]

  if (filters.vendorId) conditions.push({ vendorId: filters.vendorId })

  const where: Prisma.PricingFileWhereInput = { AND: conditions }
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20

  const [files, total] = await Promise.all([
    prisma.pricingFile.findMany({
      where,
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.pricingFile.count({ where }),
  ])

  return serialize({ files, total })
}

// ─── Bulk Import Pricing File Entries ───────────────────────────

const PRICING_BATCH_SIZE = 500

export async function bulkImportPricingFiles(input: BulkImportPricingInput) {
  const { facility, user } = await requireFacility()
  const data = bulkImportPricingSchema.parse(input)

  let imported = 0
  let errors = 0

  // 2026-04-26 (Charles prod feedback): "When you enter a price file
  // the categories need to be validated like when you do COGs and it
  // validates the vendor names." Canonicalize every category string
  // against the ProductCategory table so two imports of "Ortho-
  // Extremity" / "ortho-extremity" / "Ortho Extremity " collapse
  // to one canonical name. Mirror of the cog-import.ts wiring.
  const canonicalCategoryMap = await resolveCategoryNamesBulk(
    data.records.map((r) => r.category),
    { createMissing: true, source: "pricing_file" },
  )
  const canonicalize = (raw: string | null | undefined): string | null => {
    if (!raw) return null
    const key = raw.trim().toLowerCase().replace(/\s+/g, " ")
    return canonicalCategoryMap.get(key) ?? (raw.trim() || null)
  }

  for (let i = 0; i < data.records.length; i += PRICING_BATCH_SIZE) {
    const batch = data.records.slice(i, i + PRICING_BATCH_SIZE)
    try {
      const result = await prisma.pricingFile.createMany({
        data: batch.map((record) => ({
          vendorId: data.vendorId,
          facilityId: facility.id,
          vendorItemNo: record.vendorItemNo,
          manufacturerNo: record.manufacturerNo,
          productDescription: record.productDescription,
          listPrice: record.listPrice,
          contractPrice: record.contractPrice,
          effectiveDate: new Date(record.effectiveDate),
          expirationDate: record.expirationDate
            ? new Date(record.expirationDate)
            : null,
          category: canonicalize(record.category),
          uom: record.uom,
        })),
      })
      imported += result.count
    } catch {
      errors += batch.length
    }
  }

  await logAudit({
    userId: user.id,
    action: "pricing.imported",
    entityType: "pricingFile",
    metadata: { vendorId: data.vendorId, imported, errors, totalRecords: data.records.length },
  })

  return { imported, errors }
}

// ─── Delete Pricing Files by Vendor ─────────────────────────────

export async function deletePricingFilesByVendor(
  vendorId: string,
  facilityId: string
) {
  const { facility, user } = await requireFacility()

  // Enforce facility scope from the session — never trust the caller-passed
  // facilityId. This prevents a client from deleting pricing rows for
  // another facility.
  if (facility.id !== facilityId) {
    throw new Error("Facility mismatch")
  }

  // Pricing rows can be referenced from a ContractPricing record (when the
  // pricing file was imported into a specific contract). Clean those up
  // first so the PricingFile deletion doesn't violate relational integrity.
  await prisma.contractPricing.deleteMany({
    where: {
      contract: { facilityId: facility.id },
      vendorItemNo: {
        in: (
          await prisma.pricingFile.findMany({
            where: { vendorId, facilityId: facility.id },
            select: { vendorItemNo: true },
          })
        ).map((p) => p.vendorItemNo),
      },
    },
  })

  const { count } = await prisma.pricingFile.deleteMany({
    where: { vendorId, facilityId: facility.id },
  })

  await logAudit({
    userId: user.id,
    action: "pricing.deleted_by_vendor",
    entityType: "pricingFile",
    metadata: { vendorId, deleted: count },
  })

  return { deleted: count }
}

// ─── Uploaded Pricing Files (grouped by vendor) ─────────────────

export interface UploadedPricingFileRow {
  vendorId: string
  vendorName: string
  recordCount: number
  uniqueItems: number
  latestUploadDate: string
  earliestEffectiveDate: string | null
  latestExpirationDate: string | null
}

/**
 * Returns one row per vendor with aggregate pricing-file stats for the
 * current facility. This powers the "Uploaded Pricing Files" list, where
 * "delete" removes all pricing rows for a vendor at this facility.
 */
export async function getUploadedPricingFiles(): Promise<
  UploadedPricingFileRow[]
> {
  const { facility } = await requireFacility()

  const grouped = await prisma.pricingFile.groupBy({
    by: ["vendorId"],
    where: { facilityId: facility.id },
    _count: { _all: true },
    _max: { createdAt: true, expirationDate: true },
    _min: { effectiveDate: true },
  })

  if (grouped.length === 0) return []

  const vendorIds = grouped.map((g) => g.vendorId)
  const [vendors, uniqueItems] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: vendorIds } },
      select: { id: true, name: true },
    }),
    prisma.pricingFile.groupBy({
      by: ["vendorId", "vendorItemNo"],
      where: { facilityId: facility.id, vendorId: { in: vendorIds } },
    }),
  ])
  const vendorById = new Map(vendors.map((v) => [v.id, v.name]))
  const uniqueByVendor = new Map<string, number>()
  for (const row of uniqueItems) {
    uniqueByVendor.set(
      row.vendorId,
      (uniqueByVendor.get(row.vendorId) ?? 0) + 1,
    )
  }

  const rows: UploadedPricingFileRow[] = grouped.map((g) => ({
    vendorId: g.vendorId,
    vendorName: vendorById.get(g.vendorId) ?? "Unknown vendor",
    recordCount: g._count._all,
    uniqueItems: uniqueByVendor.get(g.vendorId) ?? 0,
    latestUploadDate: (g._max.createdAt ?? new Date()).toISOString(),
    earliestEffectiveDate: g._min.effectiveDate
      ? g._min.effectiveDate.toISOString()
      : null,
    latestExpirationDate: g._max.expirationDate
      ? g._max.expirationDate.toISOString()
      : null,
  }))

  rows.sort(
    (a, b) =>
      new Date(b.latestUploadDate).getTime() -
      new Date(a.latestUploadDate).getTime(),
  )
  return rows
}

// ─── Delete a single PricingFile row ────────────────────────────

export async function deletePricingFile(id: string): Promise<{ id: string }> {
  const { facility, user } = await requireFacility()

  // Facility-scope guard: verify the row belongs to this facility before
  // deleting.
  const row = await prisma.pricingFile.findFirst({
    where: { id, facilityId: facility.id },
    select: { id: true, vendorId: true, vendorItemNo: true },
  })
  if (!row) throw new Error("Pricing row not found")

  await prisma.contractPricing.deleteMany({
    where: {
      contract: { facilityId: facility.id },
      vendorItemNo: row.vendorItemNo,
    },
  })
  await prisma.pricingFile.delete({ where: { id } })

  await logAudit({
    userId: user.id,
    action: "pricing.deleted",
    entityType: "pricingFile",
    entityId: id,
    metadata: { vendorId: row.vendorId },
  })

  return { id }
}

// ─── Import Contract Pricing (linked to a specific contract) ───

export interface ContractPricingItem {
  vendorItemNo: string
  description?: string
  category?: string
  unitPrice: number
  listPrice?: number
  uom?: string
  effectiveDate?: string
  expirationDate?: string
  /** Charles iMessage 2026-04-20 N17 — per-SKU carve-out rate (fraction, 0.03 = 3%). */
  carveOutPercent?: number
}

export async function importContractPricing(input: {
  contractId: string
  items: ContractPricingItem[]
}) {
  // Charles audit round-7 BLOCKER: verify contract ownership before
  // writing pricing rows. Pre-fix any facility user could inject
  // ContractPricing rows into ANY other facility's contracts,
  // corrupting price-variance / savings math for the victim.
  const { facility } = await requireFacility()
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { id: true },
  })

  if (input.items.length === 0) return { imported: 0 }

  // Charles audit round-3 facility CONCERN-1: dedupe by case-insensitive
  // trimmed vendorItemNo with last-wins semantics (matches the pending-
  // contracts pricing extractor convention). Without this, a vendor
  // CSV with `ABC`, `abc`, ` ABC ` produces 3 distinct ContractPricing
  // rows and per-SKU price-variance / compliance lookups silently miss.
  const indexByItemNo = new Map<string, number>()
  const dedupedItems: ContractPricingItem[] = []
  for (const item of input.items) {
    const raw = item.vendorItemNo
    if (!raw || typeof raw !== "string") continue
    const trimmed = raw.trim()
    if (!trimmed) continue
    const key = trimmed.toUpperCase()
    const existing = indexByItemNo.get(key)
    const normalized = { ...item, vendorItemNo: trimmed }
    if (existing !== undefined) {
      dedupedItems[existing] = normalized
    } else {
      indexByItemNo.set(key, dedupedItems.length)
      dedupedItems.push(normalized)
    }
  }

  // Charles audit round-14 CONCERN: now that
  // (contractId, vendorItemNo) is unique, a re-import of the same
  // contract's pricing CSV would throw P2002 on createMany (no
  // skipDuplicates) and roll back the entire batch — breaking the
  // standard "vendor sent updated prices, re-import" workflow.
  // Replace-semantics: delete this contract's existing pricing rows
  // first, then bulk-insert. Wrapped in a transaction so a mid-flight
  // failure doesn't leave the contract with empty pricing.
  const BATCH = 500
  let imported = 0

  await prisma.$transaction(async (tx) => {
    await tx.contractPricing.deleteMany({
      where: { contractId: input.contractId },
    })
    for (let i = 0; i < dedupedItems.length; i += BATCH) {
      const batch = dedupedItems.slice(i, i + BATCH)
      const result = await tx.contractPricing.createMany({
        data: batch.map((item) => ({
          contractId: input.contractId,
          vendorItemNo: item.vendorItemNo,
          description: item.description,
          category: item.category,
          unitPrice: item.unitPrice,
          listPrice: item.listPrice,
          uom: item.uom ?? "EA",
          carveOutPercent: item.carveOutPercent ?? null,
          effectiveDate: item.effectiveDate
            ? new Date(item.effectiveDate)
            : null,
          expirationDate: item.expirationDate
            ? new Date(item.expirationDate)
            : null,
        })),
      })
      imported += result.count
    }
  })

  return { imported }
}

// ─── Update a single ContractPricing record ────────────────────

export async function updateContractPricing(id: string, data: {
  unitPrice?: number
  listPrice?: number
  description?: string
  category?: string
  uom?: string
}) {
  // Charles audit round-7 BLOCKER: verify the row's contract belongs
  // to this facility before mutating.
  const { facility } = await requireFacility()
  const existing = await prisma.contractPricing.findUniqueOrThrow({
    where: { id },
    select: { contractId: true },
  })
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(existing.contractId, facility.id),
    select: { id: true },
  })
  const record = await prisma.contractPricing.update({
    where: { id },
    data: {
      ...(data.unitPrice !== undefined && { unitPrice: data.unitPrice }),
      ...(data.listPrice !== undefined && { listPrice: data.listPrice }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.category !== undefined && { category: data.category }),
      ...(data.uom !== undefined && { uom: data.uom }),
    },
  })
  return serialize(record)
}

// ─── List ContractPricing for a given contract ─────────────────

export async function getContractPricing(contractId: string) {
  // Charles audit round-7 CONCERN: scope read by facility ownership
  // so cross-tenant pricing isn't exposed.
  const { facility } = await requireFacility()
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true },
  })
  const records = await prisma.contractPricing.findMany({
    where: { contractId },
    orderBy: [{ category: "asc" }, { vendorItemNo: "asc" }],
  })
  return serialize(records)
}

// ─── Delete a single ContractPricing record ────────────────────

export async function deleteContractPricing(id: string) {
  // Charles audit round-7 BLOCKER: verify ownership before delete.
  const { facility } = await requireFacility()
  const existing = await prisma.contractPricing.findUniqueOrThrow({
    where: { id },
    select: { contractId: true },
  })
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(existing.contractId, facility.id),
    select: { id: true },
  })
  await prisma.contractPricing.delete({ where: { id } })
}
