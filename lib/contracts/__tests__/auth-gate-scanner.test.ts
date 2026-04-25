import { describe, it, expect } from "vitest"
import { promises as fs } from "fs"
import path from "path"

/**
 * Charles 2026-04-25 (audit follow-up): the proxy at proxy.ts only
 * checks for the PRESENCE of a session cookie — it doesn't enforce
 * the user's ROLE matches the path namespace. A vendor user hitting
 * /dashboard/* gets bounced by `requireFacility()` at the page
 * layer, but ONLY if the page actually calls that guard. A new
 * page that forgets is world-readable to any logged-in user.
 *
 * Rather than rebuild the proxy with a heavyweight session-decode
 * (which adds edge latency and brittle cookie parsing), enforce the
 * invariant at CI time: every page.tsx under app/dashboard, app/vendor,
 * or app/admin MUST reference the corresponding role guard.
 *
 * Allowlist exists for legit exceptions (404 pages, public-by-design
 * routes); add to it with a reason.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..")

type Gate = {
  pathPrefix: string
  // Substrings the page (or any imported file at the same level) must contain.
  // Most pages call the guard inline; some thin pages re-export a Client
  // component that calls the guard — so we accept either signal.
  requiredPatterns: string[]
}

const GATES: Gate[] = [
  {
    pathPrefix: "app/dashboard",
    requiredPatterns: ["requireFacility", "requireAdmin"],
  },
  {
    pathPrefix: "app/vendor",
    requiredPatterns: ["requireVendor", "requireAdmin"],
  },
  {
    pathPrefix: "app/admin",
    requiredPatterns: ["requireAdmin"],
  },
]

// Files allowed to skip the gate. Each entry MUST carry a "why".
const ALLOWLIST = new Set<string>([
  // Pure server-side redirects (no rendering) — the destination page
  // gates. Adding requireFacility here would just add an extra round-
  // trip with no security benefit since redirect() exits before
  // anything renders.
  "app/admin/page.tsx",
  "app/dashboard/purchase-orders/new/page.tsx",
  // Client-only ("use client") page — a server-side `await` guard
  // can't go here. The role gate must wrap this in a server layout
  // or the page must be split into a server shell + client child.
  // TODO: refactor to server-shell pattern so this can come off the
  // allowlist. Until then, the data hooks (useQuery → server actions
  // that call requireFacility) provide row-level enforcement.
  "app/dashboard/reports/price-discrepancy/page.tsx",
])

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[]
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as typeof entries
  } catch {
    return out
  }
  for (const entry of entries) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === ".claude" ||
      entry.name === ".worktrees"
    )
      continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (
      entry.isFile() &&
      (entry.name === "page.tsx" || entry.name === "page.ts")
    )
      out.push(full)
  }
  return out
}

describe("auth-gate scanner (Charles 2026-04-25)", () => {
  it("every page.tsx in a role-namespaced route calls the matching guard", async () => {
    const violations: Array<{ file: string; gate: Gate }> = []
    for (const gate of GATES) {
      const root = path.join(REPO_ROOT, gate.pathPrefix)
      const pages = await walk(root)
      for (const page of pages) {
        const rel = path.relative(REPO_ROOT, page)
        if (ALLOWLIST.has(rel)) continue
        const text = await fs.readFile(page, "utf-8")
        // Also scan any same-directory client component the page
        // re-exports — common pattern is page.tsx → import { X }
        // from "./x-client"; the guard is usually in x-client.
        const matches = gate.requiredPatterns.some((p) => text.includes(p))
        if (matches) continue
        // Look at sibling files — the guard might live in a client
        // file imported via `./x-client` or similar.
        const dir = path.dirname(page)
        let siblingHasGuard = false
        try {
          const siblings = await fs.readdir(dir)
          for (const sib of siblings) {
            if (sib === path.basename(page)) continue
            if (!sib.endsWith(".tsx") && !sib.endsWith(".ts")) continue
            const sibText = await fs.readFile(path.join(dir, sib), "utf-8")
            if (gate.requiredPatterns.some((p) => sibText.includes(p))) {
              siblingHasGuard = true
              break
            }
          }
        } catch {
          // ignore
        }
        if (!siblingHasGuard) violations.push({ file: rel, gate })
      }
    }
    if (violations.length > 0) {
      const formatted = violations
        .map(
          (v) =>
            `  ${v.file}\n    → must call one of: ${v.gate.requiredPatterns.join(", ")}`,
        )
        .join("\n\n")
      throw new Error(
        `\n${violations.length} role-namespaced page(s) skip the auth gate:\n\n${formatted}\n\nAdd \`await requireFacility()\` / \`requireVendor()\` / \`requireAdmin()\` to the page (or the client component it imports). Allowlist in this test file with a reason if the route is public by design.\n`,
      )
    }
    expect(violations).toEqual([])
  })
})
