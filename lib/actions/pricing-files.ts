"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { resolveCategoryNamesBulk, isPlaceholderCategory } from "@/lib/categories/resolve"
import { applyCategoryRemap } from "@/lib/categories/apply-category-remap"
import {
  pricingFiltersSchema,
  bulkImportPricingSchema,
  type PricingFilters,
  type BulkImportPricingInput,
} from "@/lib/validators/pricing-files"
import type { Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import {
  ensureCarveOutTermFromPricing,
  populateCarveOutTermsForContract,
} from "@/lib/contracts/populate-carveout-terms"
import { sanitizePricingRow } from "@/lib/contracts/pricing-row-sanitize"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { refreshContractMetricsForVendor } from "@/lib/actions/contracts/refresh-metrics"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { toSafeResult, type SafeResult } from "@/lib/actions/safe-result"
import type { ContractPricingItem } from "./pricing-files-types"

// ─── Persist user-chosen category remaps ────────────────────────
//
// Charles 2026-06-06: when the user realigns detected pricing categories to
// canonical ones during upload, persist each pick as a confirmed
// CategoryMapping rule so future imports auto-apply it (Pass 0 of
// resolveCategoryNamesBulk reads these). Mirrors remapCOGCategory's upsert.
// Non-exported (the file is `"use server"`, but only EXPORTS must be async
// fns) so it never crosses the action boundary on its own.
//
// auth-scope-scanner-skip: CategoryMapping is global taxonomy (no facilityId
// column, same as ProductCategory) — cannot be tenant-scoped. Callers gate
// with requireFacility before reaching here. Failures are swallowed: a
// mapping-persist hiccup must never roll back the pricing import the user is
// waiting on (the in-import remap already applied).
async function persistConfirmedCategoryRemap(
  categoryRemap: Record<string, string> | undefined,
): Promise<void> {
  if (!categoryRemap) return
  for (const [rawDetected, canonical] of Object.entries(categoryRemap)) {
    const from = rawDetected.trim()
    const to = canonical.trim()
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) continue
    try {
      // auth-scope-scanner-skip: CategoryMapping is global taxonomy (no
      // facilityId column, same as ProductCategory) — cannot be tenant-scoped.
      const existing = await prisma.categoryMapping.findFirst({
        where: { cogCategory: { equals: from, mode: "insensitive" } },
        select: { id: true },
      })
      if (existing) {
        // auth-scope-scanner-skip: global taxonomy; updating the row found by
        // cogCategory above (action gated by requireFacility upstream).
        await prisma.categoryMapping.update({
          where: { id: existing.id },
          data: { contractCategory: to, isConfirmed: true },
        })
      } else {
        await prisma.categoryMapping.create({
          data: { cogCategory: from, contractCategory: to, isConfirmed: true },
        })
      }
    } catch (err) {
      console.warn(
        "[pricing-import] persist category remap failed:",
        err,
        { rawDetected: from, canonical: to },
      )
    }
  }
}

// ─── List Pricing Files ─────────────────────────────────────────

export type UnifiedPricingRow = {
  id: string
  source: "file" | "contract"
  vendorItemNo: string
  productDescription: string
  vendor: { id: string; name: string }
  category: string | null
  listPrice: string | null
  contractPrice: string | null
  carveOutPercent: string | null
  contractId: string | null
  contractName: string | null
}

