/**
 * probe-recompute-arthrex — W2.A1b diagnostic.
 *
 * Locates the bug in the COG → Contract matching PIPELINE (not the pure
 * matcher, which was already proven correct in W2.A1). Inspects the Arthrex
 * contract at Lighthouse Surgical Center, dumps the pipeline's exact
 * contract-shaped view of it, runs the real `recomputeMatchStatusesForVendor`
 * with side effects, and reports which of H1–H6 is confirmed.
 *
 * WRITES TO DB. Dev only.
 *
 * Usage:
 *   bun --env-file=.env scripts/probe-recompute-arthrex.ts > docs/superpowers/diagnostics/2026-04-22-w2a1b-recompute-probe.md
 */

import { prisma } from "../lib/db"
import {
  loadContractsForVendor,
  recomputeMatchStatusesForVendor,
} from "../lib/cog/recompute"

const CONTRACT_ID = "cmo6j6g34002sachllckth77b"
const FACILITY_ID = "cmo6j6fx40003achla96kuxs1" // Lighthouse Surgical Center
const VENDOR_ID = "cmo6j6fxi000eachl119glqh0" // Arthrex

type StatusCounts = Record<string, number>

async function countByStatus(): Promise<StatusCounts> {
  const rows = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: { facilityId: FACILITY_ID, vendorId: VENDOR_ID },
    _count: { _all: true },
  })
  const out: StatusCounts = {}
  for (const r of rows) {
    out[r.matchStatus] = r._count._all
  }
  return out
}

function fmtCounts(c: StatusCounts): string {
  return JSON.stringify(c)
}

