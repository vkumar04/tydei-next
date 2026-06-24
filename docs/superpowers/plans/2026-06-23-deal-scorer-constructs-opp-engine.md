# Deal Scorer → Constructs → Opportunity Engine (2026-06-23)

Vendor-side Prospective. Turn the Deal Scorer from a global Floor/Target/Ceiling
pricing table + a separate benchmark-compare into a **per-construct** model, and
connect a scored deal to the **Opportunity Engine** so proposal → score →
opportunity tells one story (Vick 2026-06-23).

## Confirmed decisions (AskUserQuestion)

- **Construct fields:** Benchmark, **Current, Floor, Target, Ask** (drop
  Ceiling), **Annual volume**, **Rebate %**.
- **Construct source:** benchmark-backed **or** free-text (no-benchmark
  constructs show "—" for Avg/P25–P75).
- **Opp Engine handoff:** a button on each **scored proposal** (My Proposals)
  → opens the Opportunity Engine pre-filled from that deal.

## Construct → score mapping (resolved)

Keep the existing, tested `analyzeVendorProspective` (scores
`pricingScenarios: {scenarioName, unitPrice, estimatedAnnualVolume,
rebatePercent}[]`). The construct table is the INPUT; on analyze, blend the
constructs into the 3 scenarios the analyzer already understands:

- **Floor / Target / Ask** scenario each = spend-weighted blend across constructs
  at that price point:
  - `unitPrice = Σ(price_tier × volume) / Σ(volume)`
  - `estimatedAnnualVolume = Σ(volume)`
  - `rebatePercent = Σ(rebate% × price_tier × volume) / Σ(price_tier × volume)`
- **Current** is the baseline → `facilityEstimatedAnnualSpend = Σ(current × volume)`
  (unless the user overrides estimated spend).
- Per-construct benchmark comparison (price vs Avg/P25–P75) stays in the UI row;
  it's informational (does not change the score), same as today.

This preserves the analyzer + its tests; only the Deal Scorer UI + the
`handleAnalyze` blend change. Ceiling is removed everywhere (scenario default,
analyzer callers tolerate any scenarioName).

## Phases

### Phase 1 — Construct-based Deal Scorer UI
- New `ConstructForm` ({ _uid, benchmarkId|null, productName, current, floor,
  target, ask, annualVolume, rebatePercent }).
- Replace the Pricing-scenarios table + `DealScorerBenchmarkCompare` with a
  **Constructs** table: an "Add construct" row (benchmark `MultiSelectCombobox`
  to pick → pre-fills name + benchmark ref, OR a free-text add), then one
  editable row per construct (Current/Floor/Target/Ask/Volume/Rebate% + inline
  Avg/P25–P75 + remove). Enter adds another. Keyed by `_uid` (CLAUDE.md: stable
  keys for editable lists).
- `handleAnalyze` blends constructs → Floor/Target/Ask scenarios + Current
  baseline (above).
- Keep margins / shares / capital / internal-cost blocks.

### Phase 2 — Persist constructs on the scored proposal
- When attaching to a proposal, write `constructs` into `PendingContract.
  pricingData` (alongside `dealScore`) so the Opp Engine can read the real deal.

### Phase 3 — Opportunity Engine handoff ("the story")
- `ProposalCards` scored card → **"Analyze in Opportunity Engine"** → routes to
  the Opportunity Engine tab pre-filled from the proposal: facility, current
  spend (Σ current×volume), target share (deal's share commit), and a derived
  `priceChangePct` (blended Target vs Current) so the engine's Deal Scenario
  reflects the actual scored deal.

## Verify
- `tsc` · vitest (add a `blendConstructsToScenarios` pure-helper test) · build.
- Browser: add 2 constructs (1 benchmark + 1 free-text) → analyze → score;
  attach to a proposal → My Proposals → "Analyze in Opportunity Engine" pre-fills.
