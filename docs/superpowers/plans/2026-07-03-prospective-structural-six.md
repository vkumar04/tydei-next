# Prospective structural six (Vick 2026-07-03: "All of them in the way you see fit")

Base: main @ e3d30878 (post-#130). Branch: `feat/prospective-structural-six`.
Six design items from Vick's bug list, executed in three waves with disjoint
file ownership per wave. Every pure calc gets a test; verify gate per wave =
`bunx tsc --noEmit` + full vitest.

## Wave 1 (parallel, disjoint files)

### A — Report narrative (item 5)
- New pure `lib/prospective-analysis/opportunity-narrative.ts`:
  `buildOpportunityNarrative({ scenario, engine, score, facilitySnapshotRows,
  constructs })` → string[] paragraphs. Story order: who/where → facility
  today → the proposed deal (constructs summary) → what it wins (incremental
  revenue, win prob, share) → recommended offer. Mirror
  `buildProposalNarrative` (components/facility/analysis/prospective/
  proposal-narrative.ts) + `buildNarrative` (export-analysis.ts) style.
- Wire as section 1 of BOTH `buildOpportunityPdfPayload` (add
  `narrative: string[]` to `OpportunityReportPayload`) and the CSV
  (export-opportunity.ts). Render in `generateOpportunityReportPDF`
  (lib/pdf.ts) before Facility Current State.
- Tests: new `opportunity-narrative.test.ts` + extend export-story-style
  assertions if a vendor equivalent exists.
- OWNS: lib/prospective-analysis/opportunity-narrative.ts (+test),
  app/vendor/prospective/sections/export-opportunity.ts, lib/pdf.ts.

### B — Calculation transparency + facility scoping (item 3)
- New pure `lib/prospective-analysis/opportunity-explain.ts`:
  `explainOpportunityEngine(scenario, sources)` returning per-output lever
  tables: `{ output, formula, levers: [{label, value, source:
  "slider"|"your data"|"default"|"deal handoff"}] }` for winProbability,
  incrementalRevenue, netUnitImpact, currentRevenue. The investigation tables
  (win-prob levers: price×−8, share×−2.2, growth×2, incumbent×−1.6; revenue =
  addressable×share, price change deliberately not moving revenue) are the
  spec. Tested.
- UI: small `InfoPopover` (shadcn Popover + Info icon) beside each engine
  StatCard in OpportunityEngineSection rendering the explain rows with source
  badges; note "price change does not move revenue (dollar-share model)".
- Facility scoping: `getVendorOpportunityData(facilityId?: string)` — when
  given, restrict vendorRows/addressable/competitor queries to that facility
  (still division-scoped). OpportunityEngineSection resolves the Deal
  Scenario facility (name→id, already computed for the Current State sync)
  and passes it; query key gains the param (queryKeys factory). Label engine
  cards "this facility" vs "across your book of business" accordingly.
- OWNS: lib/prospective-analysis/opportunity-explain.ts (+test),
  app/vendor/prospective/sections/OpportunityEngineSection.tsx,
  lib/actions/vendor-opportunity-data.ts, hooks/use-analysis-insights.ts (or
  wherever useVendorOpportunityData lives), lib/query-keys.ts.

### C — Contract-term parity (item 2)
- Extend `ProspectiveTerm` (builder/types.ts): `rebateType:
  "percent"|"fixed"|"per_unit"`, editable synced `targetType`, working
  `tiers: {min, max?, value}[]` with an actual tier-row editor in
  contract-terms.tsx (add/remove, stable ids per CLAUDE.md list-key rule).
- New pure `lib/prospective-analysis/proposal-term-estimate.ts`:
  `estimateProposalTerms(terms, projectedSpend, projectedVolume)` → per-term
  `{rebate, savings, note}` + totals. Correct semantics: spend/growth ladders
  walk tiers on projectedSpend; volume terms pay per-unit×volume (or
  percent×spend if percent type); market_share pays percent×spend when the
  commitment is assumed met (labeled "assumes commitment met");
  price_reduction contributes SAVINGS (price delta × volume), not rebate.
  Replaces the wrong inline `calculateEstimatedRebate` (volume paid spend×%,
  market_share/price_reduction paid $0).
- Persist tiers/rebateType through submit + edit-hydrate (they were stripped/
  reset); ProposalTermSummary (lib/actions/prospective.ts) gains the fields.
- OWNS: components/vendor/prospective/builder/contract-terms.tsx, types.ts,
  proposal-builder.tsx, lib/prospective-analysis/proposal-term-estimate.ts
  (+test), lib/actions/prospective.ts (ProposalTermSummary only).

## Wave 2 (after wave 1) — D+E combined (one agent; both center on DealScorerSection + vendor-prospective.ts)

### D — Consolidation round-trip (item 1)
On Analyze, persist ALL Step-1 inputs onto the proposal (extend the
runAnalysis persist block, same pattern as dealConstructs/dealFacilityId):
`dealAssumptions: { targetMarginPct, floorMarginPct, currentSharePct,
targetSharePct, estimatedSpend, estimatedSpendCategory, internalUnitCost,
contractVariant, capital: {...} }` (zod-validated). DealScorerSection's
proposal-load effect restores them (fill-only-if-blank for typed fields,
setState for selects). Detail dialog may show them later (not required).
Result: a saved deal re-opens with ZERO re-entry.

### E — Two-way sync auto-pull (item 4)
- New action `getFacilityActualsForVendor(facilityId, itemNumbers: string[])`
  in lib/actions/vendor-prospective.ts: gated on an `accepted` Connection with
  `mode === "two_way"` for (facility, vendor) — read via connection-mode
  helpers; returns per-SKU trailing-12mo `{sku, avgUnitPrice, annualQty}` from
  facility COGRecord (vendor-scoped rows, normalizeSku on both sides), plus
  `currentSharePct` via computeCategoryMarketShare-compatible math and
  `categorySpend` (canonical variants). One-way/no-connection → `{mode:
  "one_way"}` and the UI keeps manual/upload.
- DealScorerSection: when a facility is selected and the action reports
  two_way, auto-fill the reference maps (currentPriceBySku/usageVolumeBySku)
  from actuals WHEN the maps are empty (uploads win), seed currentShare +
  estimatedSpend if blank; show a small "Synced from facility actuals
  (two-way)" badge vs "Manual (one-way)".
- Do NOT enforce `vendorContractsVisibleToFacility` here (separate decision —
  flagged to Vick; changes facility-side visibility).

## Wave 3 — F: Meaningful deal score (item 6)
Redefine `deriveOverallScore` (lib/actions/vendor-prospective.ts) as a
weighted blend, tested:
- margin vs target (35): current anchor logic scaled.
- price vs benchmark (25): constructs' Target vs benchmark median (cheaper →
  higher), from the picked benchmarks; neutral 0.5 when no benchmarks.
- rebate competitiveness (15): blended rebate % vs a 2–5% healthy band.
- share-ask realism (10): penalize targetShare − currentShare > 25pts.
- data confidence (15): fraction of inputs that are real (internal cost
  entered, benchmarks present, actuals synced) — blank-everything can no
  longer score 95.
Show the anchor legend in DealScoreView / scored cards ("what moves this
score"), and label "assumed 55% GM" when internal cost was blank.
OWNS: vendor-prospective.ts (deriveOverallScore + inputs threading),
components/vendor/prospective/deal-score-view.tsx, tests.

## Verify gate (each wave + final)
tsc 0 errors; full vitest green; final: update CLAUDE.md (transparency/
narrative/sync conventions), graphify update, PR.
