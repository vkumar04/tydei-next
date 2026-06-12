/**
 * One-off purge for bugs.rtfd 2026-06-12: delete auto-accrual rows whose
 * writer prefix no longer matches the term's CURRENT type (term-type edits
 * left them behind pre-R1-fix). Mirrors exactly what the fixed
 * recomputeAccrualForContract wipe will do on its next run. Preserves
 * user-collected rows (collectionDate != null), same as the recompute.
 *
 * Usage: DATABASE_URL=<railway-public-url> bun scripts/purge-stale-writer-rows-0612.ts [--apply]
 */
import { prisma } from "@/lib/db"

const EXPECTED: Record<string, string[]> = {
  "[auto-threshold-accrual]": ["market_share", "compliance_rebate"],
  "[auto-volume-accrual]": ["volume_rebate", "rebate_per_use", "capitated_pricing_rebate"],
  "[auto-carve-out-accrual]": ["carve_out"],
  "[auto-po-accrual]": ["po_rebate"],
  "[auto-invoice-accrual]": ["payment_rebate"],
}

async function main() {
  const apply = process.argv.includes("--apply")
  const rows = await prisma.rebate.findMany({
    where: { notes: { contains: "-accrual]" } },
    select: { id: true, contractId: true, rebateEarned: true, collectionDate: true, notes: true },
  })
  const termIds = [...new Set(rows.map((r) => /term:(\w+)/.exec(r.notes ?? "")?.[1]).filter((x): x is string => !!x))]
  const terms = await prisma.contractTerm.findMany({ where: { id: { in: termIds } }, select: { id: true, termType: true } })
  const typeById = new Map(terms.map((t) => [t.id, t.termType]))

  const stale = rows.filter((r) => {
    const prefix = Object.keys(EXPECTED).find((p) => r.notes?.startsWith(p))
    const tid = /term:(\w+)/.exec(r.notes ?? "")?.[1]
    if (!prefix || !tid) return false
    const currentType = typeById.get(tid)
    const mismatch = !currentType || !EXPECTED[prefix]!.includes(currentType)
    return mismatch && r.collectionDate == null // preserve collected rows, like the recompute
  })

  console.log(`auto-accrual rows scanned: ${rows.length}; stale (prefix↔term-type mismatch, uncollected): ${stale.length}`)
  for (const r of stale) console.log(`  ${r.id} earned=${r.rebateEarned} :: ${(r.notes ?? "").slice(0, 100)}`)

  if (!apply) {
    console.log("\nDRY RUN — re-run with --apply to delete.")
    return
  }
  const res = await prisma.rebate.deleteMany({ where: { id: { in: stale.map((r) => r.id) } } })
  console.log(`\nDeleted ${res.count} rows.`)
}
main().finally(() => prisma.$disconnect())
