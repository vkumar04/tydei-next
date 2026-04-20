/**
 * diagnose-off-contract-spend — Charles W1.X-C diagnostic
 *
 * Given a contract id, classify the COG rows that feed the
 * `getOffContractSpend` aggregate by `matchStatus`. Writes a
 * markdown breakdown to stdout so a human can decide whether the
 * `Off Contract` bucket represents genuine leakage, un-enriched
 * same-vendor rows, or a reducer bug.
 *
 * Usage:
 *   bun --env-file=.env scripts/diagnose-off-contract-spend.ts <contractId>
 *     > docs/superpowers/diagnostics/2026-04-20-w1x-c-off-contract.md
 */
import { prisma } from "@/lib/db"

async function main() {
  const contractId = process.argv[2]
  if (!contractId)
    throw new Error(
      "Usage: bun scripts/diagnose-off-contract-spend.ts <contractId>",
    )

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    select: {
      id: true,
      name: true,
      vendorId: true,
      facilityId: true,
      totalValue: true,
    },
  })

  const scopeOR = [
    { contractId: contract.id },
    { contractId: null, vendorId: contract.vendorId },
  ]

  const breakdown = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: { facilityId: contract.facilityId ?? undefined, OR: scopeOR },
    _sum: { extendedPrice: true },
    _count: { _all: true },
  })

  const top = await prisma.cOGRecord.findMany({
    where: { facilityId: contract.facilityId ?? undefined, OR: scopeOR },
    orderBy: { extendedPrice: "desc" },
    take: 20,
    select: {
      id: true,
      vendorItemNo: true,
      inventoryDescription: true,
      extendedPrice: true,
      matchStatus: true,
      transactionDate: true,
      contractId: true,
      vendorId: true,
    },
  })

  console.log(`# Off-contract diagnostic — ${contract.name} (${contract.id})\n`)
  console.log(`- Vendor: ${contract.vendorId}`)
  console.log(`- Facility: ${contract.facilityId}`)
  console.log(`- Contract totalValue: $${Number(contract.totalValue ?? 0).toFixed(0)}\n`)
  console.log(`## By matchStatus\n`)
  console.log("| matchStatus | count | sum spend |")
  console.log("|---|---:|---:|")
  for (const b of breakdown) {
    console.log(
      `| ${b.matchStatus} | ${b._count._all} | $${Number(b._sum?.extendedPrice ?? 0).toFixed(0)} |`,
    )
  }
  console.log(`\n## Top 20 rows in scope\n`)
  console.log(
    "| vendorItem | desc | contractId | vendorId | matchStatus | spend | date |",
  )
  console.log("|---|---|---|---|---|---:|---|")
  for (const r of top) {
    console.log(
      `| ${r.vendorItemNo ?? ""} | ${(r.inventoryDescription ?? "").slice(0, 40)} | ${r.contractId ?? "(null)"} | ${r.vendorId ?? "(null)"} | ${r.matchStatus} | $${Number(r.extendedPrice).toFixed(0)} | ${r.transactionDate?.toISOString().slice(0, 10) ?? ""} |`,
    )
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
