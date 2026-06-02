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
import { prisma } from "@/lib/db"

const ORACLES_DIR = "scripts/oracles"

/**
 * DB preflight. Without it, a stopped dev-DB container makes EVERY
 * DB-touching oracle throw an opaque, reason-less Prisma error
 * (`Invalid prisma.x.findFirst() invocation` with no cause) — which
 * reads like a code bug when it's really "the database isn't up".
 * One clear message + the fix command saves the next person the
 * false trail. (Vick 2026-06-02.)
 */
async function preflightDb(): Promise<void> {
  // Surface the host:port the client will actually dial (the real dev
  // port is whatever DATABASE_URL says — the container maps 5435, not
  // the default 5432).
  const url = process.env.DATABASE_URL ?? "(DATABASE_URL unset)"
  const hostPort = url.replace(/^.*@/, "").replace(/\/.*$/, "") || url
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch {
    console.error(
      `\n✖ Cannot reach the database at ${hostPort}.\n` +
        `  The dev Postgres container is probably stopped. Start it with:\n` +
        `    docker compose up -d\n` +
        `  (then \`bun run db:seed\` if the volume is fresh), and re-run the oracles.\n`,
    )
    process.exit(1)
  }
}

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
    // Relative import — Bun resolves these from the importing file's
    // location regardless of cwd, which is more reliable than the @/
    // alias for dynamic imports.
    const mod = (await import(`./${basename(f)}`)) as {
      default?: OracleDefinition
    }
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
  await preflightDb()
  const { filter } = parseArgs(process.argv.slice(2))
  const all = await discover()
  const selected = filter ? all.filter((o) => o.name.includes(filter)) : all
  if (selected.length === 0) {
    console.error(
      `No oracles matched filter "${filter}". Available: ${all
        .map((o) => o.name)
        .join(", ")}`,
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
