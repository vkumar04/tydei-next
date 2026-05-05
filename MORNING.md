# Morning. Here's what to do.

> **Update from second overnight session:** I dispatched a port pass on a separate branch
> (`claude/v1-port-deferred-features`). It (a) restored the **facility AI Agent Documents +
> Reports tabs** that were incorrectly hidden — those were real, fully-built features wired to
> Claude + Prisma; the polish subagent treated them like the vendor placeholders by mistake,
> and (b) wired **real CSV exports** for Price Discrepancy, Invoice list, PO list, and
> Admin Billing using the existing `lib/reports/csv-export.ts` utility. **None of this is on
> `main` yet** — see "How to land it" below.

## Start the app

You have `rural-health` (vite) running on port 3000. Easiest:

```bash
cd /Users/vickkumar/code/tydei-next
PORT=3001 bun run dev
# → http://localhost:3001
```

(If you stop rural-health first, `bun run dev` defaults to 3000.)

## How to land the port work

The port branch has 5 new commits sitting on top of `main`. Two ways to land:

```bash
# Option A — merge the whole branch (recommended if you like everything):
git checkout main
git merge claude/v1-port-deferred-features
# → main now has the AI un-hide + 4 CSV exports

# Option B — cherry-pick just the pieces you want:
git checkout main
git cherry-pick 24ec42a   # facility AI un-hide
git cherry-pick 3a872c6   # price discrepancy CSV
git cherry-pick 3016273   # invoice CSV
git cherry-pick 67c1f02   # PO CSV
git cherry-pick 8c4decb   # admin billing CSV
```

If you'd rather review the branch in isolation first:

```bash
git checkout claude/v1-port-deferred-features
# test on http://localhost:3001, then decide
```

## Test order

### Port branch features (NEW — only visible if you merged or checked out the port branch)
1. `/dashboard/ai-agent` — should show **3 tabs**: Chat / Documents / Reports. Documents tab lists indexed contract docs with search; Reports tab takes a free-form prompt + contract picker and generates a CSV-downloadable structured report (real Claude call).
2. `/dashboard/reports/price-discrepancy` — Download button is back, generates real CSV from current table data.
3. `/dashboard/invoice-validation` — Export button is back. Per-row dispute still works.
4. `/dashboard/purchase-orders` — Export button back (Scan stays hidden — needs OCR).
5. `/admin/billing` — Export Report button back, exports the Stripe invoices slice.

### Polish work from earlier overnight (already on `main`)
6. `/vendor/ai-agent` — only **Chat** tab (vendor-side Documents/Reports were genuine "Coming soon" placeholders, kept hidden)
7. `/vendor/contracts/[any-id]` — no "Document upload" button (deferred)
8. Sweep the rest: `/dashboard`, `/dashboard/contracts`, `/dashboard/cog-data`, `/dashboard/rebate-optimizer`, `/vendor/dashboard`, `/admin/dashboard`

## Filter scope decisions for the CSV exports (from the subagent's report)

The CSV exports default to "what you're currently looking at" — i.e., active filters apply:

