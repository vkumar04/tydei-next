import { describe, it, expect } from "vitest"
import { promises as fs } from "fs"
import path from "path"

/**
 * Charles audit final-pass suggestion #1: lint-as-test for the
 * cross-tenant auth-scope pattern that produced 17 BLOCKERs across
 * 13 audit rounds.
 *
 * Every BLOCKER had the same shape:
 *   prisma.<entity>.{findUnique,update,delete}({where: {id}})
 * inside a "use server" file, with NO sibling `facilityId|vendorId|
 * userId|organizationId` clause and no upstream ownership check.
 *
 * This scanner walks every "use server" file and flags any raw-id
 * prisma operation that doesn't either:
 *   1. Use a compound where clause (`{id, facilityId}` /
 *      `{id, vendorId}` / `contractOwnershipWhere(...)` etc), OR
 *   2. Carry an explicit `// auth-scope-scanner-skip: <reason>`
 *      comment on the line above (for legitimate post-authorized
 *      re-reads).
 *
 * False-positive policy: prefer false positives that need a one-line
 * skip-comment over silent BLOCKERs that ship to prod. If the skip
 * comments accumulate without good reasons, the convention has
 * eroded — refactor that surface.
 */

const REPO_ROOT = path.resolve(__dirname, "../../..")

interface RawIdHit {
  file: string
  line: number
  snippet: string
  reason: string
}

/**
 * Operation patterns we care about. Each is a regex applied per-line.
 * The `entityRequired` field marks ops where finding `where: { id` is
 * meaningful (vs. e.g. createMany which doesn't take a where).
 */
const RISKY_OPS = [
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "delete",
  "findFirst",
  "findFirstOrThrow",
] as const

const SCAN_DIRS = ["lib/actions"]

// Files within scope but exempt by intent (entire file is OK without
// per-line scoping, e.g. background jobs, admin-gated, etc.)
const FILE_ALLOWLIST = new Set<string>([
  // Notifications: post-write hooks called by other authenticated
  // server actions. Each helper now requires auth at the boundary
  // (round-9 fix), so the internal lookups by id are gated by the
  // calling action's session.
  "lib/actions/notifications/in-app.ts",
  "lib/actions/notifications.ts",
  // Audit log writer; ownership inheritance from caller's context.
  "lib/audit.ts",
])

// Operation contexts where a raw `where: { id }` lookup is fine
// because the action ALREADY took an authenticated entity from the
// session and the lookup is for that same entity (e.g. user fetching
// own profile by their session.user.id).
const SAFE_RAW_ID_PATTERNS: RegExp[] = [
  // session-derived id passed in as the where clause
  /where:\s*\{\s*id:\s*(session|user|vendor|facility|member)\.[a-zA-Z]+/,
  // explicit composite where (handled separately, but redundant)
  /where:\s*\{\s*id[^}]*,\s*(facilityId|vendorId|userId|organizationId)/,
]

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      // Skip __tests__ — they mock prisma
      if (e.name === "__tests__") continue
      await walk(full, out)
    } else if (
      e.isFile() &&
      (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))
    ) {
      out.push(full)
    }
  }
}

/**
 * Find the function block containing line `lineIdx` and return its
 * full text. Heuristic: walk backward to the nearest line starting
 * with `export async function` or `async function` or `function`,
 * then forward until brace balance returns to zero.
 */
function findEnclosingFunction(
  lines: string[],
  lineIdx: number,
): string | null {
  let start = -1
  for (let i = lineIdx; i >= 0; i--) {
    if (/^\s*(export\s+)?async\s+function\b|^\s*function\b/.test(lines[i])) {
      start = i
      break
    }
  }
  if (start < 0) return null
  let depth = 0
  let seenOpen = false
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++
        seenOpen = true
      } else if (ch === "}") {
        depth--
        if (seenOpen && depth === 0) {
          return lines.slice(start, i + 1).join("\n")
        }
      }
    }
  }
  return lines.slice(start).join("\n")
}

