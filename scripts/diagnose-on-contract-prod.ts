/**
 * Read-only prod diagnostic: "On-contract shows $0, why?"
 *
 * Run against Railway prod:
 *   DATABASE_URL="<railway prod url>" bun scripts/diagnose-on-contract-prod.ts
 *
 * Or pass a facilityName / vendorName hint:
 *   DATABASE_URL=... FACILITY="Lighthouse" VENDOR="Arthrex" \
 *     bun scripts/diagnose-on-contract-prod.ts
 *
 * This script WRITES NOTHING. It only SELECTs, so it's safe against prod.
 *
 * For every (facility, vendor, contract) triple that plausibly matches,
 * it prints the four layers most likely to be "stuck on $0":
 *
 *   L1. ContractPricing row count       → is the pricing file loaded?
 *   L2. COGRecord count for this vendor → did any COG import happen?
 *   L3. matchStatus breakdown           → did recompute run?
 *   L4. on-contract spend               → what the UI would show
 */
import { prisma } from "@/lib/db"

const FACILITY_HINT = process.env.FACILITY ?? ""
const VENDOR_HINT = process.env.VENDOR ?? "Arthrex"

function fmt(n: number | bigint): string {
  return `$${Number(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

async function main() {
  console.log("# on-contract prod diagnostic")
  console.log()
  console.log(`_Run: ${new Date().toISOString()}_`)
  console.log(`_Facility hint: "${FACILITY_HINT || "(any)"}"_`)
  console.log(`_Vendor hint:   "${VENDOR_HINT}"_`)
  console.log()

  // ── Find candidate (facility, vendor) combos ─────────────────────
  const facilities = await prisma.facility.findMany({
    where: FACILITY_HINT
      ? { name: { contains: FACILITY_HINT, mode: "insensitive" } }
      : {},
    select: { id: true, name: true },
  })
  const vendors = await prisma.vendor.findMany({
    where: { name: { contains: VENDOR_HINT, mode: "insensitive" } },
    select: { id: true, name: true },
  })
  console.log(
    `Facilities matched: ${facilities.length} — ${facilities.map((f) => f.name).join(", ") || "(none)"}`,
  )
  console.log(
    `Vendors matched:    ${vendors.length} — ${vendors.map((v) => v.name).join(", ") || "(none)"}`,
  )
  console.log()

  if (facilities.length === 0 || vendors.length === 0) {
    console.log(
      "❌ No facility or vendor rows matched the hints. Re-run with FACILITY=... VENDOR=...",
    )
    await prisma.$disconnect()
    return
  }

  for (const facility of facilities) {
    for (const vendor of vendors) {
      const contracts = await prisma.contract.findMany({
        where: { facilityId: facility.id, vendorId: vendor.id },
        select: {
          id: true,
          name: true,
          contractNumber: true,
          status: true,
          _count: { select: { pricingItems: true, rebates: true } },
        },
      })
      if (contracts.length === 0) continue

      console.log(`## ${facility.name} · ${vendor.name}`)
      console.log()
      console.log(
        `- facilityId=\`${facility.id}\`  vendorId=\`${vendor.id}\``,
      )

      // L2 — COG totals for this (facility, vendor) regardless of contract
      const cogAll = await prisma.cOGRecord.aggregate({
        where: { facilityId: facility.id, vendorId: vendor.id },
        _count: { _all: true },
        _sum: { extendedPrice: true },
      })
      console.log(
        `- COGRecord rows for this vendor at this facility: **${cogAll._count._all}**, spend **${fmt(Number(cogAll._sum.extendedPrice ?? 0))}**`,
      )

      // matchStatus distribution across ALL this-vendor rows
      const statusAll = await prisma.cOGRecord.groupBy({
        by: ["matchStatus"],
        where: { facilityId: facility.id, vendorId: vendor.id },
        _count: { _all: true },
        _sum: { extendedPrice: true },
      })
      if (statusAll.length > 0) {
        console.log()
        console.log("matchStatus breakdown (all this-vendor COG at facility):")
        console.log()
        console.log("| matchStatus | rows | spend |")
        console.log("|---|---:|---:|")
        for (const s of statusAll) {
          console.log(
            `| \`${s.matchStatus ?? "(null)"}\` | ${s._count._all} | ${fmt(Number(s._sum.extendedPrice ?? 0))} |`,
          )
        }
      }
      console.log()

      for (const c of contracts) {
        console.log(`### Contract: ${c.name} (\`${c.id}\`)`)
        console.log(
          `- contractNumber: \`${c.contractNumber}\`  status: \`${c.status}\``,
        )
        console.log(
          `- **L1 ContractPricing rows**: ${c._count.pricingItems}  ${c._count.pricingItems === 0 ? "❌ EMPTY — pricing file never imported to this contract" : "✅"}`,
        )

        // L3 + L4 — exact same query the off-contract-spend card uses
        const scopeOR = [
          { contractId: c.id },
          { contractId: null, vendorId: vendor.id },
        ]
        const statusScoped = await prisma.cOGRecord.groupBy({
          by: ["matchStatus"],
          where: { facilityId: facility.id, OR: scopeOR },
          _count: { _all: true },
          _sum: { extendedPrice: true },
        })
        const bucket = (s: string) =>
          statusScoped.find((r) => r.matchStatus === s) ?? {
            _count: { _all: 0 },
            _sum: { extendedPrice: 0 },
          }
        const onC =
          Number(bucket("on_contract")._sum.extendedPrice ?? 0) +
          Number(bucket("price_variance")._sum.extendedPrice ?? 0)
        const onCRows =
          bucket("on_contract")._count._all +
          bucket("price_variance")._count._all
        const notPriced = Number(
          bucket("off_contract_item")._sum.extendedPrice ?? 0,
        )
        const preMatch = Number(bucket("out_of_scope")._sum.extendedPrice ?? 0)
        const unknown = Number(
          bucket("unknown_vendor")._sum.extendedPrice ?? 0,
        )
        const pending = Number(bucket("pending")._sum.extendedPrice ?? 0)

        console.log()
        console.log(
          "matchStatus breakdown (scoped to this contract OR null+same-vendor):",
        )
        console.log()
        console.log("| matchStatus | rows | spend |")
        console.log("|---|---:|---:|")
        for (const s of statusScoped) {
          console.log(
            `| \`${s.matchStatus ?? "(null)"}\` | ${s._count._all} | ${fmt(Number(s._sum.extendedPrice ?? 0))} |`,
          )
        }
        console.log()
        console.log(
          `- **L4 On-contract spend (what the card would show)**: ${fmt(onC)} (${onCRows} rows) ${onC === 0 ? "❌ $0" : "✅"}`,
        )
        console.log(`  - Not Priced (off_contract_item): ${fmt(notPriced)}`)
        console.log(`  - Pre-match (out_of_scope):       ${fmt(preMatch)}`)
        console.log(`  - Unknown vendor:                 ${fmt(unknown)}`)
        console.log(`  - Pending (never recomputed):     ${fmt(pending)}`)

        // ── Diagnosis ────────────────────────────────────────────
        console.log()
        console.log("**Diagnosis for this contract:**")
        if (cogAll._count._all === 0) {
          console.log(
            "- No COG rows exist for this (facility, vendor). Import COG first.",
          )
        } else if (c._count.pricingItems === 0) {
          console.log(
            "- ❌ `ContractPricing` is empty — the pricing file was never ingested for this contract. Re-import the price file.",
          )
        } else if (pending > 0 && onC === 0) {
          console.log(
            "- ❌ Rows are still on `matchStatus=pending`. Recompute hasn't run. Trigger `recomputeMatchStatusesForVendor` for this (facility, vendor).",
          )
        } else if (onC === 0 && notPriced > 0) {
          console.log(
            "- ❌ Recompute ran, but NOTHING matched. Likely vendorItemNo casing/whitespace mismatch between `ContractPricing.vendorItemNo` and `COGRecord.vendorItemNo`, or the pricing file loaded under a different contract.",
          )
        } else if (onC === 0 && unknown > 0) {
          console.log(
            "- ❌ Every row is `unknown_vendor` — COG rows were imported with a different `vendorId` than the contract. Fix the vendor linkage.",
          )
        } else if (onC === 0) {
          console.log(
            "- ❌ On-contract is $0 but none of the usual culprits fit. Paste this output back and we'll dig deeper.",
          )
        } else {
          console.log("- ✅ On-contract is non-zero at the DB layer.")
          console.log(
            "  If the UI still shows $0, the bug is in the read path / client cache, not the data. Check Railway deploy SHA vs `git rev-parse origin/main`.",
          )
        }
        console.log()
      }
    }
  }

  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
