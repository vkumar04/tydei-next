"use server"

/**
 * COG category mapping — the category twin of cog-vendor-mapping.ts (#1).
 *
 * Vick 2026-05-31 (#4): "When price files are loaded, especially for
 * categories, the system should do mapping for categories the same way it
 * does for vendor names with COGs." COG categories ("JOINT",
 * "CONSTRUCTS-JOINT-Hip") and the price file's ("Ortho-Joints") are
 * different names for the same thing; nothing unified them. These actions
 * let the user map them, retag existing rows, and persist a confirmed
 * CategoryMapping rule that the resolver (lib/categories/resolve.ts)
 * applies to every future import.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { recomputeAccrualForContract } from "@/lib/actions/contracts/recompute-accrual"
import { refreshContractMetricsForVendor } from "@/lib/actions/contracts/refresh-metrics"
import { suggestTarget } from "@/lib/categories/category-suggest"
import { removeInverseCategoryMapping } from "@/lib/categories/resolve"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"
import { serialize } from "@/lib/serialize"
import { revalidatePath } from "next/cache"

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

export interface CogCategoryMapping {
  /** The raw category string as it appears in COG/pricing rows. */
  category: string
  recordCount: number
  totalSpend: number
  /** Confirmed canonical target, if a mapping exists. */
  mappedTo: string | null
  /** Bug 1/10 follow-up: best-guess canonical target for unmapped rows,
   *  so the dialog can pre-propose it (the user confirms instead of
   *  typing). null when already mapped or no confident match. */
  suggestedTarget: string | null
}

/**
 * Distinct categories at this facility + their current confirmed mapping
 * target (if any). Drives the Category Mapping dialog.
 *
 * Bug 1/10 (Vick 2026-06-02): "when you upload a price file it needs to map
 * categories ... like Cogs." The dialog previously listed only COGRecord
 * categories, so a category that lives only in a price file
 * (`ContractPricing.category`, e.g. "Joints-Ortho") never showed up to be
 * mapped. Union both sources so the price-file flow gets the same
 * category-value mapping COG has. CategoryMapping is global, so a rule made
 * here applies to every future COG AND price-file import via the resolver.
 */
export async function getCOGCategoryMappings(): Promise<CogCategoryMapping[]> {
  const { facility } = await requireFacility()

  const [cogGrouped, pricingGrouped] = await Promise.all([
    prisma.cOGRecord.groupBy({
      by: ["category"],
      where: { facilityId: facility.id, category: { not: null } },
      _count: { _all: true },
      _sum: { extendedPrice: true },
    }),
    prisma.contractPricing.groupBy({
      by: ["category"],
      where: { category: { not: null }, contract: { facilityId: facility.id } },
      _count: { _all: true },
    }),
  ])

  const [confirmed, productCategories] = await Promise.all([
    prisma.categoryMapping.findMany({
      where: { isConfirmed: true, contractCategory: { not: null } },
      select: { cogCategory: true, contractCategory: true },
    }),
    prisma.productCategory.findMany({ select: { name: true } }),
  ])
  const byName = new Map<string, string>()
  for (const m of confirmed) {
    if (m.contractCategory) byName.set(normalize(m.cogCategory), m.contractCategory)
  }
  // 2026-06-09: never auto-suggest a name that is itself the SOURCE of a
  // confirmed mapping — a dead/superseded name proposed as a target would
  // re-fragment the data the mapping just merged.
  const confirmedSourceKeys = new Set(
    confirmed.map((m) => normalize(m.cogCategory)),
  )
  const canonicalNames = productCategories
    .map((p) => p.name)
    .filter((n) => !confirmedSourceKeys.has(normalize(n)))

  // Merge COG + price-file categories keyed by normalized name; keep the
  // first-seen display label and sum record counts. Price-file rows carry
  // no spend (ContractPricing is a price list, not purchases), so spend
  // comes from COG only.
  const merged = new Map<
    string,
    { category: string; recordCount: number; totalSpend: number }
  >()
  const add = (raw: string | null, count: number, spend: number) => {
    const category = (raw ?? "").trim()
    if (!category) return
    const key = normalize(category)
    const cur = merged.get(key) ?? { category, recordCount: 0, totalSpend: 0 }
    cur.recordCount += count
    cur.totalSpend += spend
    merged.set(key, cur)
  }
  for (const g of cogGrouped) {
    add(g.category, g._count?._all ?? 0, Number(g._sum?.extendedPrice ?? 0))
  }
  for (const g of pricingGrouped) {
    add(g.category, g._count?._all ?? 0, 0)
  }

  return Array.from(merged.values())
    .map((r) => {
      const mappedTo = byName.get(normalize(r.category)) ?? null
      return {
        ...r,
        mappedTo,
        // Only suggest when not already mapped and not already an exact
        // canonical name (those resolve on their own).
        suggestedTarget:
          mappedTo ||
          canonicalNames.some((n) => normalize(n) === normalize(r.category))
            ? null
            : suggestTarget(r.category, canonicalNames),
      }
    })
    .sort((a, b) => b.totalSpend - a.totalSpend || b.recordCount - a.recordCount)
}

