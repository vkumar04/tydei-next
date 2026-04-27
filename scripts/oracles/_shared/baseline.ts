// scripts/oracles/_shared/baseline.ts
/**
 * Read the previous oracle run's report from disk and surface drift in
 * the new run. Drift here means "same check name, different detail
 * text" — useful when a check is binary-pass but the underlying number
 * shifted (e.g. share% drifted from 65.0% to 71.4%).
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const REPORTS_DIR = "docs/superpowers/diagnostics/oracle-runs"

export interface BaselineDelta {
  checkName: string
  before: string
  after: string
}

/** Parse a markdown report's check list back into a Map<name, detail>. */
function parseChecks(md: string): Map<string, string> {
  const out = new Map<string, string>()
  const lines = md.split("\n")
  let current: string | null = null
  for (const line of lines) {
    const head = line.match(/^- [✅❌] \*\*(.+?)\*\*/)
    if (head) {
      current = head[1]
      out.set(current, "")
      continue
    }
    const detail = line.match(/^  - (.+)/)
    if (detail && current) {
      const prev = out.get(current) ?? ""
      out.set(current, prev ? `${prev}\n${detail[1]}` : detail[1])
    }
  }
  return out
}

/** Find the most recent prior report for `oracleName`. Returns null when
 *  there is no prior baseline. */
export function loadPriorReport(oracleName: string): Map<string, string> | null {
  let entries: string[] = []
  try {
    entries = readdirSync(REPORTS_DIR)
  } catch {
    return null
  }
  const today = new Date().toISOString().slice(0, 10)
  const matches = entries
    .filter((f) => f.endsWith(`-${oracleName}.md`) && !f.startsWith(today))
    .sort()
  const latest = matches.at(-1)
  if (!latest) return null
  const md = readFileSync(join(REPORTS_DIR, latest), "utf8")
  return parseChecks(md)
}

/** Diff prior check details against current. Returns name+before+after
 *  for every check whose detail string changed. */
export function diffAgainstBaseline(
  prior: Map<string, string>,
  current: Array<{ name: string; detail: string }>,
): BaselineDelta[] {
  const deltas: BaselineDelta[] = []
  for (const c of current) {
    const before = prior.get(c.name)
    if (before == null) continue
    if (before !== c.detail) {
      deltas.push({ checkName: c.name, before, after: c.detail })
    }
  }
  return deltas
}
