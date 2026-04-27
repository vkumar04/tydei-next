// scripts/oracles/_shared/report.ts
/**
 * Write a pass/fail markdown report for an oracle run. Persists to
 * docs/superpowers/diagnostics/oracle-runs/ so we have a paper trail
 * when "this number changed."
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { OracleResult } from "./runner"

const REPORTS_DIR = "docs/superpowers/diagnostics/oracle-runs"

function fmtCheck(c: { name: string; pass: boolean; detail: string }): string {
  const icon = c.pass ? "✅" : "❌"
  const detail = c.detail ? `\n  - ${c.detail}` : ""
  return `- ${icon} **${c.name}**${detail}`
}

export function formatReport(result: OracleResult): string {
  const ts = new Date().toISOString()
  const status = result.pass ? "PASS" : "FAIL"
  const failed = result.checks.filter((c) => !c.pass).length
  const total = result.checks.length
  const lines = [
    `# Oracle: ${result.name} — ${status}`,
    "",
    `**Run:** ${ts}`,
    `**Duration:** ${result.durationMs}ms`,
    `**Checks:** ${total - failed}/${total} passed`,
    "",
    "## Results",
    "",
    ...result.checks.map(fmtCheck),
    "",
  ]
  return lines.join("\n")
}

export function writeReport(result: OracleResult): string {
  mkdirSync(REPORTS_DIR, { recursive: true })
  const date = new Date().toISOString().slice(0, 10)
  const file = join(REPORTS_DIR, `${date}-${result.name}.md`)
  writeFileSync(file, formatReport(result), "utf8")
  return file
}

export function printConsoleSummary(result: OracleResult): void {
  const status = result.pass ? "✅ PASS" : "❌ FAIL"
  const failed = result.checks.filter((c) => !c.pass).length
  console.log(
    `\n${status}  ${result.name}  (${result.checks.length - failed}/${result.checks.length} checks, ${result.durationMs}ms)`,
  )
  for (const c of result.checks) {
    if (!c.pass) console.log(`  ❌ ${c.name}: ${c.detail}`)
  }
}
