/**
 * Runs every workflow spec in tests/workflows/*.spec.ts sequentially
 * and exits non-zero if any fails. Each spec is self-contained and
 * launches its own browser — so we just shell out with `bun run`.
 *
 *   bun run tests/workflows/run-all.ts
 */

import { readdirSync } from "fs"
import { join } from "path"
import { spawnSync } from "child_process"

const dir = new URL(".", import.meta.url).pathname
const specs = readdirSync(dir)
  .filter((f) => f.endsWith(".spec.ts"))
  .sort()

console.log(`\nworkflow runner: ${specs.length} spec(s)\n`)

let failed = 0
for (const spec of specs) {
  console.log(`\x1b[1m→ ${spec}\x1b[0m`)
  const r = spawnSync("bun", ["run", join(dir, spec)], {
    stdio: "inherit",
    env: process.env,
  })
  if (r.status !== 0) failed++
  console.log("")
}

if (failed > 0) {
  console.log(`\x1b[31m${failed}/${specs.length} spec(s) failed\x1b[0m`)
  process.exit(1)
} else {
  console.log(`\x1b[32mall ${specs.length} workflow spec(s) passed\x1b[0m`)
}
