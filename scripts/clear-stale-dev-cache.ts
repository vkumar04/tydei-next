import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")
const DEV_DIR = join(ROOT, ".next", "dev")
const MARKER = join(DEV_DIR, "server-action-files.sha256")
const SCAN_DIRS = ["app", "lib", "components", "hooks"]

function serverActionFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry === "node_modules" || entry.startsWith(".")) continue
    if (statSync(full).isDirectory()) {
      serverActionFiles(full, out)
      continue
    }
    if (!/\.tsx?$/.test(entry)) continue
    const head = readFileSync(full, "utf8").slice(0, 400)
    if (/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(head)) out.push(full.slice(ROOT.length + 1))
  }
}

const files: string[] = []
for (const dir of SCAN_DIRS) if (existsSync(join(ROOT, dir))) serverActionFiles(join(ROOT, dir), files)
const digest = createHash("sha256").update(files.sort().join("\n")).digest("hex")

const previous = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : null
if (previous !== null && previous !== digest) {
  rmSync(DEV_DIR, { recursive: true, force: true })
  console.log("[dev] server-action file set changed since the last run — cleared .next/dev so stale action ids can't be served")
}
mkdirSync(DEV_DIR, { recursive: true })
writeFileSync(MARKER, `${digest}\n`)
