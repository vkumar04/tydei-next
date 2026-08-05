# tydei-next — Claude Code instructions

Healthcare contract-management SaaS. Multi-tenant, holds PHI and financial
data. Three portals: facility (`/dashboard`), vendor (`/vendor`), admin
(`/admin`).

## Where design context lives

**The graphify knowledge graph is the source of truth for "why is this built
this way."** There is no `docs/` directory and no spec files — they were
removed on 2026-07-25 in favor of the graph.

```bash
/graphify query "<question>"        # ask the graph
```

Human-readable summary: `graphify-out/GRAPH_REPORT.md`. The graph records the
commit it was built from — if it looks stale, `graphify update .` (no API
cost). Do not write or cite `docs/...` paths; they don't exist.

For "what does this code do," read the code. For "what is the current API of
library X," use `/fresh-docs <lib>` rather than answering from memory.

## Commands

```bash
bun dev                  # dev server (Turbopack, :3000)
bun run build            # prisma generate + next build + standalone postbuild
docker compose up -d     # local Postgres (host port 5435 → 5432)
bun run db:push          # push schema
bun run db:seed          # seed demo data + qa sanity check
bun run db:studio        # Prisma Studio
bun run lint             # oxlint
bun run test:unit        # vitest (excludes integration)
bun run test:e2e         # playwright
```

The authoritative `DATABASE_URL` is in `.env` — trust it over any value
written down here. Port 5435 is deliberate; 5432 is usually taken.

Primary demo facility is **"Lighthouse Surgical Center"** (secondary:
"Lighthouse Community Hospital" — easy to confuse). Match by `name`, never a
hard-coded cuid: IDs regenerate on every `bun run db:seed`.

## Verify checklist

Run all of these before saying "ship it":

1. `bunx tsc --noEmit` → 0 errors
2. `bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'` → green
3. `rm -rf .next && bun run dev` → smoke the surfaces you touched

After file renames or server-action-heavy changes, `.next/` can cache stale
action hashes (`Server Action '<hash>' was not found on the server`). Fix with
`rm -rf .next`. If it survives a clean build, a client bundle is importing a
removed server-action export — grep for the name.

## Hard rules

These caused real production incidents. Each is enforced by a scanner test in
`lib/actions/__tests__/` — if one fails, fix the code, never the test.

- **Tenant isolation is the #1 invariant.** Every server action or API route
  taking a client-supplied id must scope it to the caller's own facility or
  vendor — `contractOwnershipWhere` / `contractsOwnedByFacility`
  (`lib/actions/contracts-auth.ts`), `contractsOwnedByVendor`
  (`lib/actions/contracts-vendor-auth.ts`). Guarded by
  `server-action-auth-scope-scanner.test.ts`. When it flags a bare
  `where: { id }`, add a real ownership check — never an allowlist comment
  exempting it.
- **Auth gates:** `requireFacility()` / `requireVendor()` / `requireAdmin()`
  from `@/lib/actions/auth`. Never raw session checks. Mutating actions also
  gate on `requireCanMutate()` (`lib/actions/auth-permissions.ts`) — the
  read-only `user` access tier must be blocked.
- **In a `"use server"` file, every export must be an async function.** A
  local `export type { X }` clause (no `from`) is NOT erased by Turbopack's
  prod transform — it emits `registerServerReference(X, …)`, throws
  `ReferenceError` at module load, and kills *every* action in the file.
  Dev works; prod doesn't. The from-form (`export type { X } from "…"`) is
  fine. Guarded by `use-server-async-export-scanner.test.ts`.
- **No `any`.** Strict mode is on.
- **Do not bump `typescript` past 6.x** until Next 16.3 is stable. TS 7
  removed the JS compiler API Next needs; on next@16.2.x it makes `next build`
  die with a silent SIGSEGV and zero diagnostics. TS 7 requires next ≥16.3 AND
  `experimental.useTypeScriptCli` — bump both together. Guarded by
  `typescript-version-pairing.test.ts`, which carries the full upgrade steps.

## Conventions

- **Prisma client:** `import { prisma } from "@/lib/db"`. Never construct one.
- **Canonical reducers.** Every business metric — rebates earned/collected,
  COG in-term-scope spend, vendor compliance, market share, per-supply rebate
  attribution, CPT reimbursement backfill — has exactly ONE helper that owns
  the filter, and every surface calls it. Parallel hand-rolled reducers on the
  same invariant have silently disagreed in production more than once. Before
  writing a reducer, check whether a helper already owns that number:
  `/graphify query "canonical helper for <metric>"`, or look for a
  `*-filter.ts` in `lib/contracts/`. Most are pinned by a parity test.
- **Rebate units are per-`rebateType`, not a blanket scale.**
  `ContractTier.rebateValue` is a fraction only for `percent_of_spend`; every
  other type stores dollars. Route all Prisma→engine scaling through
  `scaleRebateValueForEngine` (`lib/rebates/calculate.ts`). A blanket ×100
  turned a `$30,000` fixed rebate into `$3,000,000`.
- **Rebates are never auto-computed for display.** Earned/collected values come
  from explicit `Rebate` rows or `ContractPeriod` rollups. The tier engine is
  for clearly-labeled *projection* surfaces only.
- **Category and SKU names are never compared with raw `===` or Prisma `in`** —
  both are case-sensitive and under-count. Canonicalize both sides
  (`canonicalizeCategoryName`, `normalizeSku`).
- **TanStack Query keys come from the `lib/query-keys.ts` factory.** Never an
  inline literal. A query's read key and every invalidation that should refresh
  it must share a prefix — drifting literals caused three stale-cache bugs.
- **All PDFs render server-side** via `lib/pdf.ts` → `/api/reports/pdf`. Never
  add a client-side jsPDF helper; `grep -rl jspdf app components` must stay
  empty.
- **Editable/reorderable lists key by a stable id, never the array index**, or
  deleting a row reuses the wrong row's UI state.
- **Multi-write server-action sequences run in `prisma.$transaction`** using
  `tx`, not `prisma`.
- **Derive, don't mirror.** Compute from props/state during render or in
  `useMemo`; reset state with a `key` prop, not an effect.
- **`.xlsx` parsing goes through `parseXlsxMatrixBounded`**
  (`lib/xlsx/parse-xlsx-bounded.ts`) — never raw `workbook.xlsx.load`. It caps
  decompression bombs and trims the phantom 1M-row tail real exports carry.
- **File-header alias lists** (SKU / description / price column names) are
  imported from `lib/utils/parse-pricing-file.ts`, never re-inlined.

## AI actions

Every `"use server"` action calling the Anthropic API must:

1. `console.error('[<action-name>]', err, { facilityId, contractId })` before
   re-throwing. In prod the user only sees a digest; the server log is the
   only debugging path.
2. Surface a message naming the action and the failure kind — never let the
   client see "An error occurred in the Server Components render."

## Launch hardening

Demo login buttons are gated by the **`SHOW_DEMO_LOGINS`** server env var (not
`NEXT_PUBLIC` — when off, credentials never reach the client). Before launch:
set `SHOW_DEMO_LOGINS=false` **and** delete the demo users from the database.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
