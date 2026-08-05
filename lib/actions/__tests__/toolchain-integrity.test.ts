import { describe, expect, it } from "vitest"
import { readFileSync, readlinkSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

/**
 * Toolchain integrity tripwires (upgrade review 2026-08-05).
 *
 * Companions to typescript-version-pairing.test.ts, which validates the
 * DECLARED versions. These validate the RESOLVED toolchain, which can drift
 * even when package.json is correct:
 *
 * 1. `node_modules/.bin/tsc` must resolve to the direct `typescript`
 *    dependency. `@typescript/typescript6` (the compat package two repo
 *    scripts need) pulls a transitive typescript@6 alias whose `tsc` bin
 *    bun links OVER the direct dep — `bunx tsc` then silently typechecks
 *    with a different compiler MAJOR than `next build` uses. The
 *    postinstall (scripts/fix-tsc-bin.mjs) repairs the link, but it is
 *    best-effort and skipped under `bun install --ignore-scripts`; this
 *    test is the tripwire that catches the skew.
 *
 * 2. `bun run lint:ai` must actually run. Its import of
 *    @typescript/typescript6 sits outside every other gate (tsconfig
 *    excludes scripts/, the classic API fails at RUNTIME only), so a
 *    devDep cleanup could break the AI-action error-path guard while
 *    tsc/vitest/build all stay green.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "..")

describe("toolchain integrity", () => {
  it(".bin/tsc resolves to the direct typescript dependency (no TS6 shadow)", () => {
    const shim = join(ROOT, "node_modules", ".bin", "tsc")
    if (!existsSync(shim)) return // no install present — nothing to validate
    const target = readlinkSync(shim)
    expect(
      target,
      `.bin/tsc points at "${target}" — the @typescript/old (TS6) alias is ` +
        "shadowing typescript@7, so `bunx tsc` and `next build` typecheck " +
        "with different compiler majors. Run `node scripts/fix-tsc-bin.mjs` " +
        "(or `bun install`, which runs it as postinstall).",
    ).toMatch(/^\.\.[/\\]typescript[/\\]/)
  })

  it("the @typescript/typescript6 compat package is installed for the repo scripts", () => {
    const pkgPath = join(
      ROOT,
      "node_modules",
      "@typescript",
      "typescript6",
      "package.json",
    )
    expect(
      existsSync(pkgPath),
      "@typescript/typescript6 is missing. scripts/lint-ai-action-error-paths.ts " +
        "and scripts/build-v0-feature-ledger.ts import its classic compiler API " +
        "(removed from typescript@7) and fail at RUNTIME only — do not remove " +
        "this devDependency.",
    ).toBe(true)
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string }
    expect(pkg.version).toMatch(/^6\./)
  })

  it("`bun run lint:ai` (the AI-action error-path guard) executes end to end", () => {
    const res = spawnSync("bun", ["run", "lint:ai"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
    })
    expect(
      res.status,
      `lint:ai exited ${res.status}:\n${res.stdout}\n${res.stderr}`,
    ).toBe(0)
    expect(res.stdout + res.stderr).toContain("lint-ai-action-error-paths: OK")
  })
})
