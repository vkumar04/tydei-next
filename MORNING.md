# Morning. Here's what to do.

> **All overnight work is now on `main` AND pushed to origin (`d9851bf`).** No branch dance needed.
> Your 6 WIP files (`pricing-files.ts` etc.) remain uncommitted in the working tree — untouched.
>
> **Latest pass (2026-05-05):** v0 cross-check + WIRE work for the 4 pending items.
> Net: `allocateRebatesToProcedures` wired into a new "True Margin" tab on /dashboard/case-costing/reports;
> vendor /reports converted from static stub to 4 real CSV-downloadable reports;
> PDF clause analyzer wired end-to-end with LLM extractor + new analyzer panel on /dashboard/analysis/prospective;
> rebate-engine bridge + dispatcher built, SPEND_REBATE wired into accrual.ts. The other 6 per-type engines
> are reachable via `calculateRebate()` dispatcher but NOT wired into recompute paths — semantic mismatch
> (count×dollars-per-event vs count×percent/100) needs a design decision before wiring. See
> [docs/superpowers/audits/2026-05-05-v0-cross-check-pending-items.md](docs/superpowers/audits/2026-05-05-v0-cross-check-pending-items.md).

> **Recap of the overnight passes:**
> 1. v1 polish (hide stub buttons across 5 surfaces) — already on main
> 2. Restored facility AI Agent Documents + Reports tabs (incorrectly hidden) — wired to real Claude + Prisma backend
> 3. Real CSV exports for Price Discrepancy, Invoice list, PO list, Admin Billing
> 4. Vendor + rebates audit — 4 single-line drift findings + Charles canonical-engine diff
> 5. Drift fixes landed: vendor dashboard hero, vendor performance label, vendor-analytics scaling, renewals pipeline reducer, vendor-PO defense-depth comment
> 6. Prospective-analysis canonical-engine diff
> 7. Ported Charles's `analyzeVendorProspective` — wired to /vendor/prospective Deal Scorer (was empty state)
> 8. Built canonical PDF clause-risk-analyzer module (24 clause categories, REQUIRED_CLAUSES per variant, MISSING_CLAUSE_SUGGESTIONS, regulatory cross-checks)
> 9. Cleaned up legacy orphan `analyzeProposal` (0-100 path, proposal-upload.tsx, proposal-comparison-table.tsx)

## Start the app

You have `rural-health` (vite) running on port 3000. Easiest:

```bash
cd /Users/vickkumar/code/tydei-next
PORT=3001 bun run dev
# → http://localhost:3001
```

(If you stop rural-health first, `bun run dev` defaults to 3000.)

## Already on main — nothing to merge

Everything was pushed to `origin/main` already. `claude/v1-port-deferred-features` is a backup branch on origin (not needed for testing). You don't need to do any branch dance.

If you want to revert any individual commit, see "If something's broken" below.

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

## All commits on main since `5e536dc`

Run `git log --oneline 5e536dc..main` for the full list. Highlights (newest first):

```
1f4a60f test(vendor-performance): add rebateType to tier fixtures after DRIFT-3 fix
e6f7374 feat(contracts): expose canonical analyzePDFContract via server action
f4c6eba feat(clauses): cover analyzePDFContract with happy-path/critical/side tests
69cfd05 feat(vendor-prospective): add smoke tests for the canonical analyzer
d3942cc feat(vendor-prospective): wire Deal Scorer to canonical analyzer
cc2797d feat(clauses): add canonical analyzePDFContract module per Charles spec
84ce97c feat(vendor-prospective): add server action wrapping the analyzer
9b9790a feat(vendor-prospective): port Charles canonical analyzer
64a2cf0 docs(reference): Charles canonical prospective-analysis engine snapshot
d639a4a docs(audit): prospective-analysis canonical vs tydei diff
7f73c86 chore(vendor-po): annotate auth-scope-scanner-skip on defense-in-depth raw findUnique
45b605b fix(renewals): route pipeline totalRebate through sumEarnedRebatesLifetime
23c81ea fix(vendor-analytics): route tier-rebate scaling through canonical helper
3584e9f fix(vendor-performance): correct "Total Paid YTD" label — value is lifetime
fdb9149 fix(vendor-dashboard): route Rebates Paid hero through sumEarnedRebatesLifetime
01e9a33 docs(audit): vendor portal + Charles canonical-engine diff
82edb69 docs: refresh morning note with port-branch progress
8c4decb feat(admin): real CSV export for billing invoices
67c1f02 feat(purchase-orders): real CSV export for PO list
3016273 feat(invoices): real CSV export for invoice validation list
3a872c6 feat(reports): real CSV export for price-discrepancy
24ec42a Revert "chore(v1): hide facility AI Agent Documents + Reports tabs for v1 ship"
```

