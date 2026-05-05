---
date: 2026-05-04
scope: prospective-analysis canonical (Charles) vs tydei impl
branch: claude/eloquent-pike-b3e402
---

# Prospective Analysis — Charles canonical vs tydei

Read-only audit. Charles's canonical engine snapshot at
`docs/superpowers/charles-canonical-engines/prospective-analysis.ts` is
NOT in the repo (dir is empty). Closest in-repo source-of-truth is
`docs/superpowers/specs/2026-04-18-prospective-analysis-rewrite.md`. Diff:
brief's 5 canonical functions ↔ tydei pure engines + server actions shipped.

## Per-function implementation status

| Charles function | Tydei equivalent | Wired in prod? | Behavior matches? | Missing pieces |
|---|---|---|---|---|
| `analyzePricingFile(lines, side)` | Pure `lib/prospective-analysis/pricing-file-analysis.ts`; COG join in `upload-pricing-tab.tsx`. | Yes — Upload Pricing tab. | Partial. Per-line variance + summary stats present. | No `side` param. No vendor margin-floor (>35%) or pushback (<5%) flags. No facility sub-GPO (<10% off list) or zero-historical-usage flag. No Top-10 opportunities ranking. No external-benchmark variance — only vs COG. |
| `analyzePDFContract(clauses, side, variant, name)` | Pure `lib/prospective-analysis/pdf-clause-analyzer.ts` + `clause-library.ts`; action `analyzeUploadedPDF`. | Yes — Upload Proposal tab + `analysis-clause-risk-card.tsx` on /dashboard/analysis. | Partial. 26 ClauseCategory values, risk score 0-10 (canonical 0-100, CRITICAL/HIGH/MED/LOW = 25/10/5/1). | No `side`, no `ContractVariant` → no per-variant `REQUIRED_CLAUSES`. No `MISSING_CLAUSE_SUGGESTIONS` (recommended language). No cross-clause logic (missing STARK_LAW + capital → critical). No CRITICAL level. No regulatory metadata. Missing categories: `MFN` (as enum), `ANTI_STEERING`, `ANTI_KICKBACK`, `STARK_LAW`. `requiredForRiskAnalysis` is a flat 6-clause list, not per-variant. |
| `analyzeVendorProspective(input)` | NONE. | No — `/vendor/prospective` `DealScorerSection` reads `proposal.dealScore` but `getVendorProposals` always returns `null`. | n/a | scenarioResults (floor/target/ceiling), recommendedScenario, penetrationAnalysis, capitalAnalysis (payback/NPV/break-even), tierOptimization (distance to next, additional rebate, rec string). |
| `analyzeFacilityProspective(input)` | Split across `scoring.ts` + `recommendation.ts` + `rebate-tiers.ts` (5-dim scoring) and `lib/actions/financial-analysis.ts::analyzeCapitalContract` (NPV/IRR). | Yes — /dashboard/analysis/prospective + /dashboard/analysis. | Different shape. Tydei: 5 scores 0-10 + accept/negotiate/decline. Canonical: TCO + rebate-yield + multi-vendor + capital-options + commitment-risk + SIGN/NEGOTIATE/REJECT/REQUEST_MORE_INFO + confidence + $negotiable. | No TCO breakdown (vs status-quo/GPO/benchmark/best-alt, net-after-rebates). No rebate-yield projection (projected tier, spend-to-next, accrual-risk-if-vol-drops-20%). No multi-vendor comparison output. No CapitalAnalysis tri-option (purchase/lease/tie-in + rationale). No CommitmentRisk (cushion%, 15%/30% drop exposure, mitigation). No confidence, no keyNegotiationPoints typed array, no estimatedNegotiableValue $. |
| `analyzeCOGSpendPatterns(input)` | Pure `cog-spend-analyzer.ts`; action `getVendorCOGPatterns`. | Yes — sidebar card on Upload Proposal. | DIFFERENT scope. Tydei = single-vendor seasonality + tie-in. Canonical = facility-wide on/off-contract + compliance + per-vendor/category + off-contract opportunities + severity-tiered price exceptions. | No on/off-contract split, no compliance %, no per-vendor/category breakdowns, no opportunity ranking, no CRITICAL/HIGH/MED severity. (`lib/actions/cog-data-quality.ts::detectPriceDiscrepancies` covers price-exceptions partially, separate surface.) |

## Shared type coverage

