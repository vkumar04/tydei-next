// scripts/oracles/grouped-vendor-scope.ts
/**
 * Grouped-vendor scope oracle.
 *
 * Codifies the real-data finding from the Arthrex/Smith & Nephew bundle
 * (Vick 2026-06-02): the only prod contract groups two spellings of the
 * same vendor — "SMITH & NEPHEW INC" (primary, $0 recent spend) and
 * "Smith & Nephew, Inc." (additional, ALL $7.25M of it). Every surface
 * that scopes by the primary `contract.vendorId` alone dropped the
 * additional vendor, so on-contract spend, market share, and carve-out
 * read near-zero. The fix routes those reads through
 * `contractVendorIds()`.
 *
 * Invariant (read-only, safe for prod): for every grouped contract, the
 * group-aware trailing-12mo spend and per-category market-share
 * vendor-spend must be >= the primary-vendor-only value. A grouped
 * contract where they DIFFER is exactly the name-fragmentation case the
 * fix exists for — logged so it's visible, not silently equal.
 */
import { prisma } from "@/lib/db"
import { defineOracle } from "./_shared/runner"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import {
  computeCategoryMarketShare,
  type MarketShareCogRow,
} from "@/lib/contracts/market-share-filter"

export default defineOracle("grouped-vendor-scope", async (ctx) => {
  const allGrouped = await prisma.contract.findMany({
    where: { isGrouped: true },
    select: {
      id: true,
      name: true,
      vendorId: true,
      additionalVendorIds: true,
      facilityId: true,
    },
  })

  // Only single-facility contracts with at least one additional vendor are
  // the fragmentation case. Multi-facility (facilityId null) or
  // degenerate (no additional vendors) grouped contracts are out of scope.
  const grouped = allGrouped.filter(
    (c): c is typeof c & { facilityId: string } =>
      !!c.facilityId && (c.additionalVendorIds?.length ?? 0) > 0,
  )

  if (grouped.length === 0) {
    ctx.check(
      "grouped contracts present to validate",
      true,
      `no single-facility multi-vendor grouped contracts in this DB (of ${allGrouped.length} grouped total) — invariant vacuously holds`,
    )
    return
  }

  const since = new Date()
  since.setMonth(since.getMonth() - 12)

  let fragmentationCases = 0
  for (const c of grouped) {
    const vendorIds = contractVendorIds(c)
    const hasAdditional = vendorIds.length > 1

    // Trailing-12mo spend: primary-only vs full group.
    const [primaryAgg, groupAgg] = await Promise.all([
      prisma.cOGRecord.aggregate({
        where: {
          facilityId: c.facilityId,
          vendorId: c.vendorId,
          transactionDate: { gte: since },
        },
        _sum: { extendedPrice: true },
      }),
      prisma.cOGRecord.aggregate({
        where: {
          facilityId: c.facilityId,
          vendorId: { in: vendorIds },
          transactionDate: { gte: since },
        },
        _sum: { extendedPrice: true },
      }),
    ])
    const primarySpend = Number(primaryAgg._sum.extendedPrice ?? 0)
    const groupSpend = Number(groupAgg._sum.extendedPrice ?? 0)

    ctx.check(
      `[${c.name}] group spend >= primary-only spend`,
      groupSpend >= primarySpend - 0.01,
      `primary=${primarySpend.toFixed(0)} group=${groupSpend.toFixed(0)}`,
    )

    // Market share: vendor-spend per category must be >= for the group.
    const rows = await prisma.cOGRecord.findMany({
      where: { facilityId: c.facilityId, transactionDate: { gte: since } },
      select: { vendorId: true, category: true, extendedPrice: true, contractId: true },
    })
    const msRows: MarketShareCogRow[] = rows.map((r) => ({
      vendorId: r.vendorId,
      category: r.category,
      extendedPrice: Number(r.extendedPrice ?? 0),
      contractId: r.contractId,
    }))
    const single = computeCategoryMarketShare({
      rows: msRows,
      contractCategoryMap: new Map(),
      vendorId: c.vendorId,
    })
    const group = computeCategoryMarketShare({
      rows: msRows,
      contractCategoryMap: new Map(),
      vendorId: vendorIds,
    })
    ctx.check(
      `[${c.name}] group market-share vendor-spend >= single-vendor`,
      group.totalVendorSpend >= single.totalVendorSpend - 0.01,
      `single=${single.totalVendorSpend.toFixed(0)} group=${group.totalVendorSpend.toFixed(0)}`,
    )

    // Name-fragmentation signature: additional vendors carry spend the
    // primary doesn't. Log (don't fail) — this is the case the fix saves.
    if (hasAdditional && groupSpend > primarySpend + 1) {
      fragmentationCases++
      ctx.check(
        `[${c.name}] name-fragmentation detected (informational)`,
        true,
        `group surfaces ${(groupSpend - primarySpend).toFixed(0)} that primary-only dropped — the fix's exact purpose`,
      )
    }
  }

  ctx.check(
    "grouped-vendor scope summary",
    true,
    `${grouped.length} grouped contract(s), ${fragmentationCases} with additional-vendor spend the primary lacks`,
  )
})
