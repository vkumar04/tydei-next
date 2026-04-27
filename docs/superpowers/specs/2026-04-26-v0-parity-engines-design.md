# 2026-04-26 — v0 output parity + engine boundaries (design)

**Status:** draft / pre-brainstorm
**Author:** session w/ Vick on 2026-04-26
**Trigger:** PO (Charles Weidman) sent a batch of screenshots flagging recurring
bugs across facility + vendor surfaces. Vick asked whether splitting the app
into per-domain "engines" (rebate, contract, capital, etc.) would help. Pivoted
to: the real goal is **output parity with the v0 prototype** while using
production-grade canonical helpers to prevent drift.

This spec captures the survey state of both codebases and the bucket plans so
the work isn't lost between sessions. **Another Claude instance is currently
fixing the immediate PO bugs in parallel** — re-run the verification pass
(Section 5) against the new SHA before executing any bucket plan below.

## 1. Source material

### 1.1 PO feedback (3 screenshots, 14 distinct complaints)

Captured 2026-04-26 from Charles Weidman in iMessage. Complaints clustered:

| # | Complaint | Surface | Bucket |
|---|---|---|---|
| 1 | Header shows $0 rebate but forecast says non-zero | facility contract detail | A |
| 2 | Renewal Risk renders raw float `31.962831656955174` | facility contract detail Performance tab | C |
| 3 | Vendor contract detail Transactions tab empty despite $25,266 earned | vendor contract detail | A / D |
| 4 | Vendor Performance tab shows composite score / renewal risk that isn't useful — needs "performance and rebate data from facility side" | vendor contract detail | D |
| 5 | Tie-in amortization schedule "was good before, agent removed it" | tie-in contract detail | B (regression) |
| 6 | Vendor side missing transactions + accruals like facility side | vendor contract detail | D |
| 7 | No place to put division names on vendor enterprise account | vendor org/profile | D |
| 8 | Amortization schedule missing on vendor side | vendor contract detail | B / D |
| 9 | Categories should derive from pricing file, not manual entry | proposal builder | C |
| 10 | Proposal detail modal too sparse — "need the info like my set up" | proposal detail | C |
| 11 | Financial Analysis has no way to enter a hypothetical contract | `/financial-analysis` | C |
| 12 | "All vendors with a contract should be here" — Spend Rebate Tier Optimizer dropdown | rebate optimizer | C |
| 13 | Case Costing — "anything new in here?" (PO can't tell what changed) | case costing | C (UX) |
| 14 | Market share not showing on contract | facility contract detail | A |

### 1.2 v0 prototype location

`/Users/vickkumar/Downloads/b_T2SEkJJdo8w/` — read-only. Next.js App Router,
localStorage-backed, no Prisma. Treat as UX/output reference, not architecture
reference.

## 2. Survey: v0 prototype (what it has)

| Bucket | Key v0 artifact | Notes |
|---|---|---|
| A — Rebate | `lib/forecasting.ts:forecastRebates` (linear regression + tier projection) | Open-coded, scattered. v0 anti-pattern; tydei is already ahead here. |
| A — Market share | Stored as `currentMarketShare` field on contract | No derivation logic. |
| B — Capital | `components/contracts/tie-in-contract-details.tsx` `LeasedServiceItem` + `PaymentPeriod[]` | Manual schedule entry only — no auto-amortization calculator. |
| C — Categories | `lib/category-store.ts:extractCategoriesFromPricingFile` | **Clean reference for tydei.** Pricing upload → column detect → category store → form dropdown. |
| C — Financial Analysis | `app/dashboard/analysis/page.tsx` (retrospective NPV+IRR via bisection); `app/dashboard/analysis/prospective/page.tsx` (facility, dual-mode); `app/vendor/prospective/page.tsx` (vendor, hypothetical-only) | Dual-mode is the target. Tydei has prospective; verify NPV/IRR fields match. |
| C — Deal scoring | `lib/vendor-benchmark-store.ts:calculateDealScore` | priceScore / marginScore / marketShareScore / volumeScore → overallScore + riskLevel. |
| D — Vendor parity | Parallel route trees: `app/dashboard/contracts/[id]/page.tsx` (60KB) ↔ `app/vendor/contracts/[id]/page.tsx` (40KB) | v0 also has parallel implementations — output parity, not architecture parity, is the win. |
| D — Vendor surfaces | `vendor/market-share`, `vendor/performance`, `vendor/prospective` exist | Confirm tydei has equivalents. |
| D — Shared component | `ContractTransactions` accepts `userRole: 'facility' \| 'vendor'` | Only example of role-prop sharing in v0. |

## 3. Survey: tydei-next (what it has today)

### 3.1 Canonical helpers already in place

All present and wired across most surfaces (per CLAUDE.md "Canonical reducers"
table and parity tests in `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`):

- `sumCollectedRebates` — `lib/contracts/rebate-collected-filter.ts`
- `sumEarnedRebatesLifetime` / `sumEarnedRebatesYTD` — `lib/contracts/rebate-earned-filter.ts`
- `buildCategoryWhereClause` / `buildUnionCategoryWhereClause` — `lib/contracts/cog-category-filter.ts`
- `formatTierRebateLabel` — `lib/contracts/tier-rebate-label.ts`
- `formatRebateMethodLabel` — `lib/contracts/rebate-method-label.ts`
- `sumRebateAppliedToCapital` — `lib/contracts/rebate-capital-filter.ts`
- `contractOwnershipWhere` / `contractsOwnedByFacility` — `lib/actions/contracts-auth.ts`
- `computeRebateFromPrismaTiers` — `lib/rebates/calculate.ts`

### 3.2 Surfaces that already work despite PO complaints

The Explore survey confirmed these **are not actually broken in current main**
— either the PO is on a stale deploy, or the data state in the demo facility
isn't exercising the fallbacks:

- **Vendor amortization (#5, #8):** `app/vendor/contracts/[id]/vendor-contract-detail-client.tsx:16–20` wires `ContractAmortizationCard` with `getVendorContractCapitalSchedule` as fetcher and `scope="vendor"`. Renders correctly.
- **Financial Analysis hypothetical (#11):** `/dashboard/analysis` redirects to `/dashboard/analysis/prospective` which accepts manual hypothetical contract input.
- **Float formatting bug (#2):** No raw float renders found — all components route through `formatPercent`/`formatCurrency`. Suspect already fixed; need a screenshot against current SHA to confirm.
- **Vendor Transactions empty (#3):** `vendor-contract-overview.tsx:408+` has ContractPeriod → Rebate ledger fallback (Charles 2026-04-26 #71). Empty state means seed data lacks both — not a code bug.

### 3.3 Real gaps (vs v0 output)

- **C — Categories from pricing not wired into proposal builder + contract creation forms.** Vendor prospective `file-handlers.ts` extracts category names but downstream forms still allow manual entry. Need to confirm canonical-name resolver from commit 6d9328d covers all entry points.
- **C — Spend Rebate Tier Optimizer vendor dropdown (#12).** Commit 9482840 added shared-facility scope; PO still flags. Likely an empty-state UX issue (vendors with contracts but zero tier progress are hidden). Investigate query + UI together.
- **A — Market share (#14).** `getCategoryMarketShareForVendor` exists in `lib/actions/cog/category-market-share` but is **not in the canonical reducers invariants table**. Risk of future drift; missing from parity tests.
- **B — Vendor accrual timeline.** Facility has `/contracts/[id]/accrual-timeline`; vendor side has no equivalent. Real gap (PO complaint #6).
- **D — Vendor divisions (#7).** `prisma/schema.prisma` has `divisions` relation but `vendor-profile-form.tsx` uses `Vendor.division: string` (single value). Form needs multi-division editor.

## 4. Bucket plans

### Bucket A — Rebate output parity

Promote market-share into the canonical helper layer; extend parity tests to
vendor surfaces.

| Step | File | Action |
|---|---|---|
| A1 | `lib/contracts/market-share-filter.ts` (new) | Promote `getCategoryMarketShareForVendor` → canonical reducer; add row to CLAUDE.md invariants table |
| A2 | `components/contracts/contract-detail-client.tsx` + vendor counterpart | Wire canonical helper |
| A3 | `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts` | Extend to cover vendor surfaces (currently facility-only) |
| A4 | `prisma/seed.ts` | Seed Lighthouse Surgical Center with rebate rows that exercise both `payPeriodEnd <= today` gate and `collectionDate != null` gate so PO sees non-zero values |

### Bucket B — Capital / tie-in output parity

| Step | File | Action |
|---|---|---|
| B1 | E2E test (Playwright) | Verify vendor contract detail renders amortization card with non-zero schedule against seed |
| B2 | `lib/actions/contracts/accrual-timeline.ts` | Add vendor-scoped variant of facility accrual timeline |
| B3 | `components/vendor/contracts/vendor-contract-overview.tsx` | Add Accruals tab matching facility tabs |

### Bucket C — Derivation output parity (largest gap)

| Step | File | Action |
|---|---|---|
| C1 | `lib/cog/canonical-name.ts` | Verify resolver from commit 6d9328d exists; if not, port `lib/category-store.ts:extractCategoriesFromPricingFile` from v0 |
| C2 | `components/vendor/prospective/proposal-builder.tsx` | Auto-populate categories from pricing-file upload; remove manual-entry path |
| C3 | `app/dashboard/contracts/new/*` + creation forms | Same pricing-file → categories autofill on contract creation |
| C4 | `app/dashboard/analysis/*` | Confirm NPV + IRR outputs match v0 retrospective view (`app/dashboard/analysis/page.tsx` in v0 — bisection IRR) |
| C5 | `lib/actions/rebate-optimizer*` | Investigate vendor dropdown scope: query bug vs empty-state UX. Add empty-tier-progress vendors to dropdown with explicit zero state |
| C6 | (PO #2 float leak) | Once another Claude instance lands fixes, screenshot Performance tab against fresh SHA. If still raw, grep for `Renewal Risk` consumers |

### Bucket D — Vendor org / parity

| Step | File | Action |
|---|---|---|
| D1 | `prisma/schema.prisma` + migration | Audit `Vendor.division` (string) vs `Vendor.divisions` (relation); pick one and migrate |
| D2 | `components/vendor/profile/vendor-profile-form.tsx` | Replace single-division input with multi-division editor |
| D3 | `app/vendor/market-share`, `app/vendor/performance` | Audit feature parity vs v0 equivalents (`vendor/market-share/page.tsx`, `vendor/performance/page.tsx`) |
| D4 | Shared contract-detail component (deferred) | Don't pursue in first pass — v0 has parallel trees too. Output parity > maintenance refactor. Revisit after A–C close. |

## 5. Verification pass (run BEFORE executing any plan)

The other Claude instance is fixing PO bugs right now. Before any bucket plan
runs, confirm against the new SHA:

1. `git log -1 --format=%H main` and confirm deployed build matches.
2. `bun run db:seed` and verify Lighthouse Surgical Center has:
   - At least one tie-in contract with non-empty `ContractPeriod` rows (exercises facility Transactions tab).
   - Rebate rows where `payPeriodEnd <= today` AND some with `collectionDate != null` (exercises both reducers).
   - One contract assigned to the demo vendor (exercises vendor detail surfaces).
3. Walk through each of the 14 PO complaints in the live app; mark which are now resolved vs still drifting.
4. Re-grade the bucket plans — drop steps for already-resolved items.

## 6. Recommended execution order

1. **Verification pass** (Section 5) — eliminates phantom bugs.
2. **Bucket C** (highest PO signal + largest real gap).
3. **Bucket D1–D2** (vendor divisions data-model fix — clean and bounded).
4. **Bucket A1–A4** (market-share canonicalization + parity test extension — prevents next drift round).
5. **Bucket B2–B3** (vendor accrual timeline — the one real B gap).

Per CLAUDE.md, each bucket should run through brainstorming → writing-plans →
subagent-driven-development. Don't execute as one mega-plan.

## 7. Engine question (deferred)

Vick's original framing was: should we split into engines (rebate, contract,
capital, etc.)? **Answer: not yet, and not as a refactor for its own sake.**

The canonical reducers are already engine-shaped. The drift comes from:
1. New surfaces being built without registering with the canonical helpers (parity tests fix this).
2. Vendor surfaces being separately implemented from facility (real, but v0 has same problem — defer).
3. Manual entry where derivation should happen (Bucket C).

Engines as a structural rename are low-ROI right now. The leverage is in
**enforcement** (parity tests, lint rules banning raw `prisma.rebate.*` outside
`lib/contracts/`) and **output parity** (this spec). Revisit the engine cut
after Buckets A–D close — by then we'll know which boundaries actually held up.
