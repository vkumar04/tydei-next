/**
 * Engine-wiring parity catalog (W1.U retro Fix 3 / B1).
 *
 * ─── Why this file exists ───────────────────────────────────────
 *
 * The W1.U retro flagged that every engine in `lib/rebates/engine/` has
 * thorough unit-test coverage IN ISOLATION, but several display-facing
 * callers (contracts list, contract detail, accrual timeline) were wired
 * to bypass engine parameters entirely — most notably `config.categories`
 * (W1.U-A). Engine-only unit tests can't catch this class of bug because
 * they hand the engine a pre-filtered fixture; the gap lives in the
 * Prisma-to-engine glue.
 *
 * This file is a CATALOG, not a simulation. It asserts that for every
 * engine function exported from `lib/rebates/engine/`, at least one
 * integration test under `lib/actions/__tests__/` or `lib/actions/contracts/__tests__/`
 * references that function's name — i.e., someone has exercised the
 * engine from the Prisma side. If you add a new engine function without
 * wiring it up in an action + writing a wiring test, this tripwire fails
 * and explicitly tells you which function is orphaned.
 *
 * The referenced tests are not required to literally import the engine
 * function — they can drive it via `computeRebateFromPrismaTerm`, via
 * server-action boundaries, or via schedule builders. What matters is
 * that the NAME appears somewhere in the wiring test suite so future
 * auditors can find the glue code by grep.
 *
 * ─── How to satisfy a new engine function ───────────────────────
 *
 *   1. Add the new engine function under `lib/rebates/engine/<name>.ts`.
 *   2. Wire it through `buildConfigFromPrismaTerm` (or wherever the
 *      display path dispatches) so at least one server action reaches it.
 *   3. Add a test under `lib/actions/__tests__/` (or equivalent) whose
 *      code mentions the engine function name — e.g. a comment like
 *      `// wiring: calculateFooRebate via recomputeAccrualForContract`
 *      or a direct import for assertion purposes.
 *   4. This file's catalog will then pass.
 *
 * If you instead want to REMOVE an engine function, delete it from
 * `lib/rebates/engine/` first; this file rescans the filesystem on each
 * run, so the catalog shrinks automatically.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

// Locate the repo root independent of which worktree this runs in.
// __dirname is `<repo>/lib/contracts/__tests__/parity`.
const repoRoot = join(__dirname, "..", "..", "..", "..")

const engineDir = join(repoRoot, "lib", "rebates", "engine")
const actionsTestDirs = [
  join(repoRoot, "lib", "actions", "__tests__"),
  join(repoRoot, "lib", "actions", "contracts", "__tests__"),
]

/**
 * Scan a directory (non-recursive) for .ts files and return their
 * contents concatenated. Missing dirs are tolerated — this keeps the
 * test resilient to minor reorganizations of the action test layout.
 */
function concatDir(dir: string): string {
  let out = ""
  try {
    const entries = readdirSync(dir)
    for (const name of entries) {
      const full = join(dir, name)
      const s = statSync(full)
      if (s.isFile() && name.endsWith(".ts")) {
        out += readFileSync(full, "utf8") + "\n"
      }
    }
  } catch {
    // directory missing — skip
  }
  return out
}

/**
 * Extract `export function <name>(` names from every .ts file at the
 * top level of `lib/rebates/engine/`. Excludes the barrel (`index.ts`)
 * because its exports are all re-exports, and excludes files inside
 * `shared/` (those are tier-math primitives used by the other engines;
 * they don't have a direct wiring surface).
 */
function collectEngineFunctions(): string[] {
  const names = new Set<string>()
  let entries: string[] = []
  try {
    entries = readdirSync(engineDir)
  } catch {
    entries = []
  }
  for (const name of entries) {
    if (!name.endsWith(".ts")) continue
    if (name === "index.ts") continue
    if (name === "types.ts") continue
    const full = join(engineDir, name)
    try {
      const src = readFileSync(full, "utf8")
      const re = /export\s+function\s+(\w+)\s*\(/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src)) !== null) {
        const fnName = m[1]!
        // `zeroResult` is a type helper, not an engine dispatcher.
        if (fnName === "zeroResult") continue
        names.add(fnName)
      }
    } catch {
      // unreadable file — skip
    }
  }
  return Array.from(names).sort()
}

const engineFunctions = collectEngineFunctions()

describe("parity: engine-wiring catalog", () => {
  it("discovers at least one engine function (self-check)", () => {
    // If this fails, the scan path is wrong or the engine directory moved.
    expect(engineFunctions.length).toBeGreaterThan(0)
  })

  // Cache the concatenated action-test source once — re-reading per
  // function would be wasteful.
  const actionTestSrc = actionsTestDirs.map(concatDir).join("\n")

  for (const fn of engineFunctions) {
    // Each engine function becomes its own test so a failure message names
    // the exact orphaned function, not just "parity failed".
    it(`has wiring coverage for \`${fn}\``, () => {
      const appears = actionTestSrc.includes(fn)
      if (!appears) {
        throw new Error(
          [
            `Engine function \`${fn}\` has no wiring test.`,
            `Searched: ${actionsTestDirs.join(", ")}.`,
            `At least one action test must reference the name — either`,
            `by importing it for assertion, or by naming it in a comment`,
            `that documents the server-action path that reaches it.`,
            `See lib/contracts/__tests__/parity/engine-wiring-parity.test.ts`,
            `for the rationale.`,
          ].join(" "),
        )
      }
      expect(appears).toBe(true)
    })
  }
})