| Charles type | Tydei equivalent | Match? |
|---|---|---|
| `UserSide` (VENDOR / FACILITY) | None — every engine is implicitly facility-side. | NO |
| `ContractVariant` (13 values) | None at engine level. `lib/contracts/contract-types.ts` has variant enums for the persisted contract domain, but the prospective engines never branch on them. | NO |
| `BenchmarkSource` (INTERNAL / NATIONAL_CMS / NATIONAL_ECRI / NATIONAL_PREMIER / NATIONAL_VIZIENT / REGIONAL_STATE / REGIONAL_MSA / GPO_CONTRACT / USER_ENTERED) | `ProductBenchmark.source` is a free-form `string` in Prisma; default `"national_benchmark"` per `lib/actions/benchmarks.ts`. | NO — string, not enum. |
| `RiskLevel` (LOW / MEDIUM / HIGH / CRITICAL) | `"low" \| "medium" \| "high"` in `clause-library.ts`. | NO — missing CRITICAL. |
| `CapitalStructure` (OUTRIGHT_PURCHASE / OPERATING_LEASE / CAPITAL_LEASE / TIE_IN) | None at the prospective layer. `TIE_IN_CAPITAL` exists in the rebate engine; capital-vs-lease lives in `financial-analysis.ts` but as separate code paths, not an enum that the prospective analyzer recommends between. | NO |
| `ClauseCategory` (24 values) | 26 values in `clause-library.ts`. Overlap ~20; tydei has `co_op_marketing`, `data_rights`, `compliance_reps`, `non_solicitation`, `gpo_affiliation` extras; tydei is MISSING `MFN` (called by name in patterns but no enum value), `ANTI_STEERING`, `ANTI_KICKBACK`, `STARK_LAW`. | PARTIAL — different value sets. |

## Surface coverage

- **`/dashboard/analysis/prospective`** (`app/dashboard/analysis/prospective/page.tsx` → `components/facility/analysis/prospective/prospective-client.tsx`):
  Tabs: `upload` / `manual` / `proposals` / `pricing` / `compare`.
  Engines wired: `analyzeProposal` (scoring + recommendation + dynamic tiers), `analyzeUploadedPDF` (clause analyzer), `getVendorCOGPatterns` (spend patterns sidebar), `analyzePricingFile` (per-line variance — pure, runs client-side after server-action joins COG). Comparison tab uses pure `compareProposals` against in-memory state. Score-bars and `pdf-clause-analyzer-panel.tsx` render results. **Engine wiring is healthy** — the rich pure modules each have at least one rendering surface.
- **`/vendor/prospective`** (`app/vendor/prospective/page.tsx` → `app/vendor/prospective/prospective-client.tsx`):
  Tabs: `opportunities` / `proposals` / `deal-scorer` / `benchmarks` / `analytics` / `new-proposal` (hidden).
  Engines wired: NONE from `lib/prospective-analysis/`. `DealScorerSection` reads `VendorProposal.dealScore`, which `getVendorProposals` (in `lib/actions/prospective.ts`) always sets to `null` — that file's own comment admits "Score not yet computed … pipeline is not yet enabled in this build." `BenchmarksSection` reads `getVendorBenchmarks` (rows from `ProductBenchmark`). `ProposalBuilder` writes proposals as `Alert` rows with `metadata.type === "vendor_proposal"`. The vendor-side page is essentially a CRUD shell over Alert rows; **none of the canonical vendor analyses are wired**.
- **Legacy facility surface** `components/facility/analysis/proposal-upload.tsx` + `proposal-comparison-table.tsx` + `deal-score-radar.tsx` import from the older `lib/actions/prospective.ts` (the `analyzeProposal` that returns `ItemComparison[] + DealScore` on a 0-100 scale, not the new 0-10 engine). `proposal-upload.tsx` is the only consumer of `useAnalyzeProposal()` — grep shows no page render using that component, so it's an orphan tied to the older 0-100 deal-score path. Two competing "analyzeProposal" functions ship in the codebase.
- **`lib/pdf.ts`** is the jsPDF report-generator (rebate statements / contract exports) — unrelated to clause extraction. Real PDF text extraction for `analyzeUploadedPDF` is the caller's responsibility; the engine takes raw text.

## Top gaps (sorted by severity)

1. **No `analyzeVendorProspective` engine.** The vendor portal Deal Scorer permanently shows the empty-state. Multi-scenario margin/penetration/capital/tier-optimization analysis is the entire vendor-side value proposition of the canonical spec and zero of it ships. (CR vendor-rebate-audit-parallel: rebate engine has the same "vendor-side dead" smell.)
2. **`analyzeFacilityProspective` is missing the structured TCO + multi-vendor + commitment-risk outputs.** Tydei emits 5 scores + 2 string lists. Canonical emits structured TCO breakdown, alternative-vendor comparison, capital tri-option recommendation with rationale, commitment-risk percentages, plus `confidence` and `estimatedNegotiableValue $`. The current `negotiationPoints[]` are static strings (`ALWAYS_INCLUDE_POINTS`) plus 3 conditional ones — no $ values, no priority ordering, no vendor-specific data.
3. **`analyzeCOGSpendPatterns` mismatches scope.** Canonical analyzes facility-wide compliance + on/off-contract opportunity ranking. Tydei analyzes single-vendor seasonality + tie-in risk. Both are useful; the canonical one is the strategic-procurement view that's missing.
4. **`analyzePDFContract` missing CRITICAL risk + per-variant required clauses + suggested re-language.** Cross-clause Stark Law / anti-kickback / anti-steering checks are absent — material for capital + tie-in deals where regulatory exposure is real. `MISSING_CLAUSE_SUGGESTIONS` (recommended language) absent → user knows what's missing but not what to demand.
5. **No `side: VENDOR \| FACILITY` flag on any engine.** Same engine output for both portals; vendor-side concerns (margin floor, pushback risk) never surface. The `/vendor/prospective` page therefore can't reuse the facility-side analyzer even if wiring were added.
6. **`BenchmarkSource` is a free-form string.** Will silently drift. Charles's enum encodes which national source (CMS / ECRI / Premier / Vizient) for downstream weighting; tydei loses that signal.
7. **Two parallel `analyzeProposal` functions** (`lib/actions/prospective.ts` 0-100 scale + `lib/actions/prospective-analysis.ts` 0-10 scale) with overlapping but non-compatible result shapes. Drift hazard exactly like the rebate-engine duplication noted in the prior audit. The legacy 0-100 path appears orphaned (`proposal-upload.tsx` consumer not rendered anywhere obvious) and is a candidate for removal.

