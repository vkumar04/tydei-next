import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Assert the typescript↔next version pairing invariant:
 *
 *   typescript major >= 7  REQUIRES  next >= 16.2.12
 *                          AND       `experimental.useTypeScriptCli` in next.config.ts
 *
 * Why this exists: TypeScript 7.0 (the Go-native "Corsa" rewrite, npm
 * `latest` since 2026-07-08) DELETED `typescript/lib/typescript.js` — the
 * JavaScript compiler API. `require("typescript")` now yields only
 * `{ version, versionMajorMinor }`; `createProgram` is undefined, and the
 * package ships no `tsserver`.
 *
 * Next.js depends on that removed API in two places we are on the path of:
 *   - lib/typescript/writeConfigurationDefaults.js
 *   - build/next-config-ts/transpile-config.js  (we use next.config.ts)
 * and resolves it by the literal path `typescript/lib/typescript.js`.
 *
 * On next@16.2.x, installing typescript@7 makes `next build` hard-crash with
 * a SILENT SIGSEGV/SIGABRT and ZERO diagnostics — even with
 * `typescript.ignoreBuildErrors: true`. On Railway that surfaces as a bare
 * non-zero exit with no error text at all. See vercel/next.js#95801 (open);
 * the graceful-error backport to 16.2 (#95837) was closed UNMERGED.
 *
 * Real support landed in vercel/next.js#95639 behind
 * `experimental.useTypeScriptCli`, which shells out to the local `tsc`
 * instead of using the JS API. That landed on canary/16.3 first and was
 * backported to the 16.2.x line in **16.2.12** (#95831), which is the
 * minimum this guard accepts.
 *
 * `"typescript": "^6.0.3"` is caret-pinned so it will not resolve 7.x on its
 * own. The hazard is a routine `ncu -u` / `bun update --latest` / an agent
 * "upgrading deps" flipping it, and the build failing with no readable
 * signal. This test is the tripwire.
 *
 * It self-retires: once the upgrade is done correctly (both bumped together
 * + the flag set) it passes unchanged, and it keeps guarding the half-done
 * state.
 *
 * ── Upgrade steps. As of 2026-07-26 the blocker is GONE: next 16.2.12
 *    ships the CLI backend, so TS 7 is available on the stable line.
 *    Verified 2026-07-25 against this repo:
 *    TS 7.0.2 typechecks it with 0 errors in 2.5s vs 13.9s on TS 6.0.3
 *    (5.5x), and tsconfig.json needs NO changes.
 *
 *  1. Bump BOTH together — never independently:
 *       bun add next@^16.2.12 && bun add -d typescript@^7
 *  2. next.config.ts → `experimental: { useTypeScriptCli: true }`.
 *     Build output becomes raw tsc diagnostics (no Next code frames).
 *  3. Port the two scripts that import the REMOVED compiler API onto
 *     `@typescript/typescript6` (Microsoft's compat package — exports the
 *     full classic API). They use only the syntax/AST layer, so it's a
 *     one-line import swap each, and they fail at RUNTIME not typecheck,
 *     which makes this the easiest step to miss:
 *       - scripts/lint-ai-action-error-paths.ts  (backs `bun run lint:ai`)
 *       - scripts/build-v0-feature-ledger.ts     (backs `bun run qa:v0-ledger`)
 *     Then: bun add -d @typescript/typescript6
 *  4. Editor: TS 7 has no tsserver and no language-service plugins, so
 *     tsconfig's `plugins: [{ name: "next" }]` stops working in-editor.
 *     Either keep VS Code on TS 6, or use the TypeScriptTeam.native-preview
 *     extension and lose the Next plugin's route/link hints. Build unaffected.
 *  5. Verify: `bunx tsc --noEmit` → 0; full vitest → green; `bun run lint:ai`
 *     and `bun run qa:v0-ledger` still run; then `rm -rf .next && bun run
 *     build` MUST complete — a silent non-zero exit means the flag didn't take.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..")

/** Leading major/minor/patch of one of OUR OWN pinned ranges
 *  ("^16.2.10" → [16, 2, 10]). Not a general semver range parser — it only
 *  has to handle what we write in package.json. */
function majorMinorPatch(range: string): [number, number, number] {
  const cleaned = range.trim().replace(/^[\^~]|^>=\s*/, "")
  const [maj, min, patch] = cleaned.split(".")
  return [
    Number.parseInt(maj, 10),
    Number.parseInt(min ?? "0", 10),
    Number.parseInt(patch ?? "0", 10),
  ]
}

export interface PairingInput {
  typescriptRange: string
  nextRange: string
  nextConfigSource: string
}

/** Returns a failure message, or null when the pairing is legal. */
export function checkTypeScriptPairing(input: PairingInput): string | null {
  const [tsMajor] = majorMinorPatch(input.typescriptRange)
  if (Number.isNaN(tsMajor) || tsMajor < 7) return null

  const [nextMajor, nextMinor, nextPatch] = majorMinorPatch(input.nextRange)
  // TS 7 support landed on the 16.2.x line in 16.2.12 (vercel/next.js#95831
  // backported the useTypeScriptCli backend from canary), and on 16.3+.
  // Before 16.2.12, typescript@7 makes `next build` die with a silent
  // SIGSEGV — see the header comment.
  const nextSupportsTs7 =
    nextMajor > 16 ||
    (nextMajor === 16 && nextMinor > 2) ||
    (nextMajor === 16 && nextMinor === 2 && nextPatch >= 12)
  const hasFlag = /useTypeScriptCli/.test(input.nextConfigSource)

  if (nextSupportsTs7 && hasFlag) return null

  const reasons: string[] = []
  if (!nextSupportsTs7) {
    reasons.push(
      `next is pinned to "${input.nextRange}" but TypeScript 7 needs next >= 16.2.12`,
    )
  }
  if (!hasFlag) {
    reasons.push(
      "next.config.ts is missing `experimental: { useTypeScriptCli: true }`",
    )
  }

  return [
    `typescript is pinned to "${input.typescriptRange}" (major ${tsMajor}), but:`,
    ...reasons.map((r) => `  - ${r}`),
    "",
    "TypeScript 7 removed the JS compiler API (typescript/lib/typescript.js)",
    "that Next.js needs. In this state `next build` dies with a SILENT",
    "SIGSEGV/SIGABRT and NO diagnostics — including on Railway, and even with",
    "typescript.ignoreBuildErrors: true. See vercel/next.js#95801.",
    "",
    "Fix: bump typescript and next TOGETHER and set the flag, or revert",
    "typescript to ^6.x. Full upgrade steps are in this file's header comment.",
  ].join("\n")
}

describe("typescript ↔ next version pairing", () => {
  it("the checked-in package.json + next.config.ts are a legal pairing", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const typescriptRange = pkg.devDependencies?.typescript ?? ""
    const nextRange = pkg.dependencies?.next ?? ""

    expect(typescriptRange, "typescript missing from devDependencies").not.toBe(
      "",
    )
    expect(nextRange, "next missing from dependencies").not.toBe("")

    const failure = checkTypeScriptPairing({
      typescriptRange,
      nextRange,
      nextConfigSource: readFileSync(join(ROOT, "next.config.ts"), "utf8"),
    })

    expect(failure ?? "ok").toBe("ok")
  })

  it("flags TypeScript 7 on a pre-16.2.12 pin", () => {
    const failure = checkTypeScriptPairing({
      typescriptRange: "^7.0.2",
      nextRange: "^16.2.10",
      nextConfigSource: "export default {}",
    })
    expect(failure).toContain("needs next >= 16.2.12")
    expect(failure).toContain("SIGSEGV")
  })

  it("accepts TypeScript 7 on 16.2.12 — the backport boundary", () => {
    // #95831 backported the useTypeScriptCli backend to the 16.2.x line.
    // Treating 16.2.12 as unsupported would block a legitimate upgrade.
    expect(
      checkTypeScriptPairing({
        typescriptRange: "^7.0.2",
        nextRange: "^16.2.12",
        nextConfigSource: "experimental: { useTypeScriptCli: true }",
      }),
    ).toBeNull()
  })

  it("still rejects 16.2.11, one patch below the backport", () => {
    const failure = checkTypeScriptPairing({
      typescriptRange: "^7.0.2",
      nextRange: "^16.2.11",
      nextConfigSource: "experimental: { useTypeScriptCli: true }",
    })
    expect(failure).toContain("needs next >= 16.2.12")
  })

  it("flags TypeScript 7 on next 16.3 when the CLI flag is missing", () => {
    const failure = checkTypeScriptPairing({
      typescriptRange: "^7.0.2",
      nextRange: "^16.3.0",
      nextConfigSource: "export default { experimental: {} }",
    })
    expect(failure).toContain("useTypeScriptCli")
  })

  it("allows TypeScript 7 once next >= 16.3 and the flag is set", () => {
    expect(
      checkTypeScriptPairing({
        typescriptRange: "^7.0.2",
        nextRange: "^16.3.0",
        nextConfigSource:
          "export default { experimental: { useTypeScriptCli: true } }",
      }),
    ).toBeNull()
  })

  it("allows TypeScript 6 regardless of the next version or flag", () => {
    expect(
      checkTypeScriptPairing({
        typescriptRange: "^6.0.3",
        nextRange: "^16.2.10",
        nextConfigSource: "export default {}",
      }),
    ).toBeNull()
  })
})
