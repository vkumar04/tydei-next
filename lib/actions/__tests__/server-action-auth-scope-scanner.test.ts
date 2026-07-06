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

async function scanFile(
  absPath: string,
  opts: { requireUseServer: boolean } = { requireUseServer: true },
): Promise<RawIdHit[]> {
  const rel = path.relative(REPO_ROOT, absPath)
  if (FILE_ALLOWLIST.has(rel)) return []

  const text = await fs.readFile(absPath, "utf8")
  // "use server" files are the RPC surface. API route handlers
  // (app/api/**) are an equally-reachable tenant surface but aren't
  // "use server" — scan them too (2026-06-18 pre-prod audit: a real
  // IDOR hid in app/api/ai/extract-amendment which this gate skipped).
  if (opts.requireUseServer && !/^['"]use server['"]/m.test(text)) return []

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
  // ai/document-index.ts: indexStatus updates (by id) in helpers called from
  // gated AI actions only. The ownership read at the top is now a single scoped
  // findFirst (contract: contractsOwnedByFacility) — auto-exempt. Lines bumped
  // 2026-06-21 after that fold-in added a few lines above these updates.
  "lib/actions/ai/document-index.ts:59",
  "lib/actions/ai/document-index.ts:84",
  "lib/actions/ai/document-index.ts:105",
  // ai-credits.ts: FIXED 2026-06-09 (audit BLOCKER) — all actions now
  // session-tenant-scoped via sessionTenant()/requireOwnedCredit; the
  // remaining by-id ops carry auth-scope-scanner-skip comments.
  // alerts.ts: the synthesize-pipeline resolve-by-id transaction moved
  // to lib/alerts/synthesize-persist.ts (2026-06-09 audit H4 — system
  // contexts need it without a session); no by-id ops remain here.
  // benchmarks.ts: getBenchmark / getBenchmarks were SCOPED on 2026-07-05
  // (security audit) — they no longer read the table unscoped. A vendor-
  // uploaded row is now readable only by its owning vendor (national rows,
  // vendorId null, by anyone), via a `{ OR: [{vendorId:null},{vendorId:
  // caller}] }` findFirst/findMany. The former allowlist entry was removed;
  // the create/update/delete/bulkImport MUTATIONS are requireAdmin (auto-
  // exempt).
  // bundles.ts: updateBundle (292) / deleteBundle (333) run
  // assertBundleOwnedByFacility(facility.id, bundleId) — which findFirst's
  // the bundle via `primaryContract: contractsOwnedByFacility(...)` — IMMEDIATELY
  // before the bare-id update/delete the scanner sees (2026-06-17 security
  // fix). Same legitimate assert-then-mutate pattern as reports/schedule.ts
  // below; the static scanner can't follow the helper call. (The PRIOR
  // allowlist here claimed a "post-fetch facility equality check" that did
  // NOT exist and hid a real IDOR — these entries are the genuine fix.)
  "lib/actions/bundles.ts:295",
  "lib/actions/bundles.ts:337",
  // categories.ts: requireAdmin gates via admin-only UI; scanner
  // already exempts requireAdmin functions but these are public
  // reads / user-create paths
  // bumped 2026-06-09 after removeInverseCategoryMapping import + the
  // confirm-mapping cycle guard added lines; bumped again after the
  // normalizeCategoryKey import (DRY cleanup) shifted both by one line.
  "lib/actions/categories.ts:151",
  "lib/actions/categories.ts:196",
  // change-proposals.ts: post-mutation re-read
  "lib/actions/change-proposals.ts:177",
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
  // shifted the delete. bumped 2026-06-15 after extracting
  // computeSyntheticContractPeriods (exported fallback reused by the
  // facility Reports surface) added the wrapper + doc-comment lines above
  // these re-reads.
  // bumped 2026-06-18 after computeSyntheticContractPeriods gained the
  // precomputedCogUniverse perf param (+ if-block) shifted these re-reads.
  // bumped 2026-06-20 after getContractCreditsAndPayments + the credit/payment
  // dedicated-table write were added above the delete (Charles capital-credit
  // ledger fix), shifting the guarded rebate.delete from 715 → 790. The delete
  // still verifies ownership via the contractOwnershipWhere find + the scoped
  // findFirstOrThrow on {id, contractId} immediately above it.
  "lib/actions/contract-periods.ts:484",
  "lib/actions/contract-periods.ts:790",
  // contracts/proposals.ts: every read is followed by explicit
  // proposal.contract.facilityId !== facility.id throw
  "lib/actions/contracts/proposals.ts:96",
  "lib/actions/contracts/proposals.ts:120",
  "lib/actions/contracts/proposals.ts:163",
  "lib/actions/contracts/proposals.ts:174",
  "lib/actions/contracts/proposals.ts:211",
  "lib/actions/contracts/proposals.ts:224",
  "lib/actions/contracts/proposals.ts:267",
  "lib/actions/contracts/proposals.ts:283",
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
  // bumped again 2026-06-11 after the B1 dedupe-window extension
  // (CREATE_DEDUPE_WINDOW_MS + widened idempotencyPut calls) shifted them.
  // bumped again 2026-06-21 after the trailing-12mo window dedup
  // (getTrailing12MonthWindow) collapsed two inline window blocks above,
  // shifting these by -3.
  "lib/actions/contracts.ts:1651",
  "lib/actions/contracts.ts:1671",
  // imports/case-costing-import.ts: REMOVED from baseline 2026-06-09
  // (case-costing audit batch) — the remaining by-id ops (primaryCptCode
  // update, margin-rollup re-read + update) now carry inline
  // auth-scope-scanner-skip comments; caseIds come from facility-scoped
  // lookups/creates upstream.
  // invoices/dispute.ts: post-fetch facility equality check
  "lib/actions/invoices/dispute.ts:45",
  "lib/actions/invoices/dispute.ts:107",
  // invoices.ts: post-fetch ownership probe before mutation
  // (invoices.ts:325 removed 2026-06-09 — validateInvoice's render-time
  // line-item write moved into revalidateInvoice, which carries an
  // explicit auth-scope-scanner-skip on its facility-scoped update.)
  // (lines bumped 2026-06-10 — importInvoice gained the poNumber→PO
  // resolution path + header totals, shifting the file down.)
  // (deleteInvoice's post-authorized delete now carries an inline
  // auth-scope-scanner-skip comment instead of a baseline entry —
  // 2026-06-17 best-practices sweep, robust to line drift.)
  "lib/actions/invoices.ts:246",
  // payor-contracts.ts: FIXED 2026-06-09 (audit BLOCKER) — the
  // calculatePayorMargins read is now facility-scoped (findFirstOrThrow
  // with facilityId).
  // renewals: post-fetch facility ownership equality check
  // (bumped 2026-06-09 after the M9 group-vendor OR clauses in
  // listRenewalNotesForVendor / submitRenewalProposal shifted lines)
  "lib/actions/renewals/notes.ts:187",
  "lib/actions/renewals/proposals.ts:223",
  // report-scheduling.ts: DELETED 2026-06-17 (was a duplicate, vulnerable
  // ReportSchedule CRUD module with unscoped where:{id} IDORs + a
  // client-trusted facilityId on create — the allowlist comment claimed an
  // "org-scoped session lookup" that did NOT exist). The correct,
  // facility-scoped module is lib/actions/reports/schedule.ts.
  // reports/schedule.ts: facility-scoped — each mutation runs a
  // findFirst({id, facilityId}) ownership check before the bare-id
  // update/delete the scanner sees (update 223, delete 254, toggle 270).
  "lib/actions/reports/schedule.ts:226",
  "lib/actions/reports/schedule.ts:258",
  "lib/actions/reports/schedule.ts:275",
  // settings.ts: all session-derived / assertCallerCanManage member
  // lookups now carry inline `// auth-scope-scanner-skip:` comments
  // (line-number baseline removed 2026-06-19 — the Settings/Users feature
  // shifted these lines and skip-comments are drift-proof). Covers
  // getFacilityProfile/getVendorProfile own-row reads and the
  // remove/update/access-tier member target fetches.
  // vendors.ts: read-only by id (Vendor is a shared resource)
  "lib/actions/vendors.ts:74",
])

describe("server-action auth-scope scanner (Charles audit suggestion #1)", () => {
  it("no NEW unscoped raw-id prisma ops in \"use server\" files (baseline regression catcher)", async () => {
    const files: string[] = []
    for (const d of SCAN_DIRS) {
      await walk(path.join(REPO_ROOT, d), files)
    }
    // API route handlers — same tenant surface, but not "use server".
    const apiFiles: string[] = []
    await walk(path.join(REPO_ROOT, "app/api"), apiFiles)

    const allHits: RawIdHit[] = []
    for (const f of files) {
      allHits.push(...(await scanFile(f, { requireUseServer: true })))
    }
    for (const f of apiFiles) {
      allHits.push(...(await scanFile(f, { requireUseServer: false })))
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
