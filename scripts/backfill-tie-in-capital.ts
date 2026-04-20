/**
 * Charles W1.W-D3 — tie-in capital orphan report.
 *
 * Context: the one-shot W1.T migration (scripts/migrate-capital-to-
 * contract-level.ts) copied capital fields from the first non-null
 * ContractTerm onto the parent Contract row, then Phase 2 dropped the
 * per-term columns. Any tie-in contract that had NO term with a non-null
 * capital field at migration time — including contracts created *through*
 * the UI, which to this day has no capital input on the new-contract
 * form — lands in Phase 2 with every capital field NULL on Contract and
 * no per-term fallback to recover from.
 *
 * This script does NOT invent numbers. It prints a report of
 *   (a) tie-in contracts with missing capital fields, and
 *   (b) stand-alone contractType='capital' rows with missing capital fields,
 * so the user can re-enter capital in the edit form (see W1.W-D1 for the
 * new empty-state card and W1.W-D3 companion fix that adds a capital
 * card to the new-contract form so this can't happen again).
 *
 * Usage: `bun run scripts/backfill-tie-in-capital.ts`
 */
import { prisma } from "@/lib/db"

async function main() {
  const tieIns = await prisma.contract.findMany({
    where: { contractType: "tie_in" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      capitalCost: true,
      interestRate: true,
      termMonths: true,
      downPayment: true,
      paymentCadence: true,
      amortizationShape: true,
      facilityId: true,
      vendor: { select: { name: true } },
      _count: { select: { terms: true } },
    },
  })

  const capital = await prisma.contract.findMany({
    where: { contractType: "capital" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      capitalCost: true,
      interestRate: true,
      termMonths: true,
      downPayment: true,
      paymentCadence: true,
      amortizationShape: true,
      facilityId: true,
      vendor: { select: { name: true } },
      _count: { select: { terms: true } },
    },
  })

  type Row = (typeof tieIns)[number]
  const missingFields = (r: Row): string[] => {
    const missing: string[] = []
    if (r.capitalCost == null) missing.push("capitalCost")
    if (r.interestRate == null) missing.push("interestRate")
    if (r.termMonths == null) missing.push("termMonths")
    if (r.downPayment == null) missing.push("downPayment")
    if (r.paymentCadence == null) missing.push("paymentCadence")
    // amortizationShape has a default; don't report it as "missing".
    return missing
  }

  const tieInOrphans = tieIns.filter((c) => missingFields(c).length > 0)
  const capitalOrphans = capital.filter((c) => missingFields(c).length > 0)

  console.log(`\n=== Tie-in orphan report ===`)
  console.log(`Total tie-in contracts:          ${tieIns.length}`)
  console.log(`Tie-ins missing capital:         ${tieInOrphans.length}`)
  console.log(`Total contractType='capital':    ${capital.length}`)
  console.log(`'capital' contracts w/ no data:  ${capitalOrphans.length}\n`)

  if (tieInOrphans.length > 0) {
    console.log(`--- Tie-in contracts needing capital re-entry ---`)
    for (const c of tieInOrphans) {
      console.log(
        `  [tie-in] id=${c.id} vendor=${JSON.stringify(c.vendor.name)} name=${JSON.stringify(c.name)} terms=${c._count.terms} missing=${missingFields(c).join(",")}`,
      )
    }
  }
  if (capitalOrphans.length > 0) {
    console.log(`\n--- Stand-alone capital contracts needing capital re-entry ---`)
    for (const c of capitalOrphans) {
      console.log(
        `  [capital] id=${c.id} vendor=${JSON.stringify(c.vendor.name)} name=${JSON.stringify(c.name)} terms=${c._count.terms} missing=${missingFields(c).join(",")}`,
      )
    }
  }

  if (tieInOrphans.length === 0 && capitalOrphans.length === 0) {
    console.log(`No orphan capital rows. Nothing to re-enter.`)
    return
  }

  console.log(
    `\nNOTE: this script does NOT set capital values. Open each contract in the edit UI and fill the Capital Equipment card (contractType='tie_in'). For 'capital' rows with usage terms on them, switch the contract to 'tie_in' — per Charles's rule, capital + usage-style rebate terms on one contract = tie-in.`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
