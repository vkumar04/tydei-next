// scripts/oracles/market-share.ts
/**
 * Market-share oracle.
 *
 * Recomputes per-category market share for a vendor at the demo
 * facility and asserts the app's getCategoryMarketShareForVendor
 * returns the same numbers. The recompute does NOT use
 * computeCategoryMarketShare or any other shared helper — that's the
 * whole point of an oracle. If they disagree, the detail string
 * shows which category disagreed and by how much.
 */
import { prisma } from "@/lib/db"
import { defineOracle } from "./_shared/runner"
import { getDemoFacilityId } from "./_shared/fixtures"

export default defineOracle("market-share", async (ctx) => {
  try {
    const facilityId = await getDemoFacilityId()

    // Pick a vendor that has at least one categorizable COG row at the
    // demo facility. We don't care which — we just need one to drive
    // the comparison.
    const sampleRow = await prisma.cOGRecord.findFirst({
      where: {
        facilityId,
        vendorId: { not: null },
        OR: [
          { category: { not: null } },
          { contract: { productCategory: { isNot: null } } },
        ],
      },
      select: { vendorId: true },
    })
    if (!sampleRow?.vendorId) {
      ctx.check(
        "demo facility has a categorizable vendor",
        false,
        "no COGRecord with vendor + (category | contract.productCategory) found",
      )
      return
    }
    const vendorId = sampleRow.vendorId

    // ── Independent recompute (no shared reducer) ──────────────
    const since = new Date()
    since.setMonth(since.getMonth() - 12)

    const rows = await prisma.cOGRecord.findMany({
      where: { facilityId, transactionDate: { gte: since } },
      select: {
        vendorId: true,
        category: true,
        extendedPrice: true,
        contractId: true,
      },
    })
    const contractIds = Array.from(
      new Set(rows.map((r) => r.contractId).filter((v): v is string => !!v)),
    )
    const contractCategoryRows =
      contractIds.length > 0
        ? await prisma.contract.findMany({
            where: { id: { in: contractIds } },
            select: { id: true, productCategory: { select: { name: true } } },
          })
        : []
    const contractCategoryMap = new Map<string, string | null>(
      contractCategoryRows.map((c) => [c.id, c.productCategory?.name ?? null]),
    )

    type Bucket = { total: number; vendorSpend: number }
    const oracleByCategory = new Map<string, Bucket>()
    for (const r of rows) {
      const amt = Number(r.extendedPrice ?? 0)
      if (amt <= 0) continue
      const cat =
        r.category ??
        (r.contractId ? contractCategoryMap.get(r.contractId) ?? null : null)
      if (!cat) continue
      const bucket = oracleByCategory.get(cat) ?? { total: 0, vendorSpend: 0 }
      bucket.total += amt
      if (r.vendorId === vendorId) bucket.vendorSpend += amt
      oracleByCategory.set(cat, bucket)
    }
    const oracleShares = new Map<string, number>()
    for (const [cat, b] of oracleByCategory.entries()) {
      if (b.vendorSpend <= 0) continue
      oracleShares.set(cat, b.total > 0 ? (b.vendorSpend / b.total) * 100 : 0)
    }

    // ── App (canonical helper) ─────────────────────────────────
    const { computeCategoryMarketShare } = await import(
      "@/lib/contracts/market-share-filter"
    )
    const appResult = computeCategoryMarketShare({
      rows,
      contractCategoryMap,
      vendorId,
    })
    const appShares = new Map(
      appResult.rows.map((r) => [r.category, r.sharePct]),
    )

    // ── Compare ────────────────────────────────────────────────
    ctx.check(
      "every oracle category appears in app output",
      [...oracleShares.keys()].every((c) => appShares.has(c)),
      `oracle has ${oracleShares.size} cats, app has ${appShares.size}; missing: ${[...oracleShares.keys()].filter((c) => !appShares.has(c)).join(", ") || "none"}`,
    )
    ctx.check(
      "every app category appears in oracle output",
      [...appShares.keys()].every((c) => oracleShares.has(c)),
      `extra in app: ${[...appShares.keys()].filter((c) => !oracleShares.has(c)).join(", ") || "none"}`,
    )

    let mismatches = 0
    const diffs: string[] = []
    for (const [cat, oracleShare] of oracleShares.entries()) {
      const appShare = appShares.get(cat)
      if (appShare == null) continue
      if (Math.abs(appShare - oracleShare) > 0.01) {
        mismatches++
        diffs.push(
          `${cat}: app=${appShare.toFixed(4)}% oracle=${oracleShare.toFixed(4)}%`,
        )
      }
    }
    ctx.check(
      "share% matches per category (±0.01pp)",
      mismatches === 0,
      mismatches === 0
        ? `${oracleShares.size} categories agree`
        : `${mismatches} mismatches: ${diffs.slice(0, 5).join("; ")}${diffs.length > 5 ? `; …+${diffs.length - 5} more` : ""}`,
    )

    // Aggregate equality.
    let oracleAllVendorSpend = 0
    let oracleUncatSpend = 0
    for (const r of rows) {
      const amt = Number(r.extendedPrice ?? 0)
      if (amt <= 0) continue
      if (r.vendorId !== vendorId) continue
      oracleAllVendorSpend += amt
      const cat =
        r.category ??
        (r.contractId ? contractCategoryMap.get(r.contractId) ?? null : null)
      if (!cat) oracleUncatSpend += amt
    }
    ctx.check(
      "totalVendorSpend matches",
      Math.abs(appResult.totalVendorSpend - oracleAllVendorSpend) < 0.01,
      `app=${appResult.totalVendorSpend.toFixed(2)} oracle=${oracleAllVendorSpend.toFixed(2)}`,
    )
    ctx.check(
      "uncategorizedSpend matches",
      Math.abs(appResult.uncategorizedSpend - oracleUncatSpend) < 0.01,
      `app=${appResult.uncategorizedSpend.toFixed(2)} oracle=${oracleUncatSpend.toFixed(2)}`,
    )
  } finally {
    await prisma.$disconnect()
  }
})
