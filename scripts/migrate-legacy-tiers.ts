/**
 * One-shot migration: backfill legacy `percent_of_spend` tiers on
 * count-/threshold-based termTypes to `fixed_rebate` with sensible
 * dollar values. Mirrors the seed update so existing dev DBs reflect
 * the same shape as a fresh `bun run db:seed`.
 */
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"

const NON_PERCENT_TERM_TYPES = [
  "volume_rebate",
  "rebate_per_use",
  "capitated_pricing_rebate",
  "market_share",
  "compliance_rebate",
  "fixed_fee",
  "payment_rebate",
  "po_rebate",
] as const

// Hardcoded mapping for the 7 known seed rows. For everything else we
// fall back to `value × 100` so a 0.02 (2%) becomes $2 — which keeps
// the legacy threshold-writer math but explicitly stamps it as fixed_rebate
// so future audits see the right shape.
const SEED_OVERRIDES: Record<string, Record<number, number>> = {
  "Joint Implant Commitment": { 1: 10_000, 2: 17_500 },
  "Capital Coverage": { 1: 7_500, 2: 12_500 },
  "Market Share Pricing": { 1: 5_000, 2: 12_500, 3: 25_000 },
}

async function main() {
  const drift = await prisma.contractTier.findMany({
    where: {
      rebateType: "percent_of_spend",
      term: {
        termType: { in: NON_PERCENT_TERM_TYPES as unknown as string[] },
      },
    },
    include: { term: { select: { id: true, termName: true, termType: true } } },
  })
  console.log(`Found ${drift.length} drifted tiers to migrate`)

  for (const t of drift) {
    const overrideForTerm = SEED_OVERRIDES[t.term.termName]
    const dollarValue =
      overrideForTerm?.[t.tierNumber] ?? Number(t.rebateValue) * 100
    await prisma.contractTier.update({
      where: { id: t.id },
      data: {
        rebateType: "fixed_rebate",
        rebateValue: new Prisma.Decimal(dollarValue),
      },
    })
    console.log(
      `  ✓ ${t.term.termName} (${t.term.termType}) tier ${t.tierNumber}: ${Number(t.rebateValue)} → $${dollarValue} fixed_rebate`,
    )
  }

  console.log(`\nDone — ${drift.length} tier(s) migrated.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
