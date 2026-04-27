# Oracle Runner Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a `scripts/oracles/` directory with a shared runner, fixture-path resolution, and baseline-diff plumbing. Migrate the existing `scripts/oracle-full-sweep.ts` into the new structure as the first oracle so the pattern is proven end-to-end. Future oracles (market-share, capital, accrual, etc.) drop in as one file each.

**Architecture:** A pure-TS runner that exposes `defineOracle(name, runFn)` returning a check accumulator. Each oracle file under `scripts/oracles/` exports a default oracle definition. `scripts/oracles/index.ts` discovers them, runs them (optionally filtered), prints a unified pass/fail report, and writes a markdown snapshot to `docs/superpowers/diagnostics/oracle-runs/<date>-<name>.md`. Fixture paths come from env vars with sensible local defaults; demo facility is looked up by name (per CLAUDE.md). The runner is read-only against whatever DATABASE_URL points at — no writes, safe to run against staging or prod.

**Tech Stack:** TypeScript strict, Bun runtime (`bun scripts/oracles/index.ts`), Prisma 7 (read-only), Vitest for unit tests on the runner internals.

**Why this plan, this size:** Spec `2026-04-26-oracle-promotion-design.md` Plan #1. The runner is a prerequisite for every future oracle — without it, each new oracle is a fork-and-rename of an existing 200+ line script. Once this lands, the next plan (`oracle-market-share.md`) is one file (~80 lines), and the per-helper coverage from §2.1 of the spec compounds quickly. Scoped to skeleton + one migration only — no new oracle coverage in this plan.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `scripts/oracles/_shared/runner.ts` | Create | `defineOracle`, `OracleContext` type with `check()` method, accumulator, exit-code logic. Pure TS, no Prisma/IO. Unit-testable. |
| `scripts/oracles/_shared/__tests__/runner.test.ts` | Create | Vitest unit tests for `defineOracle` + check accumulator + report formatter. |
| `scripts/oracles/_shared/fixtures.ts` | Create | Env-var resolution for fixture file paths and demo identifiers. Look up demo facility by name (`Lighthouse Surgical Center`), not cuid. |
| `scripts/oracles/_shared/baseline.ts` | Create | Read prior diagnostics markdown for the same oracle name; diff numeric values; emit drift warnings. |
| `scripts/oracles/_shared/report.ts` | Create | Write a pass/fail markdown report to `docs/superpowers/diagnostics/oracle-runs/<date>-<name>.md`. |
| `scripts/oracles/index.ts` | Create | Entry point. Discovers oracle files, parses `--filter <pattern>`, runs them, writes reports, sets process exit code. |
| `scripts/oracles/full-sweep.ts` | Create | First migrated oracle. Body of `scripts/oracle-full-sweep.ts` adapted to consume the runner's `defineOracle` API. |
| `scripts/oracles/README.md` | Create | One-page how-to for adding a new oracle. |
| `scripts/oracle-full-sweep.ts` | Delete | Replaced by `scripts/oracles/full-sweep.ts`. |
| `package.json` | Modify | Add `"oracles"` script alias. |
| `docs/superpowers/specs/2026-04-26-oracle-promotion-design.md` | Modify (small) | Mark §4 Plan #1 as "in flight" then "done" after merge. |

---

## Task 1: Runner — failing test