export interface ContractCategoryHealth {
  /** Distinct category names on this contract's vendors that resolve to no
   *  ProductCategory and have no confirmed mapping. */
  unmappedCount: number
  /** Up to 5 example unmapped names, highest-spend first. */
  unmappedExamples: string[]
  /** Trailing spend sitting in those unmapped categories. */
  unmappedSpend: number
}

/**
 * Bug 1/10 follow-up (Vick 2026-06-02): "needs mapping" nudge for the
 * contract detail page. Counts category names on the contract's (grouped)
 * vendors that won't attribute because they resolve to no canonical
 * ProductCategory and have no confirmed mapping — so the UI can prompt the
 * user to open "Map Categories" instead of silently under-counting.
 */
export async function getContractCategoryHealth(
  contractId: string,
): Promise<ContractCategoryHealth> {
  const { facility } = await requireFacility()
  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { vendorId: true, additionalVendorIds: true },
  })
  const vendorIds = contractVendorIds(contract)
  if (vendorIds.length === 0)
    return { unmappedCount: 0, unmappedExamples: [], unmappedSpend: 0 }

  const [grouped, productCategories, confirmed] = await Promise.all([
    prisma.cOGRecord.groupBy({
      by: ["category"],
      where: {
        facilityId: facility.id,
        vendorId: { in: vendorIds },
        category: { not: null },
      },
      _sum: { extendedPrice: true },
    }),
    prisma.productCategory.findMany({ select: { name: true } }),
    prisma.categoryMapping.findMany({
      where: { isConfirmed: true, contractCategory: { not: null } },
      select: { cogCategory: true },
    }),
  ])
  const canonical = new Set(productCategories.map((p) => normalize(p.name)))
  const mapped = new Set(confirmed.map((m) => normalize(m.cogCategory)))

  const unmapped = grouped
    .map((g) => ({
      category: (g.category ?? "").trim(),
      spend: Number(g._sum?.extendedPrice ?? 0),
    }))
    .filter(
      (r) =>
        r.category &&
        !canonical.has(normalize(r.category)) &&
        !mapped.has(normalize(r.category)),
    )
    .sort((a, b) => b.spend - a.spend)

  return serialize({
    unmappedCount: unmapped.length,
    unmappedExamples: unmapped.slice(0, 5).map((u) => u.category),
    unmappedSpend: unmapped.reduce((s, u) => s + u.spend, 0),
  })
}

/**
 * Map a COG category to a canonical category. Retags existing COG rows
 * (facility-scoped), upserts a confirmed CategoryMapping rule so future
 * imports auto-apply it, then recomputes match statuses for the affected
 * vendors so category-scoped contract matching reflects the change.
 * `contractCategory === null` clears the mapping (unmap).
 */