export async function getPricingFiles(input: PricingFilters) {
  const { facility } = await requireFacility()
  const filters = pricingFiltersSchema.parse(input)

  // Source 1: facility-level PricingFile rows (uploaded via the COG page's
  // "Pricing Files" tab).
  const fileWhere: Prisma.PricingFileWhereInput = {
    facilityId: facility.id,
    ...(filters.vendorId ? { vendorId: filters.vendorId } : {}),
  }

  // Source 2: ContractPricing rows attached to facility-owned contracts
  // (uploaded via the contract-detail pricing-file uploader). Same
  // contracted SKU/price universe — users expect both surfaces to feed
  // the global Pricing List.
  const contractPricingWhere: Prisma.ContractPricingWhereInput = {
    contract: {
      facilityId: facility.id,
      ...(filters.vendorId ? { vendorId: filters.vendorId } : {}),
    },
  }

  const [files, contractRows] = await Promise.all([
    prisma.pricingFile.findMany({
      where: fileWhere,
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.contractPricing.findMany({
      where: contractPricingWhere,
      include: {
        contract: {
          select: {
            id: true,
            name: true,
            vendor: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const fileRows: UnifiedPricingRow[] = files.map((f) => ({
    id: f.id,
    source: "file",
    vendorItemNo: f.vendorItemNo,
    productDescription: f.productDescription,
    vendor: f.vendor,
    category: f.category,
    listPrice: f.listPrice ? f.listPrice.toString() : null,
    contractPrice: f.contractPrice ? f.contractPrice.toString() : null,
    carveOutPercent: f.carveOutPercent ? f.carveOutPercent.toString() : null,
    contractId: null,
    contractName: null,
  }))

  const contractPricingRows: UnifiedPricingRow[] = contractRows.map((r) => ({
    id: r.id,
    source: "contract",
    vendorItemNo: r.vendorItemNo,
    productDescription: r.description ?? r.vendorItemNo,
    vendor: r.contract.vendor,
    category: r.category,
    listPrice: r.listPrice ? r.listPrice.toString() : null,
    contractPrice: r.unitPrice.toString(),
    carveOutPercent: r.carveOutPercent ? r.carveOutPercent.toString() : null,
    contractId: r.contract.id,
    contractName: r.contract.name,
  }))

  const merged = [...fileRows, ...contractPricingRows]

  return { files: merged, total: merged.length }
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
  // Charles 2026-06-06: the user may have realigned detected categories to
  // canonical ones in the upload's remap step. Apply that explicit choice
  // FIRST (the user's pick wins), then run the existing canonicalize pass on
  // the remapped value so the chosen canonical name is matched/registered.
  const remap = data.categoryRemap ?? {}
  const canonicalCategoryMap = await resolveCategoryNamesBulk(
    data.records.map((r) => applyCategoryRemap(r.category, remap)),
    { createMissing: true, source: "pricing_file" },
  )
  const canonicalize = (raw: string | null | undefined): string | null => {
    const effective = applyCategoryRemap(raw, remap)
    // Bug 5: "0" / numeric / placeholder is not a category.
    if (!effective || isPlaceholderCategory(effective)) return null
    const key = effective.trim().toLowerCase().replace(/\s+/g, " ")
    return canonicalCategoryMap.get(key) ?? (effective.trim() || null)
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

  // Charles 2026-06-06: persist the realign picks so future imports auto-apply.
  await persistConfirmedCategoryRemap(data.categoryRemap)

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

  // Source 1: facility-level PricingFile rows (uploaded via the COG page's
  // Pricing Files tab).
  const [fileGroups, fileUniqueItems] = await Promise.all([
    prisma.pricingFile.groupBy({
      by: ["vendorId"],
      where: { facilityId: facility.id },
      _count: { _all: true },
      _max: { createdAt: true, expirationDate: true },
      _min: { effectiveDate: true },
    }),
    prisma.pricingFile.groupBy({
      by: ["vendorId", "vendorItemNo"],
      where: { facilityId: facility.id },
    }),
  ])

  // Source 2: ContractPricing rows uploaded via the contract-detail
  // pricing-file uploader. Group by the parent contract's vendorId so
  // the Pricing Files tab reflects every pricing surface, not just
  // facility-level imports.
  const contractRows = await prisma.contractPricing.findMany({
    where: { contract: { facilityId: facility.id } },
    select: {
      vendorItemNo: true,
      effectiveDate: true,
      expirationDate: true,
      createdAt: true,
      contract: { select: { vendorId: true } },
    },
  })

  // Aggregate by vendorId across both sources.
  type Aggregate = {
    vendorId: string
    recordCount: number
    uniqueItemNos: Set<string>
    latestUpload: Date | null
    earliestEffective: Date | null
    latestExpiration: Date | null
  }
  const byVendor = new Map<string, Aggregate>()
  const ensure = (vendorId: string): Aggregate => {
    let agg = byVendor.get(vendorId)
    if (!agg) {
      agg = {
        vendorId,
        recordCount: 0,
        uniqueItemNos: new Set(),
        latestUpload: null,
        earliestEffective: null,
        latestExpiration: null,
      }
      byVendor.set(vendorId, agg)
    }
    return agg
  }

  for (const g of fileGroups) {
    const agg = ensure(g.vendorId)
    agg.recordCount += g._count._all
    if (g._max.createdAt && (!agg.latestUpload || g._max.createdAt > agg.latestUpload)) {
      agg.latestUpload = g._max.createdAt
    }
    if (g._min.effectiveDate && (!agg.earliestEffective || g._min.effectiveDate < agg.earliestEffective)) {
      agg.earliestEffective = g._min.effectiveDate
    }
    if (g._max.expirationDate && (!agg.latestExpiration || g._max.expirationDate > agg.latestExpiration)) {
      agg.latestExpiration = g._max.expirationDate
    }
  }
  for (const u of fileUniqueItems) {
    ensure(u.vendorId).uniqueItemNos.add(u.vendorItemNo)
  }
  for (const r of contractRows) {
    const agg = ensure(r.contract.vendorId)
    agg.recordCount += 1
    agg.uniqueItemNos.add(r.vendorItemNo)
    if (r.createdAt && (!agg.latestUpload || r.createdAt > agg.latestUpload)) {
      agg.latestUpload = r.createdAt
    }
    if (r.effectiveDate && (!agg.earliestEffective || r.effectiveDate < agg.earliestEffective)) {
      agg.earliestEffective = r.effectiveDate
    }
    if (r.expirationDate && (!agg.latestExpiration || r.expirationDate > agg.latestExpiration)) {
      agg.latestExpiration = r.expirationDate
    }
  }

  if (byVendor.size === 0) return []

  const vendorIds = Array.from(byVendor.keys())
  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
    select: { id: true, name: true },
  })
  const vendorById = new Map(vendors.map((v) => [v.id, v.name]))

  const rows: UploadedPricingFileRow[] = Array.from(byVendor.values()).map(
    (agg) => ({
      vendorId: agg.vendorId,
      vendorName: vendorById.get(agg.vendorId) ?? "Unknown vendor",
      recordCount: agg.recordCount,
      uniqueItems: agg.uniqueItemNos.size,
      latestUploadDate: (agg.latestUpload ?? new Date()).toISOString(),
      earliestEffectiveDate: agg.earliestEffective
        ? agg.earliestEffective.toISOString()
        : null,
      latestExpirationDate: agg.latestExpiration
        ? agg.latestExpiration.toISOString()
        : null,
    }),
  )

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
  await prisma.pricingFile.delete({ where: { id, facilityId: facility.id } })

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

export type { ContractPricingItem } from "./pricing-files-types"

export async function importContractPricing(input: {
  contractId: string
  items: ContractPricingItem[]
  // Charles 2026-06-06: user-chosen raw-detected-category → canonical remap
  // from the pricing-upload realign step. Applied before canonicalization.
  categoryRemap?: Record<string, string>
}) {
  // Charles audit round-7 BLOCKER: verify contract ownership before
  // writing pricing rows. Pre-fix any facility user could inject
  // ContractPricing rows into ANY other facility's contracts,
  // corrupting price-variance / savings math for the victim.
  const { facility } = await requireFacility()
  const contract = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    // Vick 2026-06-07 (Fix C): load the participating vendor set so we can
    // re-run COG match + metrics after import (see post-transaction block).
    select: { id: true, vendorId: true, additionalVendorIds: true },
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
  //
  // Vick 2026-05-31 bug doc: SYK Carve out pricing import (15,548
  // rows) was leaving contract_pricing empty. Prisma's default
  // transaction timeout is 5 s, the bulk insert was rolling back
  // every time, and the user's only signal was a vague toast.
  // Bumped maxWait + timeout so realistic vendor pricing exports
  // (10k-50k rows on Stryker / DePuy / Zimmer files) complete.
  // Larger batch size halves the round-trip count too.
  // Vick 2026-05-31 (#4b): canonicalize category VALUES the same way COG
  // import does (lib/actions/cog-import.ts:138-146). Pre-fix, the
  // contract-linked pricing path stored `category` raw, so a file saying
  // "Ortho Extremity" while COG canonicalized to "Ortho-Extremity" made
  // cogCategoryCoveredByContract (match.ts) silently drop COG rows from
  // this contract's coverage / market-share. createMissing mirrors COG so
  // a new pricing category is registered (source="pricing_file") for
  // admin audit. The closure key matches resolveCategoryNamesBulk's
  // normalize(): trim → lowercase → collapse whitespace.
  // Charles 2026-06-06: apply the user's realign choice (detected → canonical)
  // BEFORE canonicalization, then feed the remapped value through the existing
  // resolver so the chosen canonical name is matched/registered.
  const remap = input.categoryRemap ?? {}
  const categoryMap = await resolveCategoryNamesBulk(
    dedupedItems.map((it) => applyCategoryRemap(it.category, remap)),
    { createMissing: true, source: "pricing_file" },
  )
  const canonicalizeCategory = (raw: string | undefined): string | undefined => {
    const effective = applyCategoryRemap(raw, remap)
    // Bug 5: "0" / numeric / placeholder is not a category.
    if (!effective || isPlaceholderCategory(effective)) return undefined
    const key = effective.trim().toLowerCase().replace(/\s+/g, " ")
    return categoryMap.get(key) ?? (effective.trim() || undefined)
  }

  const BATCH = 1000
  let imported = 0

  await prisma.$transaction(
    async (tx) => {
      await tx.contractPricing.deleteMany({
        where: { contractId: input.contractId },
      })
      for (let i = 0; i < dedupedItems.length; i += BATCH) {
        const batch = dedupedItems.slice(i, i + BATCH)
        const result = await tx.contractPricing.createMany({
          // Vick 2026-05-31 ("carve out file is a problem"): coerce each
          // row through sanitizePricingRow so a single bad value
          // (carveOutPercent overflowing Decimal(5,4), NaN price, an
          // unparseable date) degrades to a safe default instead of
          // rolling back the whole transaction. Category is then
          // canonicalized (#4b) so coverage matching lines up with COG.
          data: batch.map((item) => {
            const row = sanitizePricingRow(item)
            return {
              contractId: input.contractId,
              vendorItemNo: row.vendorItemNo,
              description: row.description,
              category: canonicalizeCategory(row.category),
              unitPrice: row.unitPrice,
              listPrice: row.listPrice,
              uom: row.uom,
              carveOutPercent: row.carveOutPercent,
              effectiveDate: row.effectiveDate,
              expirationDate: row.expirationDate,
            }
          }),
        })
        imported += result.count
      }
    },
    {
      // 50k rows × ~1 ms / row on Postgres ≈ 50 s. Give 2 min so
      // realistic catalogs complete. maxWait covers the case where
      // multiple imports queue up under the connection-pool ceiling.
      maxWait: 30_000,
      timeout: 120_000,
    },
  )

  // Vick 2026-05-31 bug doc: "It should use the pricing file to pick
  // all of the items for you for carve out." Any carve_out terms on
  // this contract get their ContractTermProduct rows rebuilt from
  // the pricing rows whose carveOutPercent > 0, so the engine
  // applies the carve-out math only to SKUs the pricing file
  // flagged. Skipped silently when no carve_out terms exist.
  // Charles 2026-06-06: persist the realign picks so future imports auto-apply.
  await persistConfirmedCategoryRemap(input.categoryRemap)

  let carveOutLinked = 0
  let carveOutTermCreated = false
  try {
    // Charles 2026-06-07 (SYK Carve out.xlsx): a pricing file with explicit
    // "Carve out %" values IS a carve-out contract. The carve-out math +
    // display are term-gated (getCarveOutRebate, b015fec) and the populate
    // helper only LINKS to an existing carve_out term — so importing a
    // carve-out file alone produced no carve-out anywhere. Auto-create the
    // term first (idempotent; no-op for pure-spend files with no carve-out
    // column → no carveOutPercent rows → no term), then link the SKUs below.
    const ensured = await ensureCarveOutTermFromPricing(input.contractId)
    carveOutTermCreated = ensured.created
  } catch (err) {
    console.warn(
      "[importContractPricing] carve-out term auto-create failed:",
      err,
      { contractId: input.contractId },
    )
  }
  try {
    const r = await populateCarveOutTermsForContract(input.contractId)
    carveOutLinked = r.productsLinked
  } catch (err) {
    // Don't let a downstream carve-out failure roll back the pricing
    // import the user is waiting on. Log and move on — the user can
    // re-trigger via the contract-detail re-sync button later.
    console.warn(
      "[importContractPricing] carve-out auto-populate failed:",
      err,
      { contractId: input.contractId },
    )
  }

  // Vick 2026-06-07 (Fix C): re-run COG match + persisted metrics for this
  // contract's vendor set so freshly-imported pricing rows immediately
  // re-categorize COG and move rows on-contract — without the user having
  // to hit "Recompute" manually. Mirrors the pattern in
  // bulkImportCOGRecords / createContract. Fired ONCE after the
  // transaction (not per row). Best-effort per vendor: a recompute or
  // metrics-refresh failure logs but never breaks the import the user is
  // waiting on.
  const vendorIds = contractVendorIds(contract)
  for (const vendorId of vendorIds) {
    try {
      await recomputeMatchStatusesForVendor(prisma, {
        vendorId,
        facilityId: facility.id,
      })
    } catch (err) {
      console.error(
        `[importContractPricing] recomputeMatchStatusesForVendor(${vendorId}, ${facility.id}) failed:`,
        err,
        { contractId: input.contractId },
      )
    }
    try {
      await refreshContractMetricsForVendor({
        vendorId,
        facilityId: facility.id,
      })
    } catch (err) {
      console.error(
        `[importContractPricing] refreshContractMetricsForVendor(${vendorId}, ${facility.id}) failed:`,
        err,
        { contractId: input.contractId },
      )
    }
  }

  return { imported, carveOutLinked, carveOutTermCreated }
}

/**
 * Error-as-value variant of importContractPricing.
 *
 * Vick screenshot 2026-05-31: a thrown pricing-import error reached the
 * user as the redacted "An error occurred in the Server Components
 * render" digest, because Next.js 16 strips Server Action error
 * messages in production builds (see df12793's createContractSafe).
 * Returning the error as a serializable value crosses the action
 * boundary intact, so the real failure reason reaches the toast.
 * Call this from React/client code; keep importContractPricing for
 * tests + non-React callers.
 */
export async function importContractPricingSafe(input: {
  contractId: string
  items: ContractPricingItem[]
  categoryRemap?: Record<string, string>
}): Promise<SafeResult<Awaited<ReturnType<typeof importContractPricing>>>> {
  return toSafeResult(
    "importContractPricing",
    { contractId: input.contractId, itemCount: input.items.length },
    () => importContractPricing(input),
  )
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
  // auth-scope-scanner-skip: contractOwnershipWhere already verified ownership above
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
