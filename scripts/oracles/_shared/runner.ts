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
