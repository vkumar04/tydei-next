/**
 * Backfill existing tie-in contracts that have no ContractCapitalLineItem
 * rows. Without these, the amortization card renders empty and rebate-
 * applied-to-capital pays into the void. This is a one-shot — once run,
 * subsequent runs are no-ops.
 */
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

async function main() {
  const tieIns = await prisma.contract.findMany({
    where: { contractType: "tie_in" },
    include: { capitalLineItems: true },
  })

  // Cleanup: drop any leftover PROBE contracts from earlier validation.
  const probes = tieIns.filter((c) => c.name.startsWith("PROBE "))
  for (const c of probes) {
    await prisma.contract.delete({ where: { id: c.id } })
    console.log(`✗ deleted leftover ${c.name}`)
  }

  // Backfill: for any real tie-in with 0 capital line items, seed one
  // sensible default item. The user can then go edit and adjust.
  const needsCapital = tieIns.filter(
    (c) => !c.name.startsWith("PROBE ") && c.capitalLineItems.length === 0,
  )
  for (const c of needsCapital) {
    await prisma.contractCapitalLineItem.create({
      data: {
        contractId: c.id,
        description: `${c.name} — capital placeholder (edit to set real values)`,
        itemNumber: null,
        serialNumber: null,
        contractTotal: new Prisma.Decimal(c.totalValue ?? 0),
        initialSales: new Prisma.Decimal(0),
        interestRate: new Prisma.Decimal(0.04),
        termMonths: 60,
        paymentType: "fixed",
        paymentCadence: "quarterly",
      },
    })
    console.log(`✓ ${c.name}: seeded placeholder capital line item ($${c.totalValue ?? 0})`)
  }

  if (probes.length === 0 && needsCapital.length === 0) {
    console.log("nothing to backfill")
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