export async function remapCOGCategory(input: {
  cogCategory: string
  contractCategory: string | null
}): Promise<{ recordsUpdated: number }> {
  const { facility } = await requireFacility()
  const from = input.cogCategory.trim()
  if (!from) throw new Error("cogCategory required")
  const to = input.contractCategory?.trim() || null

  // 2026-06-09 (Charles "it shows the old ones with no spend"): the dialog
  // MERGES rows by normalize() (trim + collapse internal whitespace), but the
  // retag matched a single `equals` — so a whitespace variant ("JOINT  HIP")
  // merged into the displayed bucket survived the updateMany and reappeared
  // with $0. Compute every stored variant sharing the normalized key and
  // retag them all.
  const [cogCatRows, pricingCatRows] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: { facilityId: facility.id },
      distinct: ["category"],
      select: { category: true },
    }),
    prisma.contractPricing.findMany({
      where: { contract: { facilityId: facility.id } },
      distinct: ["category"],
      select: { category: true },
    }),
  ])
  const fromKey = normalize(from)
  const variants = Array.from(
    new Set([
      from,
      ...[...cogCatRows, ...pricingCatRows]
        .map((r) => r.category)
        .filter((c): c is string => !!c && normalize(c) === fromKey),
    ]),
  )

  // Capture the vendors whose COG sits in this category so we can recompute
  // their match statuses after the retag (category scope can change which
  // rows are on-contract).
  const affected = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      category: { in: variants, mode: "insensitive" },
    },
    select: { vendorId: true },
    distinct: ["vendorId"],
  })
  const vendorIds = affected
    .map((r) => r.vendorId)
    .filter((v): v is string => !!v)

  let recordsUpdated = 0
  // Contracts whose persisted accrual must be rebuilt after the retag —
  // term-scope rewrites and category-scoped spend both move when names merge.
  const rewrittenTermContractIds = new Set<string>()
  if (to) {
    // All-or-nothing: the COG retag, price-file/term-scope rewrites,
    // CategoryMapping upsert, and taxonomy retarget+prune must commit
    // together — a partial apply would leave the data tagged to the new
    // name while the term scopes / taxonomy still point at the old one
    // (or vice-versa). The recompute fan-out stays OUTSIDE (separate
    // concern, and it must run against committed rows).
    recordsUpdated = await prisma.$transaction(async (tx) => {
    const updated = await tx.cOGRecord.updateMany({
      where: {
        facilityId: facility.id,
        category: { in: variants, mode: "insensitive" },
      },
      data: { category: to },
    })
    const recordsUpdatedInner = updated.count

    // Bug 1/10: retag matching price-file rows too, so the contract's
    // pricing categories line up with COG immediately (not just on the
    // next import). Scoped to this facility via the contract relation.
    await tx.contractPricing.updateMany({
      where: {
        category: { in: variants, mode: "insensitive" },
        contract: { facilityId: facility.id },
      },
      data: { category: to },
    })

    // 2026-06-09: parity retags the original fix missed — the vendor-level
    // price files and any term scoped to the old name (a term scoped to
    // ["JOINT"] stops matching COG retagged to "Ortho-Joints"; canonical
    // variant expansion bridges case/word-order drift, not arbitrary
    // renames).
    await tx.pricingFile.updateMany({
      where: {
        facilityId: facility.id,
        category: { in: variants, mode: "insensitive" },
      },
      data: { category: to },
    })
    // 2026-06-10 (Charles "still showing categories I mapped away"): match
    // terms by CANONICAL key, not exact stored string. `hasSome: variants`
    // only caught whitespace variants of the dialog row — a term storing a
    // word-order/punctuation variant ("Joints-Ortho" vs "Joints Ortho")
    // survived the rewrite and kept rendering the dead name. Fetch every
    // scoped term at the facility and compare canonically.
    const fromCanonical = canonicalizeCategoryName(from)
    const scopedTerms = await tx.contractTerm.findMany({
      where: {
        categories: { isEmpty: false },
        contract: { facilityId: facility.id },
      },
      select: { id: true, categories: true, contractId: true },
    })
    for (const t of scopedTerms) {
      const matches = t.categories.some(
        (c) =>
          normalize(c) === fromKey ||
          canonicalizeCategoryName(c) === fromCanonical,
      )
      if (!matches) continue
      const next = Array.from(
        new Set(
          t.categories.map((c) =>
            normalize(c) === fromKey ||
            canonicalizeCategoryName(c) === fromCanonical
              ? to
              : c,
          ),
        ),
      )
      // auth-scope-scanner-skip: term ids come from the facility-scoped findMany above.
      await tx.contractTerm.update({
        where: { id: t.id },
        data: { categories: next },
      })
      rewrittenTermContractIds.add(t.contractId)
    }

    // Persist the confirmed rule (upsert on cogCategory).
    // auth-scope-scanner-skip: CategoryMapping is global taxonomy (no
    // facilityId column, same as ProductCategory) — it cannot be
    // tenant-scoped. Looked up by cogCategory; the action is gated by
    // requireFacility above.
    const existing = await tx.categoryMapping.findFirst({
      where: { cogCategory: { equals: from, mode: "insensitive" } },
      select: { id: true },
    })
    if (existing) {
      // auth-scope-scanner-skip: CategoryMapping is global taxonomy (no
      // facilityId) — updating the row found by cogCategory above.
      await tx.categoryMapping.update({
        where: { id: existing.id },
        data: { contractCategory: to, isConfirmed: true },
      })
    } else {
      await tx.categoryMapping.create({
        data: { cogCategory: from, contractCategory: to, isConfirmed: true },
      })
    }
    // 2026-06-09 audit: saving from→to supersedes any confirmed inverse
    // (to→from). Leaving both creates a swap cycle that flips the two
    // names between buckets instead of merging them.
    await removeInverseCategoryMapping(from, to, tx)

    // 2026-06-09 (Charles "it shows the old ones with no spend, they can be
    // removed"): the remap retagged the DATA but left the old name's
    // ProductCategory row in the global taxonomy — so it lingered in every
    // category picker, could be auto-suggested as a mapping target, and
    // showed as a dead $0 row. Retarget its taxonomy references to the new
    // category, then delete it once NOTHING anywhere (any facility — the
    // taxonomy is tenant-shared) still references the old name.
    const oldCat = await tx.productCategory.findFirst({
      where: { name: { equals: from, mode: "insensitive" } },
    })
    // auth-scope-scanner-skip: lookup by NAME on global taxonomy (no facilityId column).
    const newCat = await tx.productCategory.findFirst({
      where: { name: { equals: to, mode: "insensitive" } },
    })
    if (oldCat && newCat && oldCat.id !== newCat.id) {
      // Primary-category pointers move to the new category.
      await tx.contract.updateMany({
        where: { productCategoryId: oldCat.id },
        data: { productCategoryId: newCat.id },
      })
      // Join rows: drop would-be duplicates first (@@unique on
      // [contractId, productCategoryId]), then retarget the rest.
      const haveNew = await tx.contractProductCategory.findMany({
        where: { productCategoryId: newCat.id },
        select: { contractId: true },
      })
      await tx.contractProductCategory.deleteMany({
        where: {
          productCategoryId: oldCat.id,
          contractId: { in: haveNew.map((h) => h.contractId) },
        },
      })
      await tx.contractProductCategory.updateMany({
        where: { productCategoryId: oldCat.id },
        data: { productCategoryId: newCat.id },
      })
      // Reparent children (guard the degenerate cycle where the new
      // category is itself a child of the old one).
      if (newCat.parentId === oldCat.id) {
        // auth-scope-scanner-skip: ProductCategory is global taxonomy (no
        // facilityId column); row was resolved by name above.
        await tx.productCategory.update({
          where: { id: newCat.id },
          data: { parentId: oldCat.parentId ?? null },
        })
      }
      await tx.productCategory.updateMany({
        where: { parentId: oldCat.id },
        data: { parentId: newCat.id },
      })
      // Global zero-reference check before deleting the taxonomy row.
      const [cogN, cpN, pfN, pbN, termN] = await Promise.all([
        tx.cOGRecord.count({
          where: { category: { equals: oldCat.name, mode: "insensitive" } },
        }),
        tx.contractPricing.count({
          where: { category: { equals: oldCat.name, mode: "insensitive" } },
        }),
        tx.pricingFile.count({
          where: { category: { equals: oldCat.name, mode: "insensitive" } },
        }),
        tx.productBenchmark.count({
          where: { category: { equals: oldCat.name, mode: "insensitive" } },
        }),
        tx.contractTerm.count({
          where: { categories: { has: oldCat.name } },
        }),
      ])
      if (cogN + cpN + pfN + pbN + termN === 0) {
        // auth-scope-scanner-skip: global taxonomy row, resolved by name
        // above and verified unreferenced everywhere.
        await tx.productCategory.delete({ where: { id: oldCat.id } })
        console.info(
          `[remapCOGCategory] deleted unreferenced taxonomy row "${oldCat.name}" after remap → "${to}"`,
        )
      }
    }
    return recordsUpdatedInner
    }, { timeout: 30_000 })
  } else {
    // Unmap — drop any rule for this category.
    await prisma.categoryMapping.deleteMany({
      where: { cogCategory: { equals: from, mode: "insensitive" } },
    })
  }

  for (const vendorId of vendorIds) {
    await recomputeMatchStatusesForVendor(vendorId, facility.id)
  }

  // Bug #3 (Charles 2026-06-10 "rebates earned and what is calculated in
  // performance are different ... after I edited and saved the rebate and
  // performance rebate now match"): a category remap changes which COG rows
  // fall in a term's scope, but the persisted Rebate accrual rows were only
  // rebuilt on term save / COG import — so the header (persisted) and the
  // Performance timeline (live) diverged until the user happened to re-save
  // a term. Recompute accrual for every contract the remap touched: rewritten
  // term scopes + any contract on the affected vendors.
  if (to) {
    // Review R3: the threshold scalar branches read persisted
    // Contract.complianceRate / currentMarketShare — refresh them first
    // (mirrors the cog-import pipeline's ordering) so compliance terms
    // don't re-qualify tiers against pre-remap values.
    for (const vendorId of vendorIds) {
      try {
        await refreshContractMetricsForVendor({
          vendorId,
          facilityId: facility.id,
        })
      } catch (err) {
        console.warn(
          `[remapCOGCategory] refreshContractMetricsForVendor(${vendorId}) failed:`,
          err,
        )
      }
    }
    // Review R1: group-aware — a grouped contract whose MEMBER vendor's COG
    // was retagged carries that vendor in additionalVendorIds, not vendorId
    // (the recurring group-vendor drift class). Review R2: only live
    // contracts accrue — match the cog-import fan-out's status filter so a
    // broad category remap doesn't recompute every expired contract.
    const vendorContracts =
      vendorIds.length > 0
        ? await prisma.contract.findMany({
            where: {
              facilityId: facility.id,
              status: { in: ["active", "expiring"] },
              OR: [
                { vendorId: { in: vendorIds } },
                ...vendorIds.map((v) => ({
                  additionalVendorIds: { has: v },
                })),
              ],
            },
            select: { id: true },
          })
        : []
    const contractIdsToRecompute = new Set([
      ...rewrittenTermContractIds,
      ...vendorContracts.map((c) => c.id),
    ])
    for (const cId of contractIdsToRecompute) {
      try {
        await recomputeAccrualForContract(cId)
      } catch (err) {
        console.warn(
          `[remapCOGCategory] recomputeAccrualForContract(${cId}) failed:`,
          err,
        )
      }
    }
  }

  revalidatePath("/dashboard/cog-data")
  revalidatePath("/dashboard/contracts")
  // 2026-06-09: the Settings → Categories tab + pickers read the taxonomy
  // the remap may have just pruned.
  revalidatePath("/dashboard/settings")
  return { recordsUpdated }
}
