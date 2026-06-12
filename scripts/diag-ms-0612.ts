import { prisma } from "@/lib/db"
async function main() {
  const ms = await prisma.contractTerm.findMany({
    where: { termType: "market_share" },
    select: { id: true, contract: { select: { name: true, facility: { select: { name: true } } } } },
  })
  console.log("market_share terms in prod:", ms.length)
  for (const t of ms) console.log(` - ${t.contract.name} @ ${t.contract.facility?.name}`)
  // stale-row audit: every auto-accrual row whose prefix mismatches its term's current type, or term deleted
  const rows = await prisma.rebate.findMany({
    where: { notes: { contains: "-accrual]" } },
    select: { id: true, contractId: true, rebateEarned: true, notes: true },
  })
  const termIds = [...new Set(rows.map(r => /term:(\w+)/.exec(r.notes ?? "")?.[1]).filter((x): x is string => !!x))]
  const terms = await prisma.contractTerm.findMany({ where: { id: { in: termIds } }, select: { id: true, termType: true } })
  const typeById = new Map(terms.map(t => [t.id, t.termType]))
  const expected: Record<string, string[]> = {
    "[auto-threshold-accrual]": ["market_share", "compliance_rebate"],
    "[auto-volume-accrual]": ["volume_rebate", "rebate_per_use", "capitated_pricing_rebate"],
    "[auto-carve-out-accrual]": ["carve_out"],
    "[auto-po-accrual]": ["po_rebate"],
    "[auto-invoice-accrual]": ["payment_rebate"],
  }
  let stale = 0, orphan = 0
  for (const r of rows) {
    const prefix = Object.keys(expected).find(p => r.notes?.startsWith(p))
    const tid = /term:(\w+)/.exec(r.notes ?? "")?.[1]
    if (!tid || !prefix) continue
    const t = typeById.get(tid)
    if (!t) { orphan++; console.log(`ORPHAN (term deleted): ${r.notes?.slice(0, 90)} earned=${r.rebateEarned}`) }
    else if (!expected[prefix]!.includes(t)) { stale++; console.log(`STALE (term now ${t}): ${r.notes?.slice(0, 90)} earned=${r.rebateEarned}`) }
  }
  console.log(`\ntotal auto-accrual rows=${rows.length}, stale=${stale}, orphaned=${orphan}`)
}
main().finally(() => prisma.$disconnect())
