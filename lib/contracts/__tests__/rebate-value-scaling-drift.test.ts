import { describe, it, expect } from "vitest"
import { promises as fs } from "fs"
import path from "path"

/**
 * Defensive scanner: catches the recurring units/scaling bug family
 * before it ships.
 *
 * Why this exists (Charles 2026-04-25):
 *
 * `ContractTier.rebateValue` is stored as a fraction (0.03 = 3%) but
 * many display surfaces and the rebate engine want integer percent.
 * The boundary helper `toDisplayRebateValue` exists, but it's opt-in
 * — there's no compile-time enforcement. Eight separate fix commits
 * across the last ~60 closed unit-scaling drift bugs at individual
 * sites without addressing the root.
 *
 * This test fails the CI when ANY file outside the allowlist reads
 * `rebateValue` raw via `Number(...rebateValue)` or string-interps
 * it (`${...rebateValue}%` style). Allowlist exists for the boundary
 * helpers themselves and known-safe pre-scaling sites where the
 * value has already been routed through `toDisplayRebateValue` /
 * `scaleRebateValueForEngine`.
 *
 * When you add a new surface that needs the percent value, route it
 * through `toDisplayRebateValue` rather than adding to the allowlist.
 *
 * See `docs/architecture/recurring-bug-patterns.md` family 1.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..")

// Files allowed to read rebateValue raw. Each entry is paired with a
// reason — keep the reasons honest, don't bulk-add entries here.
const ALLOWLIST = new Set<string>([
  // Boundary helper — this IS the canonical scaler.
  "lib/contracts/rebate-value-normalize.ts",
  // Engine internals — they speak the engine's "Decimal-ish number"
  // language and are tier-rule consumers, not display.
  "lib/rebates/calculate.ts",
  "lib/rebates/engine/spend-rebate.ts",
  "lib/rebates/engine/volume-rebate.ts",
  "lib/rebates/engine/market-share-rebate.ts",
  "lib/rebates/engine/market-share-price-reduction.ts",
  "lib/rebates/engine/tier-price-reduction.ts",
  "lib/rebates/engine/capitated.ts",
  "lib/rebates/engine/carve-out.ts",
  "lib/rebates/engine/tie-in-capital.ts",
  "lib/rebates/engine/amortization.ts",
  "lib/rebates/engine/shared/cumulative.ts",
  "lib/rebates/engine/shared/marginal.ts",
  "lib/rebates/engine/shared/determine-tier.ts",
  "lib/rebates/engine/shared/sort-tiers.ts",
  "lib/rebates/engine/types.ts",
  "lib/rebates/engine/index.ts",
  // Engine-adjacent: this is where the canonical scaler is applied
  // before delegating to the engine, so internal Number(*.rebateValue)
  // accesses are guarded by their own scaling.
  "lib/contracts/tier-rebate-label.ts",
  // Tests are explicitly allowed to construct fixtures in either shape.
])

const ALLOWLIST_PREFIXES = [
  // Test fixtures + harnesses
  "lib/__tests__/",
  "lib/contracts/__tests__/",
  "lib/rebates/__tests__/",
  "lib/rebates/engine/__tests__/",
  "lib/actions/__tests__/",
  "lib/reports/__tests__/",
  "components/contracts/__tests__/",
  // Generated zod / Prisma client artifacts
  "lib/generated/",
  // Build cache / scratch
  ".next/",
  ".claude/",
  ".worktrees/",
  "node_modules/",
  // Diagnostic + one-off scripts where false positives are okay
  "scripts/",
  // The seed pipeline writes raw fractions (correct for storage).
  "prisma/",
  // Doc files frequently include code-fenced examples.
  "docs/",
]

// Patterns that indicate raw rebateValue handling.
//
// We deliberately scope this NARROW. The codebase has many legitimate
// reads of `Number(tier.rebateValue)` — loading Prisma rows into form
// state, feeding helpers that document accepting raw fraction
// (`formatTierDollarAnnotation`, `calculateTierProgress`). Catching
// those produces noise that drowns the real bug signal.
//
// What's left is the high-signal pattern: a fraction directly
// interpolated into a "%" label. That's always wrong (renders 0.03
// as "0.03%" instead of "3.0%") and is what every recent
// units/scaling bug has shared. If a new pattern comes up, add it
// here with a comment, but keep the bar at "almost-always wrong."
const UNSAFE_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\$\{[^}]*\.rebateValue[^}]*\}\s*%/g,
    description: "${*.rebateValue}% — fraction interpolated as percent without scaling",
  },
  {
    // `.toFixed(N)}%` directly off a fraction. Same root cause as the
    // template-literal pattern — show-percent on a stored fraction.
    // Catches `Number(tier.rebateValue).toFixed(1)}%` (the vendor-
    // overview bug from 2026-04-25).
    pattern: /\.rebateValue\s*\)?\s*\.toFixed\(\d+\)\s*\}\s*%/g,
    description: "*.rebateValue).toFixed(N)}% — fraction formatted as percent without scaling",
  },
]

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const rel = path.relative(REPO_ROOT, full)
    if (
      ALLOWLIST_PREFIXES.some(
        (prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix),
      )
    ) {
      continue
    }
    if (entry.isDirectory()) {
      await walk(full, out)
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
    ) {
      out.push(rel)
    }
  }
  return out
}

describe("rebateValue scaling drift scanner (Charles 2026-04-25)", () => {
  it("no file outside the allowlist reads rebateValue raw", async () => {
    const candidates = await walk(REPO_ROOT)
    const violations: Array<{
      file: string
      line: number
      snippet: string
      kind: string
    }> = []

    for (const rel of candidates) {
      if (ALLOWLIST.has(rel)) continue
      const text = await fs.readFile(path.join(REPO_ROOT, rel), "utf-8")
      const lines = text.split("\n")
      const SAFETY_HELPERS = [
        "toDisplayRebateValue",
        "scaleRebateValueForEngine",
        "formatTierRebateLabel",
        "computeRebateFromPrismaTiers",
      ]
      // Look for safety helpers anywhere within ±10 lines of the
      // suspect line. Multi-line property-access expressions (e.g. a
      // map() body that wraps the value in toDisplayRebateValue on a
      // previous line) shouldn't be flagged.
      const isSafeNear = (lineIdx: number): boolean => {
        const start = Math.max(0, lineIdx - 10)
        const end = Math.min(lines.length, lineIdx + 11)
        for (let j = start; j < end; j++) {
          if (SAFETY_HELPERS.some((h) => lines[j].includes(h))) return true
        }
        return false
      }
      lines.forEach((line, i) => {
        for (const { pattern, description } of UNSAFE_PATTERNS) {
          pattern.lastIndex = 0
          if (pattern.test(line)) {
            if (isSafeNear(i)) continue
            violations.push({
              file: rel,
              line: i + 1,
              snippet: line.trim().slice(0, 200),
              kind: description,
            })
          }
        }
      })
    }

    if (violations.length > 0) {
      const formatted = violations
        .map(
          (v) =>
            `  ${v.file}:${v.line}\n    ${v.snippet}\n    → ${v.kind}`,
        )
        .join("\n\n")
      throw new Error(
        `\nFound ${violations.length} unsafe rebateValue access(es) outside the allowlist.\n\n${formatted}\n\nFix by routing through \`toDisplayRebateValue(rebateType, value)\` from \`@/lib/contracts/rebate-value-normalize\`. See \`docs/architecture/recurring-bug-patterns.md\` family 1.\n`,
      )
    }
    expect(violations).toEqual([])
  })
})