**Files:**
- Create: `scripts/oracles/_shared/__tests__/runner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/oracles/_shared/__tests__/runner.test.ts
import { describe, it, expect } from "vitest"
import { defineOracle, runOracle } from "../runner"

describe("oracle runner", () => {
  it("collects pass+fail checks and reports overall pass when every check passes", async () => {
    const oracle = defineOracle("test-oracle", async (ctx) => {
      ctx.check("a is 1", 1 === 1, "a=1")
      ctx.check("b is 2", 2 === 2, "b=2")
    })
    const result = await runOracle(oracle)
    expect(result.name).toBe("test-oracle")
    expect(result.pass).toBe(true)
    expect(result.checks).toHaveLength(2)
    expect(result.checks.every((c) => c.pass)).toBe(true)
  })

  it("reports overall fail when any check fails", async () => {
    const oracle = defineOracle("test-oracle", async (ctx) => {
      ctx.check("ok", true, "")
      ctx.check("nope", false, "expected 1 got 2")
    })
    const result = await runOracle(oracle)
    expect(result.pass).toBe(false)
    expect(result.checks.filter((c) => !c.pass)).toHaveLength(1)
    expect(result.checks[1].detail).toBe("expected 1 got 2")
  })

  it("captures thrown errors as a single failed check named 'oracle threw'", async () => {
    const oracle = defineOracle("test-oracle", async () => {
      throw new Error("boom")
    })
    const result = await runOracle(oracle)
    expect(result.pass).toBe(false)
    expect(result.checks).toHaveLength(1)
    expect(result.checks[0].name).toBe("oracle threw")
    expect(result.checks[0].detail).toContain("boom")
  })

  it("preserves check order in the report", async () => {
    const oracle = defineOracle("ordered", async (ctx) => {
      ctx.check("first", true, "")
      ctx.check("second", true, "")
      ctx.check("third", true, "")
    })
    const result = await runOracle(oracle)
    expect(result.checks.map((c) => c.name)).toEqual(["first", "second", "third"])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run scripts/oracles/_shared/__tests__/runner.test.ts`
Expected: FAIL with `Failed to resolve import "../runner"`.

---

## Task 2: Runner — implementation

**Files:**
- Create: `scripts/oracles/_shared/runner.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/oracles/_shared/runner.ts
/**
 * Canonical oracle runner.
 *
 * Each oracle is a `defineOracle(name, runFn)` definition. The runFn
 * receives a context with `check(name, pass, detail)` — the only API for
 * recording results. Throws inside runFn are caught and recorded as a
 * single failed check; the runner never lets one bad oracle take down
 * the whole sweep.
 *
 * The runner is read-only by design — it doesn't write to Prisma, and
 * it doesn't print except through the report layer. That keeps it safe
 * to invoke from CI against staging or prod.
 *
 * See: docs/superpowers/specs/2026-04-26-oracle-promotion-design.md
 */

export interface CheckResult {
  name: string
  pass: boolean
  detail: string
}

export interface OracleContext {
  /** Record a single check. `detail` should be human-readable on fail. */
  check: (name: string, pass: boolean, detail: string) => void
}

export interface OracleDefinition {
  name: string
  run: (ctx: OracleContext) => Promise<void>
}

export interface OracleResult {
  name: string
  pass: boolean
  checks: CheckResult[]
  /** Wall-clock duration in ms. */
  durationMs: number
}

export function defineOracle(
  name: string,
  run: (ctx: OracleContext) => Promise<void>,
): OracleDefinition {
  return { name, run }
}

export async function runOracle(
  oracle: OracleDefinition,
): Promise<OracleResult> {
  const checks: CheckResult[] = []
  const ctx: OracleContext = {
    check: (name, pass, detail) => {
      checks.push({ name, pass, detail })
    },
  }
  const start = Date.now()
  try {
    await oracle.run(ctx)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    checks.push({ name: "oracle threw", pass: false, detail: message })
  }
  const durationMs = Date.now() - start
  return {
    name: oracle.name,
    pass: checks.every((c) => c.pass),
    checks,
    durationMs,
  }
}
```

- [ ] **Step 2: Run unit tests**

Run: `bunx vitest run scripts/oracles/_shared/__tests__/runner.test.ts`
Expected: 4/4 PASS.

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit (test + impl together)**

```bash
git add scripts/oracles/_shared/runner.ts scripts/oracles/_shared/__tests__/runner.test.ts
git commit -m "feat(oracles): runner skeleton — defineOracle + runOracle

Pure-TS check accumulator. No Prisma / no IO — keeps the runner
unit-testable and lets us run oracles read-only against staging or
prod without risk. Spec 2026-04-26-oracle-promotion-design.md
Plan #1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Fixtures + demo-identifier resolution

**Files:**
- Create: `scripts/oracles/_shared/fixtures.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/oracles/_shared/fixtures.ts
/**
 * Fixture path + demo identifier resolution for oracles.
 *
 * Paths come from env vars with local-machine fallbacks. Demo facility
 * is looked up by NAME at runtime — never by cuid (CLAUDE.md primer:
 * "IDs regenerate on every bun run db:seed").
 */
import { prisma } from "@/lib/db"