## Ship classification

- **BLOCKERS** (vendor portal value-prop is dead, parallel to rebate-engine finding):
  - Vendor-side `analyzeVendorProspective` not implemented.
  - Vendor `DealScorerSection` permanently empty (no pipeline writes `dealScore`).
- **KNOWN-GAPS** (facility surface works, but canonical depth missing):
  - Facility analyzer lacks TCO breakdown, multi-vendor comparison, capital tri-option, commitment-risk, confidence + negotiable-$.
  - PDF clause analyzer lacks CRITICAL + per-variant requirements + recommended language + cross-clause regulatory checks.
  - COG spend-pattern analyzer is single-vendor seasonality, not facility-wide compliance + opportunity ranking.
  - No `side` parameter; no `ContractVariant`; `BenchmarkSource` is `string`; `RiskLevel` lacks CRITICAL.
- **CLEAN**:
  - Pure engine modules in `lib/prospective-analysis/` are well-tested (`__tests__/` mirrors source) and follow the no-IO / no-prisma boundary.
  - Facility `/dashboard/analysis/prospective` correctly wires every shipped pure engine through the orchestrator. Unlike the rebate-engine "rich engine, no callers" smell, every prospective-analysis pure module HAS at least one consumer.

## Files for caller to act on

- `/Users/vickkumar/code/tydei-next/.claude/worktrees/eloquent-pike-b3e402/lib/actions/prospective-analysis.ts` — server-action wrapper for the new pure engines.
- `/Users/vickkumar/code/tydei-next/.claude/worktrees/eloquent-pike-b3e402/lib/actions/prospective.ts` — legacy 0-100 deal-score action; duplicate of the same name; candidate for removal.
- `/Users/vickkumar/code/tydei-next/.claude/worktrees/eloquent-pike-b3e402/lib/prospective-analysis/scoring.ts` — facility 5-dimension scoring (canonical formulas verbatim).
- `/Users/vickkumar/code/tydei-next/.claude/worktrees/eloquent-pike-b3e402/lib/prospective-analysis/recommendation.ts` — verdict + negotiation points; needs `confidence` + `estimatedNegotiableValue $`.
- `/Users/vickkumar/code/tydei-next/.claude/worktrees/eloquent-pike-b3e402/lib/prospective-analysis/pdf-clause-analyzer.ts` + `clause-library.ts` — clause analyzer; needs CRITICAL, per-variant requireds, suggestions library, cross-clause regulatory checks, ANTI_KICKBACK / STARK_LAW / ANTI_STEERING / MFN-as-enum.
- `/Users/vickkumar/code/tydei-next/.claude/worktrees/eloquent-pike-b3e402/lib/prospective-analysis/cog-spend-analyzer.ts` — single-vendor patterns; needs facility-wide compliance + on/off-contract sibling.
- `/Users/vickkumar/code/tydei-next/.claude/worktrees/eloquent-pike-b3e402/lib/prospective-analysis/pricing-file-analysis.ts` — needs `side` flag + side-specific flags + Top-10 opportunities.
- `/Users/vickkumar/code/tydei-next/.claude/worktrees/eloquent-pike-b3e402/app/vendor/prospective/sections/DealScorerSection.tsx` — empty-state today; awaits a vendor analyzer.
- `/Users/vickkumar/code/tydei-next/.claude/worktrees/eloquent-pike-b3e402/components/facility/analysis/prospective/prospective-client.tsx` — orchestrator that would receive new outputs.
- `/Users/vickkumar/code/tydei-next/.claude/worktrees/eloquent-pike-b3e402/docs/superpowers/specs/2026-04-18-prospective-analysis-rewrite.md` — the in-repo spec source-of-truth (no `analyzeVendorProspective` subsystem).
- `/Users/vickkumar/code/tydei-next/.claude/worktrees/eloquent-pike-b3e402/docs/superpowers/charles-canonical-engines/` — directory exists but is EMPTY; the canonical snapshot referenced in the brief is not committed. Suggest committing it before any rewrite work.
