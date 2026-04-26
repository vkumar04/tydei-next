/**
 * Charles audit suggestion #4 (v0-port) Phase 1 — one-time migration.
 *
 * Converts every Contract that uses the legacy single-item capital
 * shape (Contract.capitalCost > 0 with no ContractCapitalLineItem
 * rows) into a single ContractCapitalLineItem row built from the
 * contract-level fields. Idempotent — safe to re-run.
 *
 * Run: bun run scripts/migrate-capital-to-line-items.ts
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

async function main() {
  const candidates = await prisma.contract.findMany({
    where: {
      capitalCost: { gt: new Prisma.Decimal(0) },
      capitalLineItems: { none: {} },
    },
    select: {
      id: true,
      name: true,
      capitalCost: true,
      downPayment: true,
      interestRate: true,
      termMonths: true,
      paymentCadence: true,
      amortizationShape: true,
    },
  })

  console.log(`Found ${candidates.length} contract(s) with legacy capital fields and no line items.`)

  let created = 0
  let skipped = 0
  for (const c of candidates) {
    if (
      c.capitalCost == null ||
      c.interestRate == null ||
      c.termMonths == null
    ) {
      console.warn(`skip ${c.id} (${c.name}): missing required field`)
      skipped += 1
      continue
    }
    await prisma.contractCapitalLineItem.create({
      data: {
        contractId: c.id,
        description: c.name,
        contractTotal: c.capitalCost,
        initialSales: c.downPayment ?? new Prisma.Decimal(0),
        interestRate: c.interestRate,
        termMonths: c.termMonths,
        paymentType:
          c.amortizationShape === "custom" ? "variable" : "fixed",
        paymentCadence: c.paymentCadence ?? "monthly",
      },
    })
    created += 1
    console.log(`created line item for contract ${c.id} (${c.name})`)
  }

  console.log(
    `Done. Created ${created} line item(s); skipped ${skipped} contract(s) with missing fields.`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