- **Invoice export** — exports search + vendor + dispute filters; tab (status) intentionally bypassed so one export covers all statuses
- **PO export** — exports tab + status + vendor + search applied
- **Price Discrepancy** — full data set (no row-level filter on that page)
- **Admin Billing** — Stripe invoices only (not subscriptions or MRR; CSV doesn't do tabs)

If you want "export everything regardless of filters" for any of these, the subagent flagged the exact variable swap to make it. See the commit message for `3016273` and `67c1f02`.

## All commits ahead of `origin/main`

```
ON BRANCH: claude/v1-port-deferred-features (5 ahead of main)
8c4decb feat(admin): real CSV export for billing invoices
67c1f02 feat(purchase-orders): real CSV export for PO list
3016273 feat(invoices): real CSV export for invoice validation list
3a872c6 feat(reports): real CSV export for price-discrepancy
24ec42a Revert "chore(v1): hide facility AI Agent Documents + Reports tabs for v1 ship"

ON main (10 ahead of origin/main, none pushed):
ea58614 chore(v1): morning test plan + verify summary
227defb chore(v1): hide vendor contract document upload + admin billing export for v1 ship
93f8f48 chore(v1): hide price-discrepancy report export button for v1 ship
5bf0f35 chore(v1): hide PO scan + export buttons for v1 ship
218d333 chore(v1): hide invoice-validation bulk-dispute + export buttons for v1 ship
cbcae4d chore(v1): hide facility AI Agent Documents + Reports tabs for v1 ship  ← reverted on port branch
f421c07 chore(v1): hide vendor AI Agent Documents + Reports tabs for v1 ship
474d2e7 docs(spec+plan): tydei v1 ship — declare done, hide stubs, ship
e019386 docs(specs): clear all specs to start v1-ship cycle
e603772 docs(spec): v0 parity inventory — turn the prototype into a checkable spec
```

## Verify results (port branch tip)

- `bunx tsc --noEmit` → ✅ 0 errors
- `bunx vitest run` → ✅ 2542 pass / 5 skipped (with your WIP stashed; with WIP unstashed the auth-scope scanner test trips on `pricing-files.ts` — that's your work, not mine)
- `bun run build` → ✅ all 70+ routes compiled

## One thing for you to look at (unchanged from earlier note)

Your uncommitted changes to `lib/actions/pricing-files.ts` (lines 380 and 509) trip the auth-scope scanner:

```
prisma.pricingFile.delete({ where: { id } })          // line 380
prisma.contractPricing.update({ where: { id } })       // line 509
```

Wrap with `{ id, facilityId: facility.id }` or use `contractOwnershipWhere(id, facility.id)` from `lib/actions/contracts-auth.ts`. I did not touch your WIP.

(Other uncommitted files — `new-contract-client.tsx`, `cog/pricing-columns.tsx`, `cog/pricing-files-table.tsx`, `validators/pricing-files.ts`, `docker-compose.yml` — also untouched.)

## If something's broken

Each commit is independently revertable:

```bash
git revert <SHA>          # one commit, keeps the others
```

To throw away the whole port branch without affecting `main`:

```bash
git branch -D claude/v1-port-deferred-features
```

To roll `main` back to before tonight:

```bash
git reset --hard 5e536dc  # loses everything from tonight (including the polish)
```

The 42 deleted specs are still recoverable:

```bash
git checkout 5e536dc -- docs/superpowers/specs/
```

## What's still NOT shipped (would need real backend or storage)

- Vendor AI Agent Documents + Reports tabs (v0's are also fake demos — not worth porting)
- Invoice Validation bulk dispute (needs workflow backend)
- Purchase Orders Scan-PO (needs OCR pipeline)
- Vendor Contract document upload (needs S3 + index pipeline)

Pick these up in a future cycle.

## TL;DR

1. Boot on 3001, log in
2. Decide: merge the port branch (`git merge claude/v1-port-deferred-features` from `main`) or cherry-pick the un-hide and CSV commits one at a time
3. Click through the 5 port-branch surfaces — those are the new wins
4. Sweep the other 8 sanity-check surfaces
5. If anything's broken, `git revert <SHA>` for that one commit

The single biggest unblock: the **facility AI Agent Documents + Reports tabs are real** and were hidden by mistake. Merging the port branch (or cherry-picking `24ec42a`) gets them back.

---

## Vendor + rebates audit (run after the morning sweep)

I also did a read-only audit of every `/vendor/*` surface AND a diff of Charles's canonical Unified Rebate Calculation Engine vs tydei's current implementation. Full report: [docs/superpowers/audits/2026-05-04-vendor-rebate-audit.md](docs/superpowers/audits/2026-05-04-vendor-rebate-audit.md).

**Bottom line:** no ship blockers. Math is correct on wired surfaces, auth is clean across all 17 vendor routes.

**Drift findings to fix (single-line each):**
- `lib/actions/vendor-dashboard.ts:31,60` — vendor dashboard "Rebates Paid" hero KPI under-reports (uses sparse `ContractPeriod._sum` instead of `sumEarnedRebatesLifetime`)
- `lib/actions/renewals.ts:90,138` — renewals pipeline `totalRebate` per card under-reports (same shape — affects FACILITY + VENDOR renewals)
- `components/vendor/performance/performance-rebates-tab.tsx:268` — labels lifetime data as "Total Paid YTD"
- `lib/actions/vendor-analytics.ts:452` — direct `* 100` scaling instead of `scaleRebateValueForEngine`

**Bigger architectural finding:** 7 of 8 per-type rebate engines in `lib/rebates/engine/*.ts` are **dead code** — they look like Charles's canonical engine but no production caller invokes them. Display + recompute paths re-derive tier math by hand. Decision needed: wire them or delete them. CARVE_OUT is the only one that's actually called. `allocateRebatesToProcedures` (true-margin) is also dead.

**Charles's full canonical engine source** came in via email 2026-04-18; partial copy at `/tmp/charles-canonical.b64`. Future Claude sessions should ask for the full file before any engine work.
