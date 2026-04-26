import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

/**
 * Walk every "use server" file and assert every export is async (or
 * a type/interface — those are erased and safe).
 *
 * Why this exists: 2026-04-26 we shipped lib/actions/analytics/_cache.ts
 * with three SYNC tag-builder helpers exported from a "use server"
 * file. Next 16 hard-fails:
 *
 *   Server Actions must be async functions.
 *
 * Because lib/actions/contracts.ts imported from _cache.ts, every
 * page that touched contracts cascaded to HTTP 500 (4 user-visible
 * bugs). The fix was easy; catching it before deploy is easier still.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..")
const SCAN_DIRS = ["lib", "app", "components", "hooks"]
const SKIP = new Set([
  "node_modules",
  ".next",
  ".claude",
  ".worktrees",
  ".git",
  "dist",
])

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      yield* walk(full)
    } else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) {
      yield full
    }
  }
}

function isUseServerFile(content: string): boolean {
  // Top-of-file directive only. Mid-file "use server" is function-level
  // (a different feature) and out of scope here.
  const head = content.slice(0, 200).split("\n").slice(0, 5).join("\n")
  return /^\s*["']use server["'];?\s*$/m.test(head)
}

interface Violation {
  file: string
  line: number
  kind: string
  name: string
  snippet: string
}

function findViolations(file: string): Violation[] {
  const content = readFileSync(file, "utf8")
  if (!isUseServerFile(content)) return []
  const out: Violation[] = []
  const lines = content.split("\n")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lno = i + 1

    // Type / interface exports are erased — safe.
    if (/^\s*export\s+(type|interface)\s/.test(line)) continue

    // Class / enum / let / var exports → banned outright (Next 16
    // server-action manifest only knows how to wire async functions).
    const banned = line.match(/^\s*export\s+(class|enum|let|var)\s+(\w+)/)
    if (banned) {
      out.push({
        file,
        line: lno,
        kind: `BANNED ${banned[1]}`,
        name: banned[2],
        snippet: line.trim(),
      })
      continue
    }

    // export default function — must be async
    const defFn = line.match(/^\s*export\s+default\s+(async\s+)?function/)
    if (defFn) {
      if (!defFn[1]) {
        out.push({
          file,
          line: lno,
          kind: "SYNC default function",
          name: "default",
          snippet: line.trim(),
        })
      }
      continue
    }

    // export function foo / export async function foo
    const fn = line.match(/^\s*export\s+(async\s+)?function\s+(\w+)/)
    if (fn) {
      if (!fn[1]) {
        out.push({
          file,
          line: lno,
          kind: "SYNC function",
          name: fn[2],
          snippet: line.trim(),
        })
      }
      continue
    }

    // export const foo = ... — flag if NOT a function expression that
    // looks async. We accept three shapes as safe:
    //   export const x = async (...) => ...
    //   export const x = async function ...
    //   export const x = (await import(...)).foo  ← rare
    // Anything else (literals, objects, sync arrows, sync function
    // expressions, cache(impl) wrappers, etc) → flag.
    const cst = line.match(/^\s*export\s+const\s+(\w+)\s*[:=]/)
    if (cst) {
      // Inspect a small window for an async marker.
      const window = lines.slice(i, Math.min(i + 8, lines.length)).join(" ")
      const looksAsync =
        /=\s*async\s*[(<]/.test(window) ||
        /=\s*async\s+function/.test(window)
      if (!looksAsync) {
        out.push({
          file,
          line: lno,
          kind: "SYNC const",
          name: cst[1],
          snippet: line.trim(),
        })
      }
      continue
    }

    // export { foo, bar } / export { foo } from "..."
    // Re-exports are tricky — we'd need to follow the source. Punt for now;
    // surfaced as a soft warning that the dev should manually audit.
    const reexport = line.match(/^\s*export\s+\{[^}]+\}/)
    if (reexport) {
      out.push({
        file,
        line: lno,
        kind: "RE-EXPORT (manual)",
        name: "",
        snippet: line.trim(),
      })
      continue
    }
  }

  return out
}

// Files where re-exports are intentional + verified manually (e.g. the
// origin module is itself a "use server" with async fns). Add exact
// `file:line` pairs to silence the RE-EXPORT (manual) warning.
const REEXPORT_BASELINE = new Set<string>([
  // none yet
])

describe('use-server async-export scanner', () => {
  it('every export from a "use server" file is async (or type/interface)', () => {
    const allViolations: Violation[] = []
    for (const dir of SCAN_DIRS) {
      const fullDir = join(ROOT, dir)
      try {
        statSync(fullDir)
      } catch {
        continue
      }
      for (const f of walk(fullDir)) {
        const v = findViolations(f).filter((x) => {
          if (x.kind === "RE-EXPORT (manual)") {
            return !REEXPORT_BASELINE.has(`${relative(ROOT, x.file)}:${x.line}`)
          }
          return true
        })
        for (const item of v) item.file = relative(ROOT, item.file)
        allViolations.push(...v)
      }
    }

    if (allViolations.length > 0) {
      const lines = allViolations.map(
        (v) =>
          `  ${v.file}:${v.line}\n    [${v.kind}] ${v.name}\n    ${v.snippet}`,
      )
      throw new Error(
        `Found ${allViolations.length} export(s) from "use server" files that violate Next 16's "Server Actions must be async functions" rule.\n\n${lines.join("\n\n")}\n\n` +
          `Fix: convert sync exports to async functions, or move them to a sibling non-server module. Re-exports flagged as (manual) need to be hand-audited and added to REEXPORT_BASELINE in this test file once verified.`,
      )
    }
  })
})
