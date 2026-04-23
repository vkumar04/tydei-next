#!/usr/bin/env bun
/**
 * Invariants check — greps for known ad-hoc reducers that should be
 * routing through their canonical helper instead. One-shot, run
 * locally or in CI before merge.
 *
 * Drift between parallel reducers on the same invariant is how the
 * "rebates collected" number on the dashboard ends up $12k off from
 * the contract detail page (Charles W1.R). This script won't catch
 * every case — only the patterns we've already seen drift on — but it
 * closes the "two places quietly disagree" hazard for the invariants
 * already in CLAUDE.md's table.
 *
 * Usage: bun scripts/check-invariants.ts
 */

import { spawnSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"

interface Rule {
  name: string
  /** Regex patterns that should NOT appear outside the canonical helper. */
  patterns: RegExp[]
  /** File(s) allowed to match — the canonical helpers themselves. */
  allowed: string[]
  /** Human explanation shown when a violation fires. */
  hint: string
}

const RULES: Rule[] = [
  {
    name: "rebates-collected",
    patterns: [
      // Ad-hoc `r.collectionDate ? ... : 0` reducers — every "collected"
      // aggregate must route through sumCollectedRebates.
      /\.collectionDate\s*\?\s*[^:]+:\s*0/g,
      /\.collectionDate\s*!?=\s*null/g,
    ],
    allowed: ["lib/contracts/rebate-collected-filter.ts"],
    hint:
      "Use sumCollectedRebates from lib/contracts/rebate-collected-filter.ts.\n" +
      "  See CLAUDE.md invariants table → Rebates Collected.",
  },
  {
    name: "rebates-earned-ytd",
    patterns: [
      // Ad-hoc `payPeriodEnd >= startOfYear` — every "earned YTD" must
      // route through sumEarnedRebatesYTD.
      /payPeriodEnd\s*>=\s*(?:new Date\([^)]*Jan|startOfYear|yearStart)/g,
    ],
    allowed: ["lib/contracts/rebate-earned-filter.ts"],
    hint:
      "Use sumEarnedRebatesYTD from lib/contracts/rebate-earned-filter.ts.\n" +
      "  See CLAUDE.md invariants table → Rebates Earned (YTD).",
  },
  {
    name: "bundle-shortfalls",
    patterns: [
      // Ad-hoc `shortfalls.map((s) => s.shortfall)` outside the reducer.
      /\.shortfalls\.map\(\s*\([^)]*\)\s*=>\s*[a-zA-Z_]+\.shortfall\)/g,
      /status\.allOrNothing\?\.shortfalls\.find/g,
    ],
    allowed: ["lib/contracts/bundle-shortfalls.ts"],
    hint:
      "Use deriveBundleShortfalls from lib/contracts/bundle-shortfalls.ts.\n" +
      "  Added 2026-04-23 to prevent synth vs dashboard drift.",
  },
  {
    name: "tier-rebate-units",
    patterns: [
      // Don't hand-roll rebateValue * 100 scaling outside the boundary
      // helpers. The scaling lives in computeRebateFromPrismaTiers +
      // tier-rebate-label.ts per CLAUDE.md.
      /rebateValue\s*\*\s*100\b/g,
      /Number\(\s*[a-zA-Z_]+\.rebateValue\s*\)\s*\*\s*100\b/g,
    ],
    allowed: [
      "lib/rebates/calculate.ts",
      "lib/contracts/tier-rebate-label.ts",
      "lib/contracts/rebate-value-normalize.ts",
    ],
    hint:
      "ContractTier.rebateValue is stored as a fraction. Scaling to\n" +
      "  integer percent lives in computeRebateFromPrismaTiers +\n" +
      "  formatTierRebateLabel — don't hand-roll * 100 elsewhere.",
  },
]

interface Violation {
  rule: string
  file: string
  line: number
  excerpt: string
  hint: string
}

function ripgrep(pattern: string): string[] {
  // Prefer rg for speed; fall back to git grep.
  const rg = spawnSync(
    "rg",
    [
      "--no-heading",
      "--line-number",
      "--color=never",
      "--type",
      "ts",
      "--glob",
      "!node_modules",
      "--glob",
      "!.next",
      "--glob",
      "!.claude",
      "--glob",
      "!.worktrees",
      "--glob",
      "!dist",
      "--pcre2",
      pattern,
      ".",
    ],
    { encoding: "utf8" },
  )
  if (rg.status === 0 && rg.stdout) return rg.stdout.split("\n").filter(Boolean)
  if (rg.status === 1) return [] // no matches
  // Fall back to git grep if rg isn't available or errored.
  const git = spawnSync(
    "git",
    ["grep", "-nP", pattern, "--", "*.ts", "*.tsx"],
    { encoding: "utf8" },
  )
  return git.stdout.split("\n").filter(Boolean)
}

function check(): Violation[] {
  const violations: Violation[] = []
  for (const rule of RULES) {
    for (const pat of rule.patterns) {
      const lines = ripgrep(pat.source)
      for (const line of lines) {
        // line format: "path/to/file.ts:42:matched text"
        const m = line.match(/^([^:]+):(\d+):(.+)$/)
        if (!m) continue
        const [, file, lineNo, excerpt] = m
        if (rule.allowed.some((a) => file === a || file.endsWith("/" + a))) {
          continue
        }
        // Skip test files — tests intentionally exercise raw reducers.
        if (file.includes("__tests__/") || file.endsWith(".test.ts")) continue
        // Skip the invariants script itself so it doesn't flag its own
        // pattern literals.
        if (file.endsWith("scripts/check-invariants.ts")) continue
        // Skip the v0-spec reference modules — they're intentional
        // independent implementations used as oracle ground truth.
        if (file.startsWith("./lib/v0-spec/") || file.includes("/lib/v0-spec/")) {
          continue
        }
        violations.push({
          rule: rule.name,
          file,
          line: Number(lineNo),
          excerpt: excerpt.trim(),
          hint: rule.hint,
        })
      }
    }
  }
  return violations
}

const violations = check()
if (violations.length === 0) {
  console.log("invariants OK — no ad-hoc reducers detected")
  process.exit(0)
}
console.error(`\n✗ ${violations.length} invariant violation(s):\n`)
const byRule = new Map<string, Violation[]>()
for (const v of violations) {
  const bucket = byRule.get(v.rule)
  if (bucket) bucket.push(v)
  else byRule.set(v.rule, [v])
}
for (const [rule, rows] of byRule) {
  console.error(`[${rule}] ${rows.length} match(es)`)
  console.error(`  ${rows[0].hint}`)
  for (const r of rows) {
    console.error(`  ${r.file}:${r.line}  ${r.excerpt}`)
  }
  console.error("")
}
process.exit(1)

// Keep imports referenced so tsc --noEmit doesn't complain.
void readFileSync
void existsSync
void join