export interface FixturePaths {
  arthrexCogCsv: string
  arthrexPricingXlsx: string
  /** Optional — only used by oracles that compare against Charles's
   *  exact desktop files. Most oracles should rely on DB seed data. */
  desktopRoot: string
}

export const FIXTURES: FixturePaths = {
  arthrexCogCsv:
    process.env.ORACLE_ARTHREX_COG ??
    "/Users/vickkumar/Desktop/experiment COG vendor short NEW.csv",
  arthrexPricingXlsx:
    process.env.ORACLE_ARTHREX_PRICING ??
    "/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx",
  desktopRoot: process.env.ORACLE_DESKTOP_ROOT ?? "/Users/vickkumar/Desktop",
}

export const DEMO_FACILITY_NAME =
  process.env.ORACLE_DEMO_FACILITY ?? "Lighthouse Surgical Center"

/**
 * Resolve the demo facility's id by name. Throws if not found so
 * oracles fail loudly instead of silently checking against the wrong
 * facility.
 */
export async function getDemoFacilityId(): Promise<string> {
  const f = await prisma.facility.findFirst({
    where: { name: DEMO_FACILITY_NAME },
    select: { id: true },
  })
  if (!f) {
    throw new Error(
      `Demo facility "${DEMO_FACILITY_NAME}" not found. Set ORACLE_DEMO_FACILITY or run \`bun run db:seed\`.`,
    )
  }
  return f.id
}
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/oracles/_shared/fixtures.ts
git commit -m "feat(oracles): fixture-path + demo-facility resolution

Fixture paths come from env vars with local-desktop fallbacks; demo
facility looked up by name (per CLAUDE.md — cuids regenerate on
every db:seed).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Report writer + baseline diff

**Files:**
- Create: `scripts/oracles/_shared/report.ts`
- Create: `scripts/oracles/_shared/baseline.ts`

- [ ] **Step 1: Report writer**

```ts
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

export interface ReportFormatOptions {
  /** Emit color-coded console output as well as the file. */
  console?: boolean
}

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
  console.log(`\n${status}  ${result.name}  (${result.checks.length - failed}/${result.checks.length} checks, ${result.durationMs}ms)`)
  for (const c of result.checks) {
    if (!c.pass) console.log(`  ❌ ${c.name}: ${c.detail}`)
  }
}
```

- [ ] **Step 2: Baseline diff**

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/oracles/_shared/report.ts scripts/oracles/_shared/baseline.ts
git commit -m "feat(oracles): markdown report writer + baseline diff

Reports persist to docs/superpowers/diagnostics/oracle-runs/ so we
have a paper trail when a number changes. Baseline diff surfaces
'same check name, different detail' deltas — drift without a
binary failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Entry runner — `scripts/oracles/index.ts`

**Files:**
- Create: `scripts/oracles/index.ts`

- [ ] **Step 1: Implement**