async function main(): Promise<void> {
  // Header + warning banner
  console.log("# W2.A1b — Recompute pipeline probe (Arthrex cluster)")
  console.log("")
  console.log("Date: 2026-04-22")
  console.log("")
  console.log("> ⚠ **WARNING:** This script WRITES to the dev DB.")
  console.log("> It invokes the real `recomputeMatchStatusesForVendor` with side effects.")
  console.log("")
  console.log(`- Contract:        \`${CONTRACT_ID}\``)
  console.log(`- Facility:        \`${FACILITY_ID}\` (Lighthouse Surgical Center)`)
  console.log(`- Vendor:          \`${VENDOR_ID}\` (Arthrex)`)
  console.log("")

  // ── Step 1: read contract with every relation loadContractsForVendor would
  //           need, independently (so we can see raw DB truth).
  console.log("## Step 1 — Raw contract row + relations")
  console.log("")
  const contractRaw = await prisma.contract.findUnique({
    where: { id: CONTRACT_ID },
    select: {
      id: true,
      name: true,
      vendorId: true,
      facilityId: true,
      status: true,
      effectiveDate: true,
      expirationDate: true,
      contractFacilities: { select: { facilityId: true } },
      pricingItems: {
        select: {
          id: true,
          vendorItemNo: true,
          unitPrice: true,
          listPrice: true,
        },
      },
      terms: {
        select: {
          id: true,
          appliesTo: true,
          categories: true,
        },
      },
    },
  })

  if (!contractRaw) {
    console.log("```")
    console.log(`ERROR: Contract ${CONTRACT_ID} not found in DB.`)
    console.log("```")
    await prisma.$disconnect()
    return
  }

  console.log("```json")
  console.log(
    JSON.stringify(
      {
        id: contractRaw.id,
        name: contractRaw.name,
        vendorId: contractRaw.vendorId,
        facilityId: contractRaw.facilityId,
        status: contractRaw.status,
        effectiveDate: contractRaw.effectiveDate,
        expirationDate: contractRaw.expirationDate,
        contractFacilitiesCount: contractRaw.contractFacilities.length,
        contractFacilityIds: contractRaw.contractFacilities.map((cf) => cf.facilityId),
        pricingItemsCount: contractRaw.pricingItems.length,
        pricingItemsSample: contractRaw.pricingItems.slice(0, 5).map((p) => ({
          vendorItemNo: p.vendorItemNo,
          unitPrice: Number(p.unitPrice),
          listPrice: p.listPrice === null ? null : Number(p.listPrice),
        })),
        termsCount: contractRaw.terms.length,
        terms: contractRaw.terms.map((t) => ({
          appliesTo: t.appliesTo,
          categories: t.categories,
        })),
      },
      null,
      2,
    ),
  )
  console.log("```")
  console.log("")

  // ── Step 2: call the exact pipeline loader the recompute uses.
  console.log("## Step 2 — `loadContractsForVendor` output (what the pipeline SEES)")
  console.log("")
  const loaded = await loadContractsForVendor(prisma, VENDOR_ID, FACILITY_ID)
  console.log(`Pipeline loaded **${loaded.length}** contract(s) for vendor=${VENDOR_ID} facility=${FACILITY_ID}.`)
  console.log("")
  console.log("```json")
  console.log(
    JSON.stringify(
      loaded.map((c) => ({
        id: c.id,
        vendorId: c.vendorId,
        status: c.status,
        effectiveDate: c.effectiveDate,
        expirationDate: c.expirationDate,
        facilityIds: c.facilityIds,
        pricingItemsLength: c.pricingItems.length,
        pricingItemsSample: c.pricingItems.slice(0, 5),
        termsLength: c.terms?.length ?? 0,
        terms: c.terms ?? [],
      })),
      null,
      2,
    ),
  )
  console.log("```")
  console.log("")

  // ── Step 3: pre-recompute distribution.
  console.log("## Step 3 — COG matchStatus distribution BEFORE recompute")
  console.log("")
  const pre = await countByStatus()
  const preTotal = Object.values(pre).reduce((a, b) => a + b, 0)
  console.log(`Total Arthrex-vendor COG rows at this facility: **${preTotal}**`)
  console.log("")
  console.log("```json")
  console.log(fmtCounts(pre))
  console.log("```")
  console.log("")

  // ── Step 4: run the real recompute.
  console.log("## Step 4 — Call `recomputeMatchStatusesForVendor` (real, writes to DB)")
  console.log("")
  let summary: Awaited<ReturnType<typeof recomputeMatchStatusesForVendor>> | null = null
  let recomputeError: unknown = null
  try {
    summary = await recomputeMatchStatusesForVendor(prisma, {
      vendorId: VENDOR_ID,
      facilityId: FACILITY_ID,
    })
  } catch (err) {
    recomputeError = err
  }

  if (recomputeError !== null) {
    console.log("```")
    console.log("ERROR during recomputeMatchStatusesForVendor:")
    console.log(
      recomputeError instanceof Error
        ? `${recomputeError.name}: ${recomputeError.message}\n${recomputeError.stack ?? ""}`
        : String(recomputeError),
    )
    console.log("```")
  } else if (summary) {
    console.log("```json")
    console.log(JSON.stringify(summary, null, 2))
    console.log("```")
  }
  console.log("")

  // ── Step 5: post-recompute distribution.
  console.log("## Step 5 — COG matchStatus distribution AFTER recompute")
  console.log("")
  const post = await countByStatus()
  const postTotal = Object.values(post).reduce((a, b) => a + b, 0)
  console.log(`Total Arthrex-vendor COG rows at this facility: **${postTotal}**`)
  console.log("")
  console.log("```json")
  console.log(fmtCounts(post))
  console.log("```")
  console.log("")

  // ── Step 6: if still pending rows, dump 5 full rows.
  const stillPending = post["pending"] ?? 0
  console.log(`## Step 6 — Remaining \`pending\` rows: ${stillPending}`)
  console.log("")
  if (stillPending > 0) {
    const samples = await prisma.cOGRecord.findMany({
      where: { facilityId: FACILITY_ID, vendorId: VENDOR_ID, matchStatus: "pending" },
      take: 5,
      select: {
        id: true,
        vendorItemNo: true,
        vendorName: true,
        category: true,
        inventoryDescription: true,
        transactionDate: true,
        unitCost: true,
        quantity: true,
        matchStatus: true,
        contractId: true,
      },
    })
    console.log("```json")
    console.log(
      JSON.stringify(
        samples.map((s) => ({
          id: s.id,
          vendorItemNo: s.vendorItemNo,
          vendorName: s.vendorName,
          category: s.category,
          inventoryDescription: s.inventoryDescription,
          transactionDate: s.transactionDate,
          unitCost: Number(s.unitCost),
          quantity: s.quantity,
          matchStatus: s.matchStatus,
          contractId: s.contractId,
        })),
        null,
        2,
      ),
    )
    console.log("```")
  } else {
    console.log("_(No rows remain at `pending` — pipeline flipped everything.)_")
  }
  console.log("")

  // ── Hypothesis grid.
  console.log("## Hypothesis grid")
  console.log("")
  const h1 = loaded.length === 0
  const h2 = loaded.length >= 1 && loaded.some((c) => c.facilityIds.length === 0)
  const h3 = loaded.length >= 1 && loaded.every((c) => c.pricingItems.length === 0)
  const h4 =
    recomputeError === null &&
    summary !== null &&
    summary.updated === preTotal &&
    summary.onContract > 0
  const h5 =
    recomputeError === null &&
    summary !== null &&
    summary.updated === preTotal &&
    summary.onContract === 0 &&
    summary.offContract === preTotal
  const h6 = recomputeError !== null

  const mark = (b: boolean): string => (b ? "✅" : "❌")
  console.log(`- ${mark(h1)} **H1** — \`loadContractsForVendor\` returns zero contracts.`)
  console.log(`- ${mark(h2)} **H2** — Loaded but \`facilityIds\` array is empty.`)
  console.log(`- ${mark(h3)} **H3** — Loaded but \`pricingItems\` is empty.`)
  console.log(`- ${mark(h4)} **H4** — Recompute OK, updated = ${preTotal}, onContract > 0 (pipeline fine; trigger wasn't wired).`)
  console.log(`- ${mark(h5)} **H5** — Recompute OK, updated = ${preTotal}, onContract = 0 & offContract = ${preTotal} (seed/vendor-attribution bug).`)
  console.log(`- ${mark(h6)} **H6** — Recompute silently errored (caught above).`)
  console.log("")

  // ── Report section (machine-parseable).
  console.log("## Report")
  console.log("")
  // Priority: errors first, then structural-no-result (H1), then outcome-of-
  // successful-recompute (H4/H5 — these are dominant because they reflect
  // what the pipeline ACTUALLY produced), then structural observations that
  // may or may not block matching (H3, H2). H3 is noteworthy but the cascade
  // vendor+date fallback can still produce on_contract without pricingItems,
  // so H4 wins when both are true.
  const confirmed =
    h6 ? "H6"
    : h1 ? "H1"
    : h4 ? "H4"
    : h5 ? "H5"
    : h3 ? "H3"
    : h2 ? "H2"
    : "other"

  let status = "DONE"
  if (h6) status = "DONE_WITH_CONCERNS"

  console.log(`- **Status:** ${status}`)
  console.log(`- **Hypothesis confirmed:** ${confirmed}`)
  console.log(`- **Distribution pre-recompute:** \`${fmtCounts(pre)}\``)
  console.log(`- **Distribution post-recompute:** \`${fmtCounts(post)}\``)
  console.log(
    `- **Recompute summary:** \`${summary ? JSON.stringify(summary) : "(error or null)"}\``,
  )

  let nextStep: string
  if (h6) {
    nextStep =
      "Fix the error surfaced in Step 4; the recompute is throwing and the pipeline never completes."
  } else if (h1) {
    nextStep =
      "Investigate facility linkage — the contract's facilityId/contractFacilities rows don't satisfy the `loadContractsForVendor` where-clause. Check whether this contract uses facilityId vs ContractFacility join rows and whether seed populated them."
  } else if (h3) {
    nextStep =
      "Investigate seed data — the contract has zero ContractPricing rows. The cascade's vendorItemNo map will be empty so every row falls to off_contract_item. Re-seed pricingItems or verify the seed loader populated them."
  } else if (h4) {
    nextStep =
      "Pipeline itself works. Dig into `lib/actions/cog-import.ts` (dynamic import at ~line 200) and `lib/actions/contracts.ts` (contract create/update/delete triggers) to find why recompute wasn't invoked after the Arthrex import / contract creation."
  } else if (h5) {
    nextStep =
      "Pipeline works but matches zero. Verify vendor attribution on the 163 COG rows (are Stryker-description rows wrongly tagged with the Arthrex vendorId?) and whether the COG rows' vendorItemNo values actually appear in the contract's pricingItems."
  } else if (h2) {
    nextStep =
      "Cascade path silently skips the contract because facilityIds array is empty. Fix the facility-linkage mapping in loadContractsForVendor or the underlying data."
  } else {
    nextStep =
      "No single hypothesis cleanly matched — cross-reference the loaded contract shape vs. pre/post counts and extend the probe."
  }
  console.log(`- **Next step:** ${nextStep}`)
  console.log("")
  console.log("_(Commit SHAs to be filled in after commit.)_")

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error("[probe-recompute-arthrex] fatal error:", err)
  await prisma.$disconnect()
  process.exit(1)
})
