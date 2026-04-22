/**
 * diagnose-arthrex-cluster — Charles W2.A diagnostic.
 *
 * Given a contract id (or the demo-facility Arthrex contract auto-located
 * by vendor + totalValue + expiration), dumps the full state feeding the
 * contract-detail surfaces Charles flagged on 2026-04-22:
 *   - header card (Rebates Earned YTD / Collected lifetime / Current Spend)
 *   - On vs Off Contract Spend card
 *   - Transactions tab rebate totals
 *   - Contract list row metrics
 *
 * Usage:
 *   bun --env-file=.env scripts/diagnose-arthrex-cluster.ts \
 *     [--contractId=<id>] \
 *     > docs/superpowers/diagnostics/2026-04-22-w2a-arthrex-cluster.md
 *
 * Defaults to the Arthrex Arthroscopy - Lighthouse contract
 * (cmo6j6g34002sachllckth77b, $650K, Lighthouse Surgical Center) because
 * the $1.8M Arthrex contract Charles saw does not exist in the current
 * demo DB. Facility id defaults to cmo6j6fx70004achlf8fr82h2 (Lighthouse
 * Community Hospital) — CLAUDE.md's cmo4sbr8p0004wthl91ubwfwb is stale.
 */
import { prisma } from "@/lib/db"

const DEMO_FACILITY_ID = "cmo6j6fx70004achlf8fr82h2"
const DEFAULT_CONTRACT_ID = "cmo6j6g34002sachllckth77b"

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit?.slice(prefix.length)
}

async function resolveContractId(): Promise<string> {
  const explicit = parseArg("contractId")
  const candidateId = explicit ?? DEFAULT_CONTRACT_ID

  const row = await prisma.contract.findUnique({
    where: { id: candidateId },
    select: { id: true },
  })
  if (!row)
    throw new Error(
      `Contract ${candidateId} not found. Pass --contractId=<id> explicitly. ` +
        `(demo facility id assumed = ${DEMO_FACILITY_ID})`,
    )
  return row.id
}

async function main() {
  const contractId = await resolveContractId()
  console.log(`# Arthrex cluster diagnostic — ${contractId}\n`)
  console.log(`_Generated: ${new Date().toISOString()}_\n`)

  // ─── Section 1: Contract row ──────────────────────────────────────
  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      vendor: { select: { id: true, name: true } },
      terms: { include: { tiers: true } },
    },
  })

  console.log(`## 1. Contract row\n`)
  console.log("| field | value |")
  console.log("|---|---|")
  for (const [k, v] of Object.entries(contract)) {
    if (k === "terms" || k === "vendor") continue
    const display =
      v instanceof Date
        ? v.toISOString()
        : typeof v === "object" && v !== null
          ? JSON.stringify(v)
          : String(v)
    console.log(`| ${k} | ${display} |`)
  }
  console.log(
    `| vendor | ${contract.vendor?.name ?? "(null)"} (${contract.vendor?.id ?? "(null)"}) |`,
  )
  console.log()

  // ─── Section 2: Tiers (flattened across terms) ────────────────────
  const tiers = contract.terms.flatMap((term) =>
    term.tiers.map((tier) => ({
      termId: term.id,
      termName: term.termName,
      ...tier,
    })),
  )

  console.log(`## 2. Tiers (${tiers.length}) across ${contract.terms.length} term(s)\n`)
  console.log(
    "| termName | tierNumber | spendMin | spendMax | rebateType | rebateValue (raw) | rebateValue (×100 %) |",
  )
  console.log("|---|---:|---:|---:|---|---:|---:|")
  for (const t of tiers) {
    const raw = Number(t.rebateValue ?? 0)
    console.log(
      `| ${t.termName} | ${t.tierNumber} | ${Number(t.spendMin ?? 0)} | ${t.spendMax == null ? "—" : Number(t.spendMax)} | ${t.rebateType} | ${raw} | ${(raw * 100).toFixed(4)} |`,
    )
  }
  console.log()

  // ─── Section 3: Rebate rows ───────────────────────────────────────
  const rebates = await prisma.rebate.findMany({
    where: { contractId },
    orderBy: [{ payPeriodStart: "asc" }, { createdAt: "asc" }],
  })

  console.log(`## 3. Rebate rows (${rebates.length})\n`)
  console.log(
    "| payPeriodStart | payPeriodEnd | rebateEarned | rebateCollected | collectionDate | engineVersion | createdAt |",
  )
  console.log("|---|---|---:|---:|---|---|---|")
  for (const r of rebates) {
    console.log(
      `| ${r.payPeriodStart?.toISOString().slice(0, 10) ?? "—"} | ${r.payPeriodEnd?.toISOString().slice(0, 10) ?? "—"} | ${Number(r.rebateEarned ?? 0).toFixed(2)} | ${Number(r.rebateCollected ?? 0).toFixed(2)} | ${r.collectionDate?.toISOString().slice(0, 10) ?? "—"} | ${r.engineVersion ?? "—"} | ${r.createdAt.toISOString().slice(0, 10)} |`,
    )
  }
  console.log()

  // ─── Section 4: ContractPeriod rollups ────────────────────────────
  const periods = await prisma.contractPeriod.findMany({
    where: { contractId },
    orderBy: { periodStart: "asc" },
  })

  console.log(`## 4. ContractPeriod rollups (${periods.length})\n`)
  if (periods.length === 0) {
    console.log("_(none)_\n")
  } else {
    console.log(
      "| periodStart | periodEnd | totalSpend | rebateEarned | rebateCollected | tierAchieved |",
    )
    console.log("|---|---|---:|---:|---:|---:|")
    for (const p of periods) {
      console.log(
        `| ${p.periodStart?.toISOString().slice(0, 10) ?? "—"} | ${p.periodEnd?.toISOString().slice(0, 10) ?? "—"} | ${Number(p.totalSpend ?? 0).toFixed(2)} | ${Number(p.rebateEarned ?? 0).toFixed(2)} | ${Number(p.rebateCollected ?? 0).toFixed(2)} | ${p.tierAchieved ?? "—"} |`,
      )
    }
    console.log()
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