```ts
// scripts/oracles/index.ts
/**
 * Oracle entry point.
 *
 * Discovers every `.ts` file under `scripts/oracles/` (excluding
 * `_shared/` and this file), expects each to default-export an
 * `OracleDefinition`, runs them, writes per-oracle reports, and exits
 * non-zero if any oracle failed.
 *
 *   bun scripts/oracles/index.ts                  # all oracles
 *   bun scripts/oracles/index.ts --filter sweep   # name match
 *
 * Read-only by design. Safe to run against staging or prod.
 */
import { readdirSync } from "node:fs"
import { join, basename } from "node:path"
import {
  runOracle,
  type OracleDefinition,
  type OracleResult,
} from "./_shared/runner"
import { writeReport, printConsoleSummary } from "./_shared/report"
import { loadPriorReport, diffAgainstBaseline } from "./_shared/baseline"

const ORACLES_DIR = "scripts/oracles"

function parseArgs(argv: string[]): { filter: string | null } {
  const idx = argv.indexOf("--filter")
  if (idx >= 0 && argv[idx + 1]) return { filter: argv[idx + 1] }
  return { filter: null }
}

async function discover(): Promise<OracleDefinition[]> {
  const entries = readdirSync(ORACLES_DIR, { withFileTypes: true })
  const files = entries
    .filter(
      (e) =>
        e.isFile() &&
        e.name.endsWith(".ts") &&
        e.name !== "index.ts" &&
        !e.name.startsWith("_"),
    )
    .map((e) => join(ORACLES_DIR, e.name))

  const oracles: OracleDefinition[] = []
  for (const f of files) {
    const mod = (await import(`@/${f}`)) as { default?: OracleDefinition }
    if (!mod.default || typeof mod.default.run !== "function") {
      throw new Error(
        `${basename(f)} must default-export an OracleDefinition (use defineOracle).`,
      )
    }
    oracles.push(mod.default)
  }
  return oracles
}

function reportDrift(name: string, current: OracleResult): void {
  const prior = loadPriorReport(name)
  if (!prior) return
  const deltas = diffAgainstBaseline(
    prior,
    current.checks.map((c) => ({ name: c.name, detail: c.detail })),
  )
  if (deltas.length === 0) return
  console.log(`  ⚠ Drift vs prior baseline (${deltas.length}):`)
  for (const d of deltas) {
    console.log(`    - ${d.checkName}: ${d.before} → ${d.after}`)
  }
}

async function main() {
  const { filter } = parseArgs(process.argv.slice(2))
  const all = await discover()
  const selected = filter ? all.filter((o) => o.name.includes(filter)) : all
  if (selected.length === 0) {
    console.error(
      `No oracles matched filter "${filter}". Available: ${all.map((o) => o.name).join(", ")}`,
    )
    process.exit(1)
  }

  console.log(`Running ${selected.length} oracle(s)...`)
  let anyFailed = false
  for (const oracle of selected) {
    const result = await runOracle(oracle)
    const file = writeReport(result)
    printConsoleSummary(result)
    reportDrift(oracle.name, result)
    console.log(`  → ${file}`)
    if (!result.pass) anyFailed = true
  }
  process.exit(anyFailed ? 1 : 0)
}

void main()
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: 0 errors. If `await import(\`@/${f}\`)` doesn't resolve under Bun's runtime, change to a relative `./` import — Bun supports both, but test it.

- [ ] **Step 3: Commit**

```bash
git add scripts/oracles/index.ts
git commit -m "feat(oracles): runner entry point with --filter + drift reporting

bun scripts/oracles/index.ts discovers every oracle file under
scripts/oracles/ (excluding _shared/), runs them, writes per-oracle
reports, and surfaces drift against the prior baseline.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Migrate `scripts/oracle-full-sweep.ts` → `scripts/oracles/full-sweep.ts`

**Files:**
- Create: `scripts/oracles/full-sweep.ts`
- Delete: `scripts/oracle-full-sweep.ts`

- [ ] **Step 1: Read the existing file**

```bash
cat scripts/oracle-full-sweep.ts
```

Identify:
- The body of `main()` — every Prisma read + every `check(name, pass, detail)` call.
- Which imports are needed (`@/lib/rebates/calculate`, `@/lib/contracts/evergreen`, `@/lib/contracts/term-years`, `@/lib/db`).

- [ ] **Step 2: Create the migrated oracle**

```ts
// scripts/oracles/full-sweep.ts
/**
 * Full sweep — independent verification of evergreen, term-years, and
 * cumulative/marginal rebate calculations against current contracts.
 *
 * Migrated 2026-04-26 from scripts/oracle-full-sweep.ts to consume the
 * shared runner. No coverage change vs the original — same Prisma
 * reads, same checks, same pure-function comparisons.
 */
import { prisma } from "@/lib/db"
import {
  calculateCumulative,
  calculateMarginal,
} from "@/lib/rebates/calculate"
import { EVERGREEN_MS, isEvergreen } from "@/lib/contracts/evergreen"
import { computeContractYears } from "@/lib/contracts/term-years"
import { defineOracle } from "./_shared/runner"

const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtNoDec = (n: number) => n.toLocaleString("en-US")

export default defineOracle("full-sweep", async (ctx) => {
  // Paste every check call from scripts/oracle-full-sweep.ts:main()
  // here, swapping `check(...)` → `ctx.check(...)`. Drop the local
  // `CHECKS` array and the `console.log` in the helper — the runner
  // owns reporting.
  //
  // Concrete migration steps for each block in the original file:
  //
  // Block A: Evergreen detection (lines 30–95 in original)
  //   - Keep the prisma reads as-is.
  //   - Replace check(name, pass, detail) with ctx.check(...)
  //
  // Block B: Term-years computation (lines 96–175)
  //   - Same swap.
  //
  // Block C: Calc engine cumulative + marginal (lines 176–240)
  //   - Same swap.
  //
  // Block D: Disconnect (line 240+)
  //   - Replace with finally { await prisma.$disconnect() }
  //   - The runner won't call disconnect for you because the
  //     prisma client is shared module state; oracles that hold it
  //     own the disconnect.
  //
  // Do not refactor the Prisma reads or the math — this task is a
  // mechanical migration only. Behavior parity is required.

  try {
    // ── Block A: Evergreen ───────────────────────────────────────
    // (paste Block A from original here, with check → ctx.check)

    // ── Block B: Term years ──────────────────────────────────────
    // (paste Block B)

    // ── Block C: Calc engine ─────────────────────────────────────
    // (paste Block C)
  } finally {
    await prisma.$disconnect()
  }
})

// Suppress "unused" warnings for fmt helpers if a block doesn't
// reference them after migration.
void fmt
void fmtNoDec
```

When pasting, KEEP every `check(...)` call's exact name + detail string from the original. Drift in those strings would break the baseline diff feature. The only mechanical change is `check(` → `ctx.check(`.

- [ ] **Step 3: Delete the legacy file**

```bash
git rm scripts/oracle-full-sweep.ts
```

- [ ] **Step 4: Smoke-run the new oracle**

```bash
bun scripts/oracles/index.ts --filter full-sweep
```

Expected: prints `✅ PASS  full-sweep  (N/N checks, …ms)` if the DB is seeded; writes a report to `docs/superpowers/diagnostics/oracle-runs/<date>-full-sweep.md`. If the DB is unseeded the oracle may fail — that's a real signal, not a runner bug.

If it fails because Bun's dynamic-import resolution doesn't like `@/scripts/...`, fall back to relative imports in `index.ts` discovery (`./${e.name}` instead of `@/${f}`).

- [ ] **Step 5: Typecheck + targeted vitest**

```bash
bunx tsc --noEmit
bunx vitest run scripts/oracles
```

Expected: 0 errors, runner unit tests still pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/oracles/full-sweep.ts scripts/oracle-full-sweep.ts
git commit -m "feat(oracles): migrate full-sweep into shared runner

Behavior parity with scripts/oracle-full-sweep.ts (deleted). Same
checks, same names, same detail strings — keeping detail strings
identical means the baseline-diff feature can compare runs from
before and after the migration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: README + package.json script

**Files:**
- Create: `scripts/oracles/README.md`
- Modify: `package.json`

- [ ] **Step 1: README**

```markdown
# Oracles

Independent verification of customer-facing numbers. Each oracle in this
folder recomputes some invariant from primary sources (DB, fixture
files) without sharing code with the app's matcher / recompute
pipelines, then compares against the app's output.

## Run

```sh
bun scripts/oracles/index.ts                # every oracle
bun scripts/oracles/index.ts --filter share # only oracles whose name contains 'share'
bun run oracles                             # alias for the first form
```

Read-only against whatever `DATABASE_URL` points at. Safe for prod.

## Reports

Every run writes a markdown snapshot to
`docs/superpowers/diagnostics/oracle-runs/<date>-<oracle-name>.md`.
The runner also surfaces drift against the prior baseline (same check
name, different detail) in the console.

## Add a new oracle

Create `scripts/oracles/<name>.ts`:

```ts
import { defineOracle } from "./_shared/runner"

export default defineOracle("<name>", async (ctx) => {
  // ... read primary data, compute the truth, then:
  ctx.check("invariant X holds", computed === expected, `${computed} vs ${expected}`)
})
```

The runner discovers it automatically. Helper paths and demo identifiers
live in `_shared/fixtures.ts` — use them rather than hardcoding.

## Conventions

- One oracle per file. Default-export the `defineOracle(...)` value.
- Keep `check()` names stable across versions — the baseline-diff
  feature matches by name.
- Pure functions only. Don't reuse the app's reducers; the whole point
  is independent compute.
```

- [ ] **Step 2: package.json script**

Add to the `"scripts"` block of `package.json`:

```json
"oracles": "bun scripts/oracles/index.ts"
```

Place it alphabetically with the other scripts.

- [ ] **Step 3: Verify the alias works**

```bash
bun run oracles --filter full-sweep
```

Expected: same output as `bun scripts/oracles/index.ts --filter full-sweep`.

- [ ] **Step 4: Commit**

```bash
git add scripts/oracles/README.md package.json
git commit -m "docs(oracles): README + 'oracles' package.json script alias

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Mark spec Plan #1 as done + push

**Files:**
- Modify: `docs/superpowers/specs/2026-04-26-oracle-promotion-design.md`

- [ ] **Step 1: Update spec status**

In `§4 Proposed sequencing`, change:

```
1. **`oracle-runner-skeleton.md`** — Build `scripts/oracles/` directory, ...
   No new oracle coverage. ~1 day.
```

to:

```
1. ~~**`oracle-runner-skeleton.md`**~~ — DONE 2026-04-26. Runner +
   fixtures + report + baseline diff + entry point + full-sweep migration.
```

- [ ] **Step 2: Full vitest sweep**

```bash
bunx vitest run lib components scripts
```

Expected: all green.

- [ ] **Step 3: Commit + push**

```bash
git add docs/superpowers/specs/2026-04-26-oracle-promotion-design.md
git commit -m "docs(oracles): mark Plan #1 (runner skeleton) as done

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

git fetch origin main
git rebase origin/main
git push origin HEAD:main
```

Expected: clean fast-forward push.

---

## Self-review

**1. Spec coverage:**
- §3.1 directory structure — Tasks 2, 3, 4, 5. ✅
- §3.2 fixtures without hardcoding — Task 3. ✅
- §3.4 baseline diffing — Task 4. ✅
- §3.5 wire to invariants table — out of scope; no new helper added by this plan.
- §4 Plan #1 (runner + migrate one) — Tasks 2–6. ✅
- Future plans (#2 market-share oracle, #3 coverage fill) — out of scope.

**2. Placeholder scan:** every step has concrete code, exact path, exact command, expected output. The one place I leave intentional ambiguity — the inside of `full-sweep.ts` — is explicitly marked as "mechanical migration: paste from original, swap `check(` → `ctx.check(`" and constrains *what* must be preserved (names, details). That's the right level of guidance for a refactor task; specifying every line of every check would just be a paste of the original 277-line file.

**3. Type consistency:** `OracleDefinition` (`{ name, run }`), `OracleContext` (`{ check }`), `OracleResult` (`{ name, pass, checks, durationMs }`), `CheckResult` (`{ name, pass, detail }`). All used identically across runner, report, baseline, index.

**4. Risk callouts:**
- Bun's dynamic `import("@/scripts/oracles/X.ts")` may resolve differently than vitest's. Task 6 Step 4 calls this out and offers a relative-import fallback if the alias fails.
- The runner depends on `prisma` being importable at the top of `full-sweep.ts`, which means running the oracle does load the Prisma client. That's fine — read-only, safe for prod — but worth knowing if a future oracle wants to be DB-free.
- `desktopRoot` and `arthrexCogCsv` defaults still hardcode `/Users/vickkumar/Desktop/...`. These get overridden by env vars in CI; the local fallback is just a developer convenience until we move fixtures into the repo (next plan).

---

## Out of scope / follow-up plans

- **Migrate the Python oracles** (`oracle_charles_arthrex.py` etc.) into the runner via `bun spawn`. Separate plan — non-trivial JSON contract design between TS runner and Python oracles.
- **CI integration.** GitHub Actions workflow that runs `bun run oracles --filter '!*full-sweep*'` per-PR and the full sweep nightly. Separate plan — needs decisions about staging vs prod DB target.
- **New oracle coverage** (market-share, capital, accrual, forecast, carve-out, volume-CPT). Plan `oracle-market-share.md` is the natural follow-up — pairs with the canonical helper that just landed.
- **Move fixtures into the repo.** Currently the local fallback paths reference `/Users/vickkumar/Desktop/...`. Once we decide which fixtures are checked-in vs gitignored, drop them into `fixtures/oracle/` and update the defaults.
- **CLAUDE.md "Oracle" column** in the canonical reducers invariants table. Adds it once the first non-skeleton oracle lands (so the column has at least one populated cell).
