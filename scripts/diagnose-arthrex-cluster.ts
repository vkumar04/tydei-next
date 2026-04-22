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

  // Sections 1–8 land here in subsequent tasks.

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
