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
import {
  sumEarnedRebatesLifetime,
  sumEarnedRebatesYTD,
} from "@/lib/contracts/rebate-earned-filter"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"

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

  // ─── Section 5: COG rows by matchStatus (lifetime) ────────────────
  const scopeOR = [
    { contractId: contract.id },
    { contractId: null, vendorId: contract.vendorId },
  ]
  const cogWhere = {
    facilityId: contract.facilityId ?? undefined,
    OR: scopeOR,
  }

  const cogByStatus = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: cogWhere,
    _sum: { extendedPrice: true },
    _count: { _all: true },
  })

  console.log(`## 5. COG rows in contract+same-vendor scope (lifetime)\n`)
  console.log("| matchStatus | count | sum extendedPrice |")
  console.log("|---|---:|---:|")
  for (const b of cogByStatus) {
    console.log(
      `| ${b.matchStatus ?? "(null)"} | ${b._count._all} | ${Number(b._sum?.extendedPrice ?? 0).toFixed(2)} |`,
    )
  }
  console.log()

  const top = await prisma.cOGRecord.findMany({
    where: cogWhere,
    orderBy: { extendedPrice: "desc" },
    take: 15,
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

  console.log(`### Top 15 rows by extendedPrice\n`)
  console.log(
    "| vendorItem | desc (40ch) | contractId | matchStatus | spend | txnDate |",
  )
  console.log("|---|---|---|---|---:|---|")
  for (const r of top) {
    console.log(
      `| ${r.vendorItemNo ?? ""} | ${(r.inventoryDescription ?? "").slice(0, 40)} | ${r.contractId ? r.contractId.slice(0, 8) + "…" : "(null)"} | ${r.matchStatus} | ${Number(r.extendedPrice ?? 0).toFixed(2)} | ${r.transactionDate?.toISOString().slice(0, 10) ?? ""} |`,
    )
  }
  console.log()

  // ─── Section 6: COG trailing-12-months slice ──────────────────────
  const trailingStart = new Date()
  trailingStart.setFullYear(trailingStart.getFullYear() - 1)

  const cogByStatus12mo = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: { ...cogWhere, transactionDate: { gte: trailingStart } },
    _sum: { extendedPrice: true },
    _count: { _all: true },
  })

  console.log(
    `## 6. COG trailing-12-months (since ${trailingStart.toISOString().slice(0, 10)})\n`,
  )
  console.log("| matchStatus | count | sum extendedPrice |")
  console.log("|---|---:|---:|")
  for (const b of cogByStatus12mo) {
    console.log(
      `| ${b.matchStatus ?? "(null)"} | ${b._count._all} | ${Number(b._sum?.extendedPrice ?? 0).toFixed(2)} |`,
    )
  }
  console.log()

  // ─── Section 7: Canonical-helper readouts ─────────────────────────
  console.log(`## 7. Canonical-helper readouts (Prisma-direct)\n`)
  const earnedYTD = sumEarnedRebatesYTD(rebates)
  const earnedLifetime = sumEarnedRebatesLifetime(rebates)
  const collectedLifetime = sumCollectedRebates(rebates)

  console.log("| metric | value |")
  console.log("|---|---:|")
  console.log(`| sumEarnedRebatesYTD(rebates) | ${earnedYTD.toFixed(2)} |`)
  console.log(
    `| sumEarnedRebatesLifetime(rebates) | ${earnedLifetime.toFixed(2)} |`,
  )
  console.log(
    `| sumCollectedRebates(rebates) | ${collectedLifetime.toFixed(2)} |`,
  )
  console.log()

  // ─── Section 8: Reconciliation notes ──────────────────────────────
  console.log(`## 8. Reconciliation notes\n`)
  console.log(`- Rebate rows found: **${rebates.length}**`)
  console.log(
    `- Rebate rows with collectionDate set: **${rebates.filter((r) => r.collectionDate).length}**`,
  )
  console.log(
    `- Sum of raw rebateEarned over all rows: **$${rebates.reduce((s, r) => s + Number(r.rebateEarned ?? 0), 0).toFixed(2)}**`,
  )
  console.log(
    `- Sum via sumEarnedRebatesLifetime (filters to payPeriodEnd <= today): **$${earnedLifetime.toFixed(2)}**`,
  )
  console.log(
    `- Sum via sumEarnedRebatesYTD (filters to current year closed periods): **$${earnedYTD.toFixed(2)}**`,
  )
  console.log(
    `- Sum via sumCollectedRebates (requires collectionDate set): **$${collectedLifetime.toFixed(2)}**`,
  )
  console.log()
  console.log(`### Screenshots Charles sent (for cross-check)\n`)
  console.log(`- Header "Rebates Earned (YTD)" displayed: **$0**`)
  console.log(`- Header "Rebates Collected (lifetime)" displayed: **$0**`)
  console.log(
    `- Header "Current Spend (Last 12 Months)" displayed: **$0** on first load, **$1,559,528** on reload`,
  )
  console.log(`- On/Off card: **$0 On**, **$3,389,667 Not Priced**`)
  console.log(
    `- Transactions tab "Total Rebates (lifetime)" displayed: **$639,390**`,
  )
  console.log(
    `- Transactions tab period rows: Dec 31 2023–Dec 30 2024 earned **$319,865**; Dec 31 2024–Dec 30 2025 earned **$319,525**`,
  )
  console.log()
  console.log(`### Flags to verify by eye\n`)
  console.log(
    `1. Does **section 5 on_contract count > 0**? If 0, bug (1) confirmed at matcher level.`,
  )
  console.log(
    `2. Does **section 7 sumEarnedRebatesLifetime ≈ $639,390**? If yes → header card is wrong; if no → Transactions tab is wrong.`,
  )
  console.log(
    `3. Does **section 3 rebateEarned** for each row equal **\`tier.target * tier.rebateValue\`** within $1? If yes, rebate-engine fabrication (bug 4) confirmed.`,
  )
  console.log(
    `4. Do **section 2 tier rebateValue (raw)** values fit in (0, 1)? If any ≥ 1, rebate-units bug (already fixed in principle by Charles W1.R — confirm no regression).`,
  )
  console.log(
    `5. **Bug (2) flicker** is NOT visible here — this is a server-side read. If sections 5/6 and the canonical helpers are stable across two runs, the flicker is a client/cache issue.`,
  )
  console.log()

  // ─── Schema notes (this run, per Vick's corrections) ─────────────
  console.log(`## Schema notes\n`)
  console.log(
    `- **Facility-id correction:** CLAUDE.md's \`cmo4sbr8p0004wthl91ubwfwb\` is stale. The actual Lighthouse Community Hospital id in the current demo DB is \`cmo6j6fx70004achlf8fr82h2\`. Note also that the Arthrex contract below lives at \`${contract.facilityId}\` (Lighthouse Surgical Center), not Lighthouse Community Hospital.`,
  )
  console.log(
    `- **Contract-id fallback:** The $1.8M Arthrex contract Charles saw does not exist in the current demo DB. This run defaults to the \`$650K Arthrex Arthroscopy - Lighthouse\` contract (\`${contract.id}\`) which is populated with 1 term / 3 tiers / ${rebates.length} rebates / ${periods.length} periods — enough to reproduce the header-vs-tab drift.`,
  )
  console.log(
    `- **ContractTier schema:** tiers are reached via \`ContractTerm\` (not a direct \`contract.tiers\` relation). Plan's \`include: { tiers: true }\` was corrected to \`include: { terms: { include: { tiers: true } } }\` and tiers are flattened across terms in code.`,
  )
  console.log(
    `- **Tier field names:** actual fields are \`tierNumber\`, \`spendMin\`, \`spendMax\`, \`rebateType\`, \`rebateValue\` — NOT the plan's \`tierIndex\`, \`baseline\`, \`target\`, \`rebateKind\`.`,
  )
  console.log(
    `- **Rebate field names:** actual fields are \`rebateEarned\` / \`rebateCollected\` — NOT the plan's \`amountEarned\` / \`collectedAmount\`.`,
  )
  console.log(
    `- **ContractPeriod field names:** actual fields are \`totalSpend\`, \`rebateEarned\`, \`rebateCollected\`, \`tierAchieved\` — NOT the plan's \`spend\` / \`tierHit\`.`,
  )
  console.log(
    `- **COGRecord.matchConfidence:** column does not exist on the model; omitted from the top-15 select in section 5.`,
  )
  console.log()

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
