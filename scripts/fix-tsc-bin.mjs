/**
 * Repair node_modules/.bin/tsc after install.
 *
 * `@typescript/typescript6` (the TS6 compat package two repo scripts need —
 * see typescript-version-pairing.test.ts) depends on the npm alias
 * `@typescript/old` → typescript@6, whose real package name is "typescript"
 * with a `tsc` bin. Bun links THAT bin into the root `.bin`, shadowing the
 * direct typescript@7 dependency — so `bunx tsc` silently runs TS 6 while
 * `next build` (which resolves typescript/package.json directly) runs TS 7.
 * A version-skewed typecheck is exactly the kind of silent drift the
 * pairing test exists to prevent; relink the shim to the real dependency.
 *
 * Defensive by design: never fails the install.
 */
import { readlinkSync, rmSync, symlinkSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

try {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
  const shim = join(root, "node_modules", ".bin", "tsc")
  const want = join("..", "typescript", "bin", "tsc")
  const target = join(root, "node_modules", "typescript", "bin", "tsc")
  if (!existsSync(target)) process.exit(0)
  let current = null
  try {
    current = readlinkSync(shim)
  } catch {
    /* missing or not a symlink — relink below */
  }
  if (current !== want) {
    rmSync(shim, { force: true })
    symlinkSync(want, shim)
    console.log(`[fix-tsc-bin] relinked .bin/tsc → ${want} (was ${current ?? "absent"})`)
  }
} catch (err) {
  console.warn("[fix-tsc-bin] skipped:", err instanceof Error ? err.message : err)
}
