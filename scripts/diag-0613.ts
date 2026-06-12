import { prisma } from "@/lib/db"
const ID = process.argv[2] ?? "cmqbcw4wd00040ypgudy9modb"
async function main() {
  const c = await prisma.contract.findUniqueOrThrow({
    where: { id: ID },
    include: { vendor: { select: { name: true } }, terms: { include: { tiers: { orderBy: { tierNumber: "asc" } } }, orderBy: { createdAt: "asc" } } },
  })
  console.log(`${c.name} [${c.contractType}] vendor=${c.vendor?.name} eff=${c.effectiveDate.toISOString().slice(0,10)}..${c.expirationDate.toISOString().slice(0,10)}`)
  for (const t of c.terms) {
    console.log(`term "${t.termName}" type=${t.termType} method=${t.rebateMethod} eval=${t.evaluationPeriod} appliesTo=${t.appliesTo} cats=${JSON.stringify(t.categories)}`)
    for (const x of t.tiers) console.log(`  T${x.tierNumber} spendMin=${x.spendMin} spendMax=${x.spendMax} volMin=${x.volumeMin} volMax=${x.volumeMax} msMin=${x.marketShareMin} msMax=${x.marketShareMax} value=${x.rebateValue} type=${x.rebateType}`)
  }
  const rebates = await prisma.rebate.findMany({ where: { contractId: ID }, select: { rebateEarned: true, payPeriodStart: true, payPeriodEnd: true, notes: true }, orderBy: { payPeriodStart: "asc" } })
  console.log(`rebate rows: ${rebates.length}`)
  for (const r of rebates) console.log(`  ${r.payPeriodStart?.toISOString().slice(0,10)}..${r.payPeriodEnd?.toISOString().slice(0,10)} $${r.rebateEarned} :: ${(r.notes ?? "").slice(0, 95)}`)
}
main().finally(() => prisma.$disconnect())