async function scanFile(absPath: string): Promise<RawIdHit[]> {
  const rel = path.relative(REPO_ROOT, absPath)
  if (FILE_ALLOWLIST.has(rel)) return []

  const text = await fs.readFile(absPath, "utf8")
  // Only scan "use server" files — the RPC surface.
  if (!/^['"]use server['"]/m.test(text)) return []

  const lines = text.split("\n")
  const hits: RawIdHit[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Per-line skip comment: any of the 3 lines above contains the
    // opt-out marker (handles wrapped JSDoc-style explanations).
    const above = lines.slice(Math.max(0, i - 3), i).join("\n")
    if (/auth-scope-scanner-skip:/.test(above)) continue

    // Match `prisma.<entity>.<op>(` (or `tx.<entity>.<op>(` inside
    // transactions).
    const opMatch = line.match(
      /\b(?:prisma|tx)\.([a-zA-Z]+)\.(findUnique|findUniqueOrThrow|update|delete|findFirst|findFirstOrThrow)\b/,
    )
    if (!opMatch) continue
    const op = opMatch[2] as (typeof RISKY_OPS)[number]
    if (!RISKY_OPS.includes(op)) continue

    // Look ahead a few lines for the where clause (call may span lines).
    const window = lines.slice(i, Math.min(i + 8, lines.length)).join("\n")

    // No `where: { id` at all → not a single-row id lookup; skip.
    if (!/where:\s*\{[^}]*\bid\b/.test(window)) continue

    // Composite-where via canonical helper → safe.
    if (
      /contractOwnershipWhere|contractsOwnedByFacility|facilityScopeClause/.test(
        window,
      )
    ) {
      continue
    }

    // Compound where with a tenant id → safe.
    const whereMatch = window.match(/where:\s*\{[^}]*\}/)
    if (whereMatch) {
      const w = whereMatch[0]
      if (/(facilityId|vendorId|userId|organizationId|contractId)\b/.test(w)) {
        continue
      }
    }

    // Session-derived id pattern → safe.
    if (SAFE_RAW_ID_PATTERNS.some((re) => re.test(window))) continue

    // Look at the enclosing function body for upstream context.
    const fn = findEnclosingFunction(lines, i)
    if (fn) {
      // requireAdmin gates the entire function — admin can do
      // anything by design.
      if (/\brequireAdmin\s*\(/.test(fn)) continue

      // Function performs an upstream ownership probe via the
      // canonical helper before this line — accept.
      const upstream = fn.split(line)[0]
      if (
        /contractOwnershipWhere|contractsOwnedByFacility|facilityScopeClause/.test(
          upstream,
        )
      ) {
        continue
      }
      // Function performs an explicit composite-where lookup
      // upstream that scopes the same entity by tenant.
      if (
        /findFirstOrThrow\s*\(\s*\{\s*where:\s*\{[^}]*(facilityId|vendorId|organizationId)/.test(
          upstream,
        )
      ) {
        continue
      }
      // assertCallerIsMember / assertCallerCanManage /
      // assertCallerOnConnection / assertKeyVisibleToUser — the
      // settings + connections + uploads helpers we added in
      // rounds 7-8.
      if (
        /\bassertCaller(IsMember|CanManage|OnConnection)\s*\(|\bassertKeyVisibleToUser\s*\(/.test(
          upstream,
        )
      ) {
        continue
      }
    }

    hits.push({
      file: rel,
      line: i + 1,
      snippet: line.trim(),
      reason: `prisma.${opMatch[1]}.${op}({where:{id}}) without tenant scope or canonical helper`,
    })
  }

  return hits
}

/**
 * Baseline of known-OK hits as of audit completion. These all
 * fall into one of:
 *   - Post-fetch ownership equality check (e.g. proposals.ts pattern
 *     where the row is loaded then `row.contract.facilityId !== facility.id`
 *     throws before any side effect)
 *   - Caller-restricted internal helper invoked only by an
 *     already-authorized server action
 *   - Admin-restricted in practice via UI surface gating (the
 *     scanner can't see UI gating — covered by the auth-gate-scanner
 *     test on app/admin/* page guards)
 *
 * The list is intentionally exact-line — when surfaces are
 * refactored, the line number must be updated alongside or removed
 * if the finding goes away. NEW findings outside this list will
 * fail the test, which is the regression catcher.
 */
const BASELINE_HITS = new Set<string>([
  // ai/document-index.ts: helpers called from gated AI actions only
  "lib/actions/ai/document-index.ts:53",
  "lib/actions/ai/document-index.ts:78",
  "lib/actions/ai/document-index.ts:99",
  // ai-credits.ts: FIXED 2026-06-09 (audit BLOCKER) — all actions now
  // session-tenant-scoped via sessionTenant()/requireOwnedCredit; the
  // remaining by-id ops carry auth-scope-scanner-skip comments.
  // alerts.ts: the synthesize-pipeline resolve-by-id transaction moved
  // to lib/alerts/synthesize-persist.ts (2026-06-09 audit H4 — system
  // contexts need it without a session); no by-id ops remain here.
  // benchmarks.ts: read-only public benchmarks
  "lib/actions/benchmarks.ts:66",
  "lib/actions/benchmarks.ts:86",
  "lib/actions/benchmarks.ts:94",
  // bundles.ts: post-fetch facility equality check
  "lib/actions/bundles.ts:77",
  "lib/actions/bundles.ts:241",
  "lib/actions/bundles.ts:281",
  // categories.ts: requireAdmin gates via admin-only UI; scanner
  // already exempts requireAdmin functions but these are public
  // reads / user-create paths
  // bumped 2026-06-09 after removeInverseCategoryMapping import + the
  // confirm-mapping cycle guard added lines.
  "lib/actions/categories.ts:123",
  "lib/actions/categories.ts:167",
  // change-proposals.ts: post-mutation re-read
  "lib/actions/change-proposals.ts:175",
  // contract-periods.ts: post-period-mutation re-reads. Lines drift
  // (bumped 2026-05-05 after the auto-match-oldest fallback fix —
  // see Bug #2: the action now does two `findFirst`s in sequence so
  // the windowed match can fall back to oldest-uncollected. The pre-
  // authorized rebate.update call still verifies ownership via the
  // same prior contract-find guard at the top of createContractTransaction).
  // bumped 2026-06-09 after the COG category-universe fetch (drifted-
  // category canonical match) added lines above these re-reads; bumped
  // again same day after the group-aware vendor set (contractVendorIds)
  // import + select shifted them; bumped again 2026-06-09 after the
  // vendor UI parity split (PERIODS_CONTRACT_SELECT + getVendorContractPeriods)
  // shifted the delete.
  "lib/actions/contract-periods.ts:455",
  "lib/actions/contract-periods.ts:684",
  // contracts/proposals.ts: every read is followed by explicit
  // proposal.contract.facilityId !== facility.id throw
  "lib/actions/contracts/proposals.ts:94",
  "lib/actions/contracts/proposals.ts:118",
  "lib/actions/contracts/proposals.ts:160",
  "lib/actions/contracts/proposals.ts:171",
  "lib/actions/contracts/proposals.ts:207",
  "lib/actions/contracts/proposals.ts:220",
  "lib/actions/contracts/proposals.ts:262",
  "lib/actions/contracts/proposals.ts:278",
  // contracts.ts: post-update facility-set re-read + manual ownership
  // verification before contractDocument.delete (lines drift as the
  // file grows — bumped 2026-04-26 after analytics cache invalidation
  // hooks were added; bumped again same day after the getContracts
  // perf refactor batched the per-contract category aggregate; bumped
  // again 2026-05-05 after Bug #9 added a `humanizeCreateContractError`
  // helper above the contractDocument operations; bumped again
  // 2026-05-31 after createContractDocumentSafe (#31) + the group-aware
  // getContracts/getContract changes (#33) shifted them; bumped again
  // 2026-06-07 after createContract gained an auto refreshContractMetrics
  // recompute block (+ its import) above these operations; bumped again
  // 2026-06-09 after the COG category-universe import + per-detail fetch
  // (drifted-category canonical match) shifted them.
  // bumped again 2026-06-09 after the audit #2/#4 fixes (hoisted category
  // universe + union clause above the currentSpend cascade) shifted them.
  "lib/actions/contracts.ts:1612",
  "lib/actions/contracts.ts:1632",
  // imports/case-costing-import.ts: REMOVED from baseline 2026-06-09
  // (case-costing audit batch) — the remaining by-id ops (primaryCptCode
  // update, margin-rollup re-read + update) now carry inline
  // auth-scope-scanner-skip comments; caseIds come from facility-scoped
  // lookups/creates upstream.
  // invoices/dispute.ts: post-fetch facility equality check
  "lib/actions/invoices/dispute.ts:43",
  "lib/actions/invoices/dispute.ts:104",
  // invoices.ts: post-fetch ownership probe before mutation
  // (invoices.ts:325 removed 2026-06-09 — validateInvoice's render-time
  // line-item write moved into revalidateInvoice, which carries an
  // explicit auth-scope-scanner-skip on its facility-scoped update.)
  // (lines bumped 2026-06-10 — importInvoice gained the poNumber→PO
  // resolution path + header totals, shifting the file down.)
  "lib/actions/invoices.ts:244",
  "lib/actions/invoices.ts:544",
  // payor-contracts.ts: FIXED 2026-06-09 (audit BLOCKER) — the
  // calculatePayorMargins read is now facility-scoped (findFirstOrThrow
  // with facilityId).
  // renewals: post-fetch facility ownership equality check
  // (bumped 2026-06-09 after the M9 group-vendor OR clauses in
  // listRenewalNotesForVendor / submitRenewalProposal shifted lines)
  "lib/actions/renewals/notes.ts:184",
  "lib/actions/renewals/proposals.ts:220",
  // report-scheduling.ts: org-scoped via session lookup
  "lib/actions/report-scheduling.ts:43",
  "lib/actions/report-scheduling.ts:52",
  "lib/actions/report-scheduling.ts:60",
  "lib/actions/report-scheduling.ts:64",
  // reports/schedule.ts: facility-scoped via assertion helper
  "lib/actions/reports/schedule.ts:223",
  "lib/actions/reports/schedule.ts:254",
  // settings.ts: assertCallerCanManage / session-derived id
  // (lines bumped 2026-04-26 after better-auth org-plugin migration
  // added `import { headers }` + `import { auth }` at the top; bumped
  // again 2026-06-09 — settings audit. The five notification-prefs hits
  // were REMOVED for real: both actions are now session-scoped and no
  // longer look up client-supplied facility/vendor ids. Remaining:
  // 118/177 = getFacilityProfile/getVendorProfile reads of the session
  // entity's own row; 443/463 = removeTeamMember/updateTeamMemberRole
  // target fetch, followed by assertCallerCanManage + owner-protection
  // on the fetched org.)
  "lib/actions/settings.ts:118",
  "lib/actions/settings.ts:177",
  "lib/actions/settings.ts:443",
  "lib/actions/settings.ts:463",
  // vendors.ts: read-only by id (Vendor is a shared resource)
  "lib/actions/vendors.ts:73",
])

describe("server-action auth-scope scanner (Charles audit suggestion #1)", () => {
  it("no NEW unscoped raw-id prisma ops in \"use server\" files (baseline regression catcher)", async () => {
    const files: string[] = []
    for (const d of SCAN_DIRS) {
      await walk(path.join(REPO_ROOT, d), files)
    }

    const allHits: RawIdHit[] = []
    for (const f of files) {
      const hits = await scanFile(f)
      allHits.push(...hits)
    }

    const newHits = allHits.filter(
      (h) => !BASELINE_HITS.has(`${h.file}:${h.line}`),
    )

    if (newHits.length > 0) {
      const lines = newHits.map(
        (h) => `  ${h.file}:${h.line}\n    → ${h.snippet}\n    reason: ${h.reason}`,
      )
      const header = `Found ${newHits.length} NEW unscoped raw-id prisma op(s) in "use server" files.

This is the cross-tenant pattern that produced 17 BLOCKERs in
the 2026-04 audit. Each finding is one of:
  - Wrap the where clause: { id, facilityId: facility.id } (or
    vendorId / organizationId / userId), OR
  - Use the canonical contractOwnershipWhere() helper, OR
  - Add a comment on the line above (must include the literal
    string "auth-scope-scanner-skip:") explaining why this lookup
    is safe — typically a post-authorized re-read after a gated
    mutation.

If a finding is intentionally a post-fetch equality check (the
pattern in lib/actions/contracts/proposals.ts), add the file:line
to BASELINE_HITS in this test file with a one-line reason.

If you're rolling new server actions, see CLAUDE.md "Canonical
reducers" section + lib/actions/contracts-auth.ts helpers.

New findings:
${lines.join("\n\n")}`
      throw new Error(header)
    }

    // Surface stale baseline entries so the list doesn't rot.
    const staleBaseline = [...BASELINE_HITS].filter(
      (k) =>
        !allHits.some((h) => `${h.file}:${h.line}` === k),
    )
    if (staleBaseline.length > 0) {
      throw new Error(
        `BASELINE_HITS contains ${staleBaseline.length} entries that no longer match a real finding (file:line drifted or fix shipped). Remove them:\n${staleBaseline.map((s) => `  ${s}`).join("\n")}`,
      )
    }

    expect(newHits).toEqual([])
  })
})