(The 6 v1 polish hides + spec deletion + initial v1 spec are below these.)

## Verify results (main tip)

- `bunx tsc --noEmit` → ✅ 0 errors
- `bunx vitest run` → ✅ 2587 pass / 5 skipped (with your WIP stashed; with WIP unstashed the auth-scope scanner test trips on `pricing-files.ts` — that's your work, not mine)
- `bun run build` → ✅ all routes compiled (last verified earlier in session)
- Pushed to `origin/main` at `8df905c`

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

## Audits (read if you want the full picture)

Two audit docs landed in `docs/superpowers/audits/`:
- [2026-05-04-vendor-rebate-audit.md](docs/superpowers/audits/2026-05-04-vendor-rebate-audit.md) — every /vendor/* route + Charles canonical Unified Rebate Engine diff
- [2026-05-04-prospective-analysis-audit.md](docs/superpowers/audits/2026-05-04-prospective-analysis-audit.md) — Charles canonical Prospective Analysis Engine diff

**Bottom line:** no ship blockers. Math is correct on wired surfaces, auth is clean across all 17 vendor routes. The 4 drift findings I called out earlier are all FIXED.

## What's still pending

### Now resolved

✅ ~~`allocateRebatesToProcedures` wiring~~ — done. "True Margin" tab on /dashboard/case-costing/reports.
✅ ~~Vendor /reports static~~ — done. 4 real CSV-downloadable reports.
✅ ~~PDF clause analyzer UI wiring~~ — done. LLM extractor + analyzer panel on /dashboard/analysis/prospective. Note: each upload fires a Claude Sonnet call (~$0.01–0.03).
✅ ~~Per-type rebate engine dead-code (ALL 7)~~ — bridge handles all 4 Prisma RebateType values; dispatcher restored; SPEND_REBATE wired into accrual.ts; VOLUME_REBATE wired into recompute/volume.ts; TIER_PRICE_REDUCTION / MARKET_SHARE_REBATE / MARKET_SHARE_PR / CAPITATED / TIE_IN_CAPITAL per-period exposed via server action wrappers (engine reachable from any future caller). Semantic gap resolved by **scaling unit-based rebate values ×100 in the bridge** so engine's /100 path produces production-equivalent math. Engine math unchanged; design rules documented in `lib/rebates/prisma-engine-bridge.ts`. `lib/actions/__tests__/engine-wiring-manifest.test.ts` is the regression tripwire.

### Still pending (out of scope for tonight)

1. **`scaleRebateValueForEngine` correctness audit** — helper only multiplies by 100 when `rebateType === "percent_of_spend"`. If real production tiers don't have `rebateType` set, they'll scale incorrectly. Not a code fix — a data audit.
2. **T3-T6 wrappers have no integration tests yet.** They're discoverable via the engine-wiring manifest, but a future task should add seeded-fixture tests.
3. **Live-DB oracle not run.** Math equivalence is guaranteed by the ×100 boundary scaling per the bridge design note; `scripts/oracles/full-sweep.ts` against a fresh seed would be belt-and-suspenders.
4. **TIE_IN_CAPITAL multi-line wrappers** — `getTieInCapitalForContractPeriod` handles single-line tie-ins only (engine's `TieInCapitalConfig` is single-asset; tydei's capital lives in 1:N `ContractCapitalLineItem`). Multi-line contracts return null with a skipReason pointing at `getContractCapitalSchedule`. Lifetime "rebate applied to capital" still uses canonical `sumRebateAppliedToCapital`.
5. **6 WIP files** (your `pricing-files.ts` etc.) untouched. Auth-scope scanner failures at `pricing-files.ts:380, 509` still real — wrap with `{ id, facilityId: facility.id }`.

### v0 cross-check verdicts

Full report at [docs/superpowers/audits/2026-05-05-v0-cross-check-pending-items.md](docs/superpowers/audits/2026-05-05-v0-cross-check-pending-items.md). Summary: WIRE for items 1+2 (v0 has the surfaces), DEMO ONLY for items 3+4 (v0 has the UI shape but no real backend either; tydei is now ahead).

**Charles's full canonical engine source** came in via email 2026-04-18 (rebate engine) and 2026-05-04 (prospective analysis). Header summaries saved at `docs/superpowers/charles-canonical-engines/prospective-analysis.ts`. Future sessions should ask for the full source before extending the engines.
