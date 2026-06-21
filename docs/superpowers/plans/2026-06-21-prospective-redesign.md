# Prospective redesign — unified "enter a thing → get prospective analysis"

Status: **proposed** (Vick 2026-06-21, "the Prospective piece needs the most work").
Not yet built. This captures the agreed direction so we scope before coding.

## Guiding principles (from Vick)

1. **Facility spend is the spine.** Every facility-side number connects to the
   facility's real tracked spend. Prospective analysis is ALWAYS measured against
   the facility's real current spend (the savings baseline), no matter who starts it.
2. **One intake, both sides.** A vendor OR a facility should be able to take an
   **idea**, **inputs**, or an **actual contract**, enter it, and get a
   prospective analysis out.

## Problems with Prospective today (vendor side)

- **Toolbox, not a workflow.** 6 tabs (Opportunities, My Proposals, Deal Scorer,
  Benchmarks, Opportunity Engine, Analytics). Two pairs overlap: Deal Scorer ≈
  Opportunity Engine (both score a deal from inputs); Opportunities ≈ Analytics
  (both lead with metric-card rows). No single "do the thing" path.
- **Not anchored to real data.** The Opportunity Engine is pure sliders with no
  tie to the vendor's actual book. It should start from real numbers for THIS
  account (current spend with this vendor, real market share, category spend).
- **Proposals aren't real objects.** "My Proposals" is client/session state
  (vanishes on navigation; reverted PR #98/#102 history). So "Analytics →
  proposals by status" is mock. No funnel.
- **Output is vendor-internal only.** The most valuable analysis is the one a
  vendor can SHOW the facility (savings → EBITDA → EV), which is exactly the
  facility Analysis engine. The two sides compute different things in isolation.

## Target shape

**One Prospective Analysis intake → 3 input types → 2 output lenses → 1 saved Proposal.**

- **Input types:**
  - *Idea* — rough levers (move X% of spend to vendor Y at −Z%, expected volume).
    Reuses `computeDealScenarioSavings` (`lib/financial-analysis/`).
  - *Inputs* — a pricing/usage file. Reuses the canonical pricing parser
    (`lib/utils/parse-pricing-file.ts`, `readPricingRows`).
  - *Actual contract* — upload + AI-extract terms. Reuses `/api/ai/extract-contract`.
- **Engine:** deal terms → annual savings vs the facility's real current spend.
- **Two lenses on the same deal:**
  - *Facility lens* — savings → EBITDA / DCF / EV. Reuses
    `computeFacilityProspectiveModel` (`lib/financial-analysis/prospective-impact-model.ts`).
  - *Vendor lens* — revenue / win-probability / margin / territory. Reuses the
    Opportunity Engine (`lib/prospective-analysis/opportunity-engine.ts`,
    `vendor-opportunity-score.ts`).
- **Persistence:** a `Proposal` object (new model) with a lifecycle
  (`draft → sent → won | lost`), owned per vendor/facility, shared across portals
  via the existing `Connection.mode` (1-way/2-way) gate. Makes the funnel /
  Analytics real.

### Tab consolidation (vendor)

- **Prospective Analysis** — the intake + dual-lens output (absorbs Deal Scorer,
  Opportunity Engine, new-proposal).
- **Opportunities** — where to focus, anchored on real share (absorbs Analytics
  metric cards as a pipeline summary).
- **Pipeline** — saved Proposals + funnel by status.
- Benchmarks becomes a supporting *input* to the intake, not a standalone tab.

### Facility side (Analysis, already 2 tabs)

- "Evaluate Proposals" tab becomes the same intake (idea / file / contract),
  producing the facility lens. "Current State" stays the live CFO dashboard.

## Open questions before building

1. `Proposal` data model — fields, ownership, how it maps to existing
   `Invitation`/`Connection`/`Contract`. Does a won Proposal become a `Contract`?
2. How a vendor's proposal becomes visible to a facility (reuse 2-way connection
   accept flow vs a new share step).
3. Scope of v1 — start with the persisted `Proposal` + the single intake (idea +
   file), defer AI-contract-extract and the facility-share flow.

## Related shipped work

- Deal-scenario levers on the facility Prospective Impact Engine (PR #99).
- Slimmed assumptions / tracked-data-is-not-typed (PR #101).
- Category×vendor scoping + new-account input were built (PR #102) then reverted
  (PR #105) — still desired; fold into this redesign.
- See memory `project_analysis_assumptions_direction`.
