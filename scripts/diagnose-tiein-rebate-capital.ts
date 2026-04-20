/**
 * Charles W1.Y-C diagnostic — tie-in rebate + capital snapshot.
 *
 * Dumps every tie-in contract's Rebate rows, capital fields, and the
 * output of `contractTypeEarnsRebates(contractType)`. Output is piped to
 * `docs/superpowers/diagnostics/2026-04-20-w1y-c-tiein.md` by the plan.
 */
import { prisma } from "@/lib/db"
import { contractTypeEarnsRebates } from "@/lib/contract-definitions"

async function main() {
  const contracts = await prisma.contract.findMany({
    where: { contractType: "tie_in" },
    include: { rebates: true, terms: { include: { tiers: true } } },
  })
  console.log("# Tie-in diagnostic (W1.Y-C)\n")
  console.log(`Total tie-in contracts: ${contracts.length}\n`)
  for (const c of contracts) {
    console.log(`## ${c.name} (${c.id})\n`)
    console.log(`- contractType: ${c.contractType}`)
    console.log(
      `- contractTypeEarnsRebates: ${contractTypeEarnsRebates(c.contractType)}`,
    )
    console.log(`- capitalCost: ${c.capitalCost}`)
    console.log(`- interestRate: ${c.interestRate}`)
    console.log(`- termMonths: ${c.termMonths}`)
    console.log(`- paymentCadence: ${c.paymentCadence}`)
    console.log(`- terms: ${c.terms.length} (with tiers: ${c.terms.filter((t) => t.tiers.length > 0).length})`)
    console.log(`- rebates (count=${c.rebates.length}):`)
    let totalEarned = 0
    let totalCollected = 0
    for (const r of c.rebates) {
      const e = Number(r.rebateEarned)
      const co = Number(r.rebateCollected)
      totalEarned += e
      totalCollected += co
      console.log(
        `  - ${r.id}: earned=$${e}, collected=$${co}, collectionDate=${r.collectionDate?.toISOString().slice(0, 10) ?? "-"}, payPeriodEnd=${r.payPeriodEnd?.toISOString().slice(0, 10) ?? "-"}, notes="${r.notes ?? ""}"`,
      )
    }
    console.log(
      `- totals: earned=$${totalEarned}, collected=$${totalCollected}\n`,
    )
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
