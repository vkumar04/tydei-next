import { describe, it, expect } from "vitest"
import { promises as fs } from "fs"
import path from "path"

/**
 * Read-only-tier bypass regression catcher (2026-06-19 security remediation,
 * Part 3).
 *
 * The `user` access tier (read-only) is enforced by the access-tier matrix in
 * `lib/auth/permissions.ts`, surfaced as the one-line gate
 * `await requireCanMutate()` (`lib/actions/auth-permissions.ts`). But
 * `requireFacility()` / `requireVendor()` / `requireAuth()` do NOT check
 * `Member.accessTier` — so a read-only member could call a mutating server
 * action directly and still write.
 *
 * This scanner walks every `"use server"` file under `lib/actions/**` and,
 * for each EXPORTED `async function` whose body contains a prisma WRITE op
 * (`create|update|delete|upsert|createMany|updateMany|deleteMany`), asserts
 * the function references a capability gate:
 *   - `requireCanMutate()` (the canonical read-only gate), OR
 *   - `requireCan(...)` (a stricter Settings/Members capability), OR
 *   - `requireAdmin()` (platform-admin only — stricter than mutate), OR
 *   - a `// read-only-guard-skip: <reason>` comment inside the function
 *     (for legitimate system / best-effort / pre-auth writes), OR
 *   - the function name is in the explicit `ALLOWLIST` below.
 *
 * Mirrors the fs-walk + BASELINE/allowlist style of the sibling
 * `server-action-auth-scope-scanner.test.ts`.
 *
 * False-positive policy: prefer a one-line `read-only-guard-skip:` comment
 * (or an ALLOWLIST entry with a justification) over a silent ungated
 * mutation shipping to prod. If skips accumulate without good reasons, the
 * convention has eroded — re-audit that surface.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..")
const SCAN_DIR = "lib/actions"

const WRITE_OP_RE =
  /\b(?:prisma|tx)\.[a-zA-Z]+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/

const GATE_RE = /\b(requireCanMutate|requireCan|requireAdmin)\s*\(/
const SKIP_MARKER = "read-only-guard-skip:"

/**
 * Exported async server actions that write but are intentionally NOT gated by
 * `requireCanMutate`. Keyed by `relativePath#functionName`. Each MUST carry a
 * justification — these are pre-auth / self-service / unauthenticated paths
 * that do not cross a tenant mutation boundary the read-only tier governs.
 */
const ALLOWLIST = new Set<string>([
  // Unauthenticated self-service password flow — no requireFacility/requireVendor,
  // no Member.accessTier in scope; the caller is (by definition) not yet a
  // gated member. Mutates better-auth state, not tenant data.
  "lib/actions/auth.ts#requestPasswordReset",
  "lib/actions/auth.ts#resetPassword",
])

interface Hit {
  file: string
  fn: string
  line: number
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue
      await walk(full, out)
    } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) {
      out.push(full)
    }
  }
}

/**
 * Extract the full text + start line of every `export async function NAME`
 * block in a file by brace-balancing from the declaration.
 */
function extractExportedAsyncFns(
  lines: string[],
): { name: string; body: string; startLine: number }[] {
  const out: { name: string; body: string; startLine: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*export\s+async\s+function\s+([A-Za-z0-9_]+)\b/)
    if (!m) continue
    const name = m[1]
    let depth = 0
    let seenOpen = false
    let end = lines.length - 1
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) {
        if (ch === "{") {
          depth++
          seenOpen = true
        } else if (ch === "}") {
          depth--
          if (seenOpen && depth === 0) {
            end = j
            break
          }
        }
      }
      if (seenOpen && depth === 0) break
    }
    out.push({
      name,
      body: lines.slice(i, end + 1).join("\n"),
      startLine: i + 1,
    })
  }
  return out
}

async function scanFile(absPath: string): Promise<Hit[]> {
  const rel = path.relative(REPO_ROOT, absPath)
  const text = await fs.readFile(absPath, "utf8")
  if (!/^['"]use server['"]/m.test(text)) return []

  const lines = text.split("\n")
  const fns = extractExportedAsyncFns(lines)
  const hits: Hit[] = []

  for (const fn of fns) {
    if (!WRITE_OP_RE.test(fn.body)) continue // not a writer
    if (ALLOWLIST.has(`${rel}#${fn.name}`)) continue
    if (GATE_RE.test(fn.body)) continue // gated
    if (fn.body.includes(SKIP_MARKER)) continue // explicit skip with reason
    hits.push({ file: rel, fn: fn.name, line: fn.startLine })
  }

  return hits
}

describe("read-only mutation guard scanner (Part 3 security remediation)", () => {
  it("every exported writing server action under lib/actions is gated by requireCanMutate/requireCan/requireAdmin (or carries a justified skip/allowlist)", async () => {
    const files: string[] = []
    await walk(path.join(REPO_ROOT, SCAN_DIR), files)

    const hits: Hit[] = []
    for (const f of files) {
      hits.push(...(await scanFile(f)))
    }

    if (hits.length > 0) {
      const detail = hits
        .map((h) => `  ${h.file}:${h.line}  →  export async function ${h.fn}()`)
        .join("\n")
      throw new Error(
        `Found ${hits.length} exported writing server action(s) with NO read-only-tier gate.

A read-only ("user" tier) member can call these directly and still write
to the DB. Fix each by adding, right after the requireFacility()/
requireVendor()/requireAuth() resolution and before the write:

    await requireCanMutate()   // from "@/lib/actions/auth-permissions"

If the write is a legitimate system / best-effort / pre-auth path that the
read-only tier does not govern, add a one-line comment inside the function:

    // read-only-guard-skip: <reason>

…or add the "relativePath#functionName" key to the ALLOWLIST in this test
with a justification.

Ungated writers:
${detail}`,
      )
    }

    expect(hits).toEqual([])
  })
})
