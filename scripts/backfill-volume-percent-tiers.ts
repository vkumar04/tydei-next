/**
 * Backfill volume_rebate tiers that the form's old self-heal effect
 * silently corrupted from `percent_of_spend` (fraction, 0.10 = 10%)
 * into `fixed_rebate` (rebateValue × 100, so 10.0).
 *
 * Context: see commit 4be1eb1 (form self-heal fix). The bug ran on
 * every form open between bug #17 (re-enabling % of Spend on the
 * tier picker) and 2026-05-17 (today). Any term whose user picked
 * "% of Spend" got rebateType silently flipped + rebateValue × 100.
 *
 * Heuristic for "this was probably corrupted":
 *   - Term.termType = "volume_rebate"
 *   - Tier.rebateType = "fixed_rebate"
 *   - Tier.rebateValue ∈ (0, 100]   ← a true flat $/period almost
 *     never lives in this range (real flat rebates are $1K+ per
 *     period). And our × 100 conversion of a fraction in (0, 1]
 *     lands in (0, 100].
 *   - Tier.rebateValue is a whole-percent OR half-percent value
 *     (i.e. rebateValue × 2 is a whole number). E.g. 10.0, 2.5,
 *     12.0 → likely corrupted from 10%, 2.5%, 12%. 7.3 → less
 *     confident (humans rarely pick 7.3% as a rebate rate; could
 *     be a legit $7.30 flat).
 *
 * Default DRY RUN: prints candidates with contract name, term name,
 * tier #, current value, and proposed (rebateValue ÷ 100). Pass
 * `--apply` to actually write.
 *
 * Usage:
 *   bun run scripts/backfill-volume-percent-tiers.ts             # dry-run
 *   bun run scripts/backfill-volume-percent-tiers.ts --apply     # write
 *   bun run scripts/backfill-volume-percent-tiers.ts --strict    # only whole-percent candidates
 */
import { prisma } from "@/lib/db"

const APPLY = process.argv.includes("--apply")
const STRICT = process.argv.includes("--strict")

interface Candidate {
  contractId: string
  name: string | null
  facilityName: string
  vendorName: string
  termId: string
  termName: string | null
  tierId: string
  tierNumber: number
  currentValue: number
  proposedValue: number
  proposedPercentLabel: string
  confidence: "high" | "medium"
}

function looksCorrupted(rebateValue: number): { ok: boolean; confidence: "high" | "medium" } | null {
  if (rebateValue <= 0 || rebateValue > 100) return null
  const doubled = rebateValue * 2
  const isWholeOrHalfPercent = Math.abs(doubled - Math.round(doubled)) < 1e-9
  if (!isWholeOrHalfPercent) return null
  const isWholePercent = Math.abs(rebateValue - Math.round(rebateValue)) < 1e-9
  return { ok: true, confidence: isWholePercent ? "high" : "medium" }
}

async function main() {
  const terms = await prisma.contractTerm.findMany({
    where: { termType: "volume_rebate" },
    select: {
      id: true,
      termName: true,
      contract: {
        select: {
          id: true,
          name: true,
          facility: { select: { name: true } },
          vendor: { select: { name: true } },
        },
      },
      tiers: {
        select: {
          id: true,
          tierNumber: true,
          rebateType: true,
          rebateValue: true,
        },
      },
    },
  })

  const candidates: Candidate[] = []
  for (const term of terms) {
    for (const tier of term.tiers) {
      if (tier.rebateType !== "fixed_rebate") continue
      const v = Number(tier.rebateValue)
      const verdict = looksCorrupted(v)
      if (!verdict) continue
      if (STRICT && verdict.confidence !== "high") continue
      const proposed = v / 100
      candidates.push({
        contractId: term.contract.id,
        name: term.contract.name,
        facilityName: term.contract.facility?.name ?? "(unknown facility)",
        vendorName: term.contract.vendor?.name ?? "(unknown vendor)",
        termId: term.id,
        termName: term.termName,
        tierId: tier.id,
        tierNumber: tier.tierNumber,
        currentValue: v,
        proposedValue: proposed,
        proposedPercentLabel: `${(proposed * 100).toFixed(2)}%`,
        confidence: verdict.confidence,
      })
    }
  }

  if (candidates.length === 0) {
    console.log("[backfill] No corrupted volume_rebate tiers detected.")
    return
  }

  console.log(
    `[backfill] Found ${candidates.length} candidate tier(s) across ${new Set(candidates.map((c) => c.contractId)).size} contract(s).${STRICT ? " (strict: whole-percent only)" : ""}`,
  )
  console.log("")

  const byContract = new Map<string, Candidate[]>()
  for (const c of candidates) {
    if (!byContract.has(c.contractId)) byContract.set(c.contractId, [])
    byContract.get(c.contractId)!.push(c)
  }

  for (const [, rows] of byContract) {
    const first = rows[0]!
    console.log(
      `${first.facilityName} · ${first.vendorName} · ${first.name ?? first.contractId}`,
    )
    for (const r of rows) {
      console.log(
        `  · term "${r.termName ?? r.termId}" · tier ${r.tierNumber}: ` +
          `$${r.currentValue.toFixed(2)} flat  →  ${r.proposedPercentLabel} of Spend ` +
          `[${r.confidence}]`,
      )
    }
  }

  if (!APPLY) {
    console.log("")
    console.log(
      "[backfill] DRY RUN. Re-run with --apply to write the changes above.",
    )
    return
  }

  console.log("")
  console.log("[backfill] Applying changes…")
  let updated = 0
  for (const c of candidates) {
    await prisma.contractTier.update({
      where: { id: c.tierId },
      data: {
        rebateType: "percent_of_spend",
        rebateValue: c.proposedValue,
      },
    })
    updated++
  }
  console.log(`[backfill] Updated ${updated} tier(s).`)
  console.log(
    "[backfill] Reminder: open each affected contract and click " +
      "'Recompute Earned Rebates' to refresh accruals against the new rate.",
  )
}

main()
  .catch((e) => {
    console.error("[backfill] FAILED", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
