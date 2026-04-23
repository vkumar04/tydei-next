/**
 * Diagnose why a facility's COG Data page shows 0% on-contract.
 *
 * Charles's screenshot (2026-04-23): 21,377 COG rows imported,
 * $30.5M spend, 0% on-contract. The oracle synthetic tests already
 * prove the matcher code works when data lines up; this script
 * inspects the REAL database state and reports the mismatch.
 *
 * Output: one section per likely root cause — vendor-id overlap,
 * contract pricing coverage, date-window coverage, matchStatus
 * histogram. Run after an import to see why rows stayed unmatched.
 *
 * Usage:
 *   bun --env-file=.env scripts/diagnose-zero-match.ts [facilityId]
 *
 * Defaults to the Lighthouse Community Hospital demo facility.
 */
import { prisma } from "@/lib/db"

const DEFAULT_FACILITY_ID = "cmo6j6fx70004achlf8fr82h2" // Lighthouse Community Hospital

async function main() {
  const facilityId = process.argv[2] ?? DEFAULT_FACILITY_ID
  const facility = await prisma.facility.findUnique({
    where: { id: facilityId },
    select: { id: true, name: true },
  })
  if (!facility) {
    console.error(`Facility ${facilityId} not found`)
    process.exit(1)
  }
  console.log(`# Zero-match diagnostic\n`)
  console.log(`facility: ${facility.name} (${facility.id})\n`)

  // ── COG rows ────────────────────────────────────────────────────
  const cogTotal = await prisma.cOGRecord.count({ where: { facilityId } })
  const cogWithVendorId = await prisma.cOGRecord.count({
    where: { facilityId, vendorId: { not: null } },
  })
  const cogWithItemNo = await prisma.cOGRecord.count({
    where: { facilityId, vendorItemNo: { not: null } },
  })
  console.log(`## COG rows`)
  console.log(`  total:          ${cogTotal}`)
  console.log(`  with vendorId:  ${cogWithVendorId}`)
  console.log(`  with itemNo:    ${cogWithItemNo}`)

  // ── matchStatus histogram ───────────────────────────────────────
  const statusGroups = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: { facilityId },
    _count: true,
  })
  console.log(`\n## matchStatus histogram`)
  for (const g of statusGroups) {
    console.log(`  ${g.matchStatus ?? "null"}: ${g._count}`)
  }

  // ── Contracts on this facility ──────────────────────────────────
  const contracts = await prisma.contract.findMany({
    where: {
      OR: [
        { facilityId },
        { contractFacilities: { some: { facilityId } } },
      ],
    },
    select: {
      id: true,
      name: true,
      status: true,
      vendorId: true,
      vendor: { select: { name: true } },
      effectiveDate: true,
      expirationDate: true,
      pricingItems: { select: { vendorItemNo: true }, take: 1 },
      _count: { select: { pricingItems: true } },
    },
  })
  console.log(`\n## Contracts visible to this facility: ${contracts.length}`)
  for (const c of contracts.slice(0, 20)) {
    console.log(
      `  ${c.name} · vendor=${c.vendor.name} · ${c.status} · ${c.effectiveDate.toISOString().slice(0, 10)}→${c.expirationDate?.toISOString().slice(0, 10) ?? "open"} · ${c._count.pricingItems} pricing items`,
    )
  }

  // ── Vendor overlap ──────────────────────────────────────────────
  const contractVendorIds = new Set(contracts.map((c) => c.vendorId))
  const cogVendorAgg = await prisma.cOGRecord.groupBy({
    by: ["vendorId"],
    where: { facilityId },
    _count: true,
    orderBy: { _count: { vendorId: "desc" } },
    take: 30,
  })
  console.log(
    `\n## Top 30 COG vendors on this facility (rows → also-in-contracts?)`,
  )
  let cogRowsOnAContractedVendor = 0
  for (const v of cogVendorAgg) {
    const inContract = v.vendorId ? contractVendorIds.has(v.vendorId) : false
    if (inContract) cogRowsOnAContractedVendor += v._count
    const vName = v.vendorId
      ? (
          await prisma.vendor.findUnique({
            where: { id: v.vendorId },
            select: { name: true },
          })
        )?.name
      : "(null vendor)"
    console.log(
      `  ${vName ?? "?"} ${v.vendorId ?? "null"} · ${v._count} rows · contract? ${
        inContract ? "YES" : "no"
      }`,
    )
  }
  console.log(
    `\n  Top-30-vendor COG rows on a contracted vendor: ${cogRowsOnAContractedVendor} / ${cogVendorAgg.reduce((s, v) => s + v._count, 0)}`,
  )

  // ── Pricing item overlap (spot-check first 5 vendors with pricing) ──
  console.log(`\n## VendorItemNo overlap (contract pricing vs COG)`)
  for (const c of contracts.filter((c) => c._count.pricingItems > 0).slice(0, 5)) {
    const pricingItems = await prisma.contractPricing.findMany({
      where: { contractId: c.id },
      select: { vendorItemNo: true },
    })
    const pricingSet = new Set(pricingItems.map((p) => p.vendorItemNo))
    const matchedCount = await prisma.cOGRecord.count({
      where: {
        facilityId,
        vendorId: c.vendorId,
        vendorItemNo: { in: Array.from(pricingSet) },
      },
    })
    const cogForVendor = await prisma.cOGRecord.count({
      where: { facilityId, vendorId: c.vendorId },
    })
    console.log(
      `  ${c.name} (${c.vendor.name}): ${pricingSet.size} pricing items · matched COG rows=${matchedCount} / ${cogForVendor} for this vendor`,
    )
  }

  // ── Date-window check ───────────────────────────────────────────
  console.log(`\n## COG transactionDate range`)
  const dateAgg = await prisma.cOGRecord.aggregate({
    where: { facilityId },
    _min: { transactionDate: true },
    _max: { transactionDate: true },
  })
  console.log(
    `  ${dateAgg._min.transactionDate?.toISOString().slice(0, 10) ?? "?"} → ${dateAgg._max.transactionDate?.toISOString().slice(0, 10) ?? "?"}`,
  )
  const activeContracts = contracts.filter(
    (c) => c.status === "active" || c.status === "expiring",
  )
  if (activeContracts.length > 0) {
    const earliest = activeContracts.reduce(
      (acc, c) => (c.effectiveDate < acc ? c.effectiveDate : acc),
      activeContracts[0].effectiveDate,
    )
    const latest = activeContracts.reduce(
      (acc, c) => {
        if (c.expirationDate && c.expirationDate > acc) return c.expirationDate
        return acc
      },
      activeContracts[0].expirationDate ?? new Date(),
    )
    console.log(
      `  Active-contract window: ${earliest.toISOString().slice(0, 10)} → ${latest.toISOString().slice(0, 10)}`,
    )
  }

  console.log(`\n## Verdict`)
  if (contracts.length === 0) {
    console.log(`  NO contracts visible to this facility — matcher has nothing to match against.`)
  } else if (cogRowsOnAContractedVendor === 0) {
    console.log(
      `  COG rows exist but NONE share a vendorId with any facility contract — likely a vendor-alias gap. Check the vendor_name_mapping table and whether COG imports auto-resolved to the right vendor IDs.`,
    )
  } else if (contracts.every((c) => c._count.pricingItems === 0)) {
    console.log(
      `  Contracts exist for the COG vendors but NONE carry pricing items — upload a pricing file per contract so the vendorItemNo cascade can match.`,
    )
  } else {
    console.log(
      `  Partial overlap. Inspect the "VendorItemNo overlap" section above — if matchedCount is ≈0 while cogForVendor is large, the pricing file's vendorItemNo values don't match the COG's.`,
    )
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
