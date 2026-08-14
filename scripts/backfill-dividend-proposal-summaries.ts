/**
 * Recompute the denormalized headline columns on DividendProposal from each
 * row's stored payload, using the shipped canonical helper.
 *
 * Nothing reads those columns any more (listDividendProposals derives them on
 * read), so this is hygiene: it keeps ad-hoc SQL, exports and future analytics
 * agreeing with the app. Idempotent — the summary is a pure function of the
 * payload. Dry run by default; pass --apply to write.
 *
 *   bun scripts/backfill-dividend-proposal-summaries.ts
 *   bun scripts/backfill-dividend-proposal-summaries.ts --apply
 */
import { prisma } from "@/lib/db"
import { resolveDividendProposalSummary } from "@/lib/financial-analysis/dividend-proposal-summary"

const APPLY = process.argv.includes("--apply")

async function main() {
  const rows = await prisma.dividendProposal.findMany({
    select: {
      id: true,
      name: true,
      vendorId: true,
      verdict: true,
      annualDividendImpact: true,
      netPresentValue: true,
      paybackYears: true,
      noiImpact: true,
      payload: true,
    },
    orderBy: { updatedAt: "desc" },
  })

  // Compare every column the script writes: a change confined to, say, the
  // discount rate moves netPresentValue without moving the verdict or the
  // dividend, and a two-column check would skip the row.
  const same = (a: number | null, b: number) => Math.abs((a ?? 0) - b) <= 0.005

  let changed = 0
  let unchanged = 0
  const unparseable: { id: string; name: string }[] = []

  for (const row of rows) {
    const summary = resolveDividendProposalSummary(row.payload)
    if (!summary) {
      unparseable.push({ id: row.id, name: row.name })
      continue
    }

    const drifted =
      row.verdict !== summary.verdict ||
      !same(row.annualDividendImpact, summary.annualDividendImpact) ||
      !same(row.netPresentValue, summary.netPresentValue) ||
      !same(row.noiImpact, summary.noiImpact) ||
      (row.paybackYears ?? null) !== summary.paybackYears

    if (!drifted) {
      unchanged++
      continue
    }

    changed++
    console.log(
      `${APPLY ? "UPDATE" : "WOULD UPDATE"}  ${row.id}  ${row.name}\n` +
        `    verdict  ${row.verdict} → ${summary.verdict}\n` +
        `    dividend ${row.annualDividendImpact} → ${summary.annualDividendImpact}`,
    )

    if (APPLY) {
      await prisma.dividendProposal.update({
        where: { id: row.id },
        data: {
          verdict: summary.verdict,
          annualDividendImpact: summary.annualDividendImpact,
          netPresentValue: summary.netPresentValue,
          paybackYears: summary.paybackYears,
          noiImpact: summary.noiImpact,
        },
      })
    }
  }

  console.log(
    `\n${rows.length} proposals · ${changed} drifted · ${unchanged} already current · ` +
      `${unparseable.length} unparseable`,
  )
  if (unparseable.length > 0) {
    console.log(
      `\nThese render "Figures unavailable" until re-saved in the Dividend/DCF tab:`,
    )
    for (const u of unparseable) console.log(`  ${u.id}  ${u.name}`)
  }
  if (!APPLY && changed > 0) console.log(`\nRe-run with --apply to write.`)
}

main().finally(() => prisma.$disconnect())
