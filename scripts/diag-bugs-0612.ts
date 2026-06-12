import { prisma } from "@/lib/db"
async function main() {
  const fac = await prisma.facility.findFirst({ where: { name: "Lighthouse Surgical Center" }, select: { id: true, name: true } })
  if (!fac) throw new Error("facility missing")
  // All contracts w/ market_share, volume_rebate, or carve_out terms at the facility
  const contracts = await prisma.contract.findMany({
    where: { facilityId: fac.id, terms: { some: { termType: { in: ["market_share", "volume_rebate", "carve_out"] } } } },
    select: {
      id: true, name: true, contractType: true, vendorId: true,
      vendor: { select: { name: true } },
      terms: { select: { id: true, termType: true, rebateMethod: true, evaluationPeriod: true, appliesTo: true, categories: true, cptCodes: true,
        tiers: { select: { tierNumber: true, spendMin: true, spendMax: true, volumeMin: true, volumeMax: true, marketShareMin: true, marketShareMax: true, rebateValue: true, rebateType: true }, orderBy: { tierNumber: "asc" } } } },
    },
  })
  for (const c of contracts) {
    console.log(`\n=== ${c.name} [${c.contractType}] vendor=${c.vendor?.name} id=${c.id}`)
    for (const t of c.terms) {
      console.log(`  term ${t.termType} method=${t.rebateMethod} eval=${t.evaluationPeriod} appliesTo=${t.appliesTo} cats=${JSON.stringify(t.categories)} cpt=${Array.isArray(t.cptCodes) ? (t.cptCodes as unknown[]).length : t.cptCodes}`)
      for (const tier of t.tiers) {
        console.log(`    T${tier.tierNumber} spendMin=${tier.spendMin} spendMax=${tier.spendMax} volMin=${tier.volumeMin} volMax=${tier.volumeMax} msMin=${tier.marketShareMin} msMax=${tier.marketShareMax} rebateValue=${tier.rebateValue} type=${tier.rebateType}`)
      }
      // persisted auto-accrual rows for this term
      const rebates = await prisma.rebate.findMany({
        where: { contractId: c.id, notes: { contains: t.id } },
        select: { rebateEarned: true, payPeriodStart: true, payPeriodEnd: true, notes: true },
        orderBy: { payPeriodEnd: "asc" }, take: 12,
      })
      for (const r of rebates) console.log(`      rebate ${r.payPeriodStart?.toISOString().slice(0,10)}..${r.payPeriodEnd?.toISOString().slice(0,10)} earned=${r.rebateEarned} notes=${(r.notes ?? "").slice(0, 110)}`)
    }
  }
}
main().finally(() => prisma.$disconnect())
