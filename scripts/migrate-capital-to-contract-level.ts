/**
 * Charles W1.T — one-shot migration: copy tie-in capital fields from the
 * first non-null ContractTerm to the parent Contract row.
 *
 * Run once, after Phase 1 adds the new Contract columns but before Phase 2
 * drops the per-term columns.
 */
import { prisma } from "@/lib/db"

async function main() {
  const contracts = await prisma.contract.findMany({
    where: { terms: { some: { capitalCost: { not: null } } } },
    include: {
      terms: {
        where: { capitalCost: { not: null } },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  let migrated = 0
  let multiCapital = 0

  for (const c of contracts) {
    const src = c.terms[0]
    if (!src) continue
    if (c.terms.length > 1) {
      multiCapital++
      console.warn(
        `[multi-capital] contract=${c.id} has ${c.terms.length} capital terms — using first (${src.id})`,
      )
    }
    await prisma.contract.update({
      where: { id: c.id },
      data: {
        capitalCost: src.capitalCost,
        interestRate: src.interestRate,
        termMonths: src.termMonths,
        downPayment: src.downPayment,
        paymentCadence: src.paymentCadence,
        amortizationShape: src.amortizationShape,
      },
    })
    migrated++
    console.log(
      `[migrated] contract=${c.id} capitalCost=${src.capitalCost} interestRate=${src.interestRate} termMonths=${src.termMonths} downPayment=${src.downPayment} paymentCadence=${src.paymentCadence} amortizationShape=${src.amortizationShape}`,
    )
  }

  // Dedupe ContractAmortizationSchedule rows that would become orphaned
  // by dropping termId: keep the row with the earliest createdAt per
  // (contractId, periodNumber) and delete duplicates. Safe to run
  // idempotently since we key on (contractId, periodNumber).
  const allRows = await prisma.contractAmortizationSchedule.findMany({
    orderBy: [{ contractId: "asc" }, { periodNumber: "asc" }, { createdAt: "asc" }],
    select: { id: true, contractId: true, periodNumber: true },
  })
  const seen = new Set<string>()
  const toDelete: string[] = []
  for (const r of allRows) {
    const k = `${r.contractId}::${r.periodNumber}`
    if (seen.has(k)) {
      toDelete.push(r.id)
    } else {
      seen.add(k)
    }
  }
  if (toDelete.length > 0) {
    await prisma.contractAmortizationSchedule.deleteMany({
      where: { id: { in: toDelete } },
    })
  }

  console.log(
    `\nMigrated capital for ${migrated} contracts (${multiCapital} with multiple capital terms; first term used). Deduped ${toDelete.length} amortization rows.`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
