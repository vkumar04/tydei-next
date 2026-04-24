/**
 * One-time migration: convert `ContractTerm.categories` from IDs to names.
 *
 * Historical write paths stored `ProductCategory.id` values into the
 * `categories` column. Every downstream reader (buildCategoryWhereClause,
 * accrual engine, match) compares against `COGRecord.category` which
 * stores NAMES, so scoped terms matched zero rows. The write paths are
 * now fixed (resolveCategoryIdsToNames); this script cleans up existing
 * rows.
 *
 * Usage:
 *   # dry-run (default): reports what would change
 *   DATABASE_URL=... bun scripts/migrate-term-categories-ids-to-names.ts
 *   # apply:
 *   DATABASE_URL=... APPLY=1 bun scripts/migrate-term-categories-ids-to-names.ts
 *
 * Safe to re-run — rows already holding names pass through unchanged.
 */
import { prisma } from "@/lib/db"

const APPLY = process.env.APPLY === "1"

async function main() {
  console.log(`# ContractTerm.categories migration  —  mode=${APPLY ? "APPLY" : "DRY-RUN"}`)
  console.log()

  // Only care about terms that actually have entries in `categories`.
  const terms = await prisma.contractTerm.findMany({
    where: { categories: { isEmpty: false } },
    select: { id: true, termName: true, appliesTo: true, categories: true, contractId: true },
  })
  console.log(`Inspecting ${terms.length} terms with non-empty categories`)

  // Collect all unique values across all terms, so we can resolve in one query
  const all = new Set<string>()
  for (const t of terms) for (const c of t.categories) all.add(c)
  const categoryRows = await prisma.productCategory.findMany({
    where: { id: { in: [...all] } },
    select: { id: true, name: true },
  })
  const idToName = new Map(categoryRows.map((r) => [r.id, r.name] as const))

  let wouldChange = 0
  let alreadyClean = 0
  for (const t of terms) {
    const hasAnyId = t.categories.some((v) => idToName.has(v))
    if (!hasAnyId) {
      alreadyClean++
      continue
    }
    const resolved = t.categories.map((v) => idToName.get(v) ?? v)
    const changed = resolved.some((r, i) => r !== t.categories[i])
    if (!changed) {
      alreadyClean++
      continue
    }
    wouldChange++
    console.log(`  ${t.id}  "${t.termName}"  (contract ${t.contractId})`)
    console.log(`    before: ${JSON.stringify(t.categories)}`)
    console.log(`    after:  ${JSON.stringify(resolved)}`)
    if (APPLY) {
      await prisma.contractTerm.update({
        where: { id: t.id },
        data: { categories: resolved },
      })
    }
  }

  console.log()
  console.log(`Summary: ${alreadyClean} already-clean, ${wouldChange} would change${APPLY ? " (APPLIED)" : " (dry-run, no writes)"}`)
  await prisma.$disconnect()
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
