# Autonomous Ingest Normalization — Design

**Date:** 2026-06-02
**Author:** Vick Kumar (with Claude)
**Status:** Approved design, pending implementation plan

## Problem

Real-world contract, price-file, and COG data is never clean and never will
be. The same vendor arrives as `SMITH & NEPHEW INC` and `Smith & Nephew, Inc.`;
the same product family is `Ortho-Sports Med` in the price file and `Sports
Medicine` in the contract; contracts arrive as PDFs that nobody re-keys. Today
the app has the machinery to reconcile all of this but gates it behind **manual
curation** — map the vendor, map the category, create the contract, press
Recompute. The user requirement: **the app must do all the work.**

Concrete real-prod evidence (2026-06-02, read-only audit of the Railway prod DB):

- The only contract is a grouped "Smith & Nephew" agreement whose two member
  vendors are two spellings of the same company. All $7.25M of trailing spend
  sits under the secondary spelling; the primary spelling has **$0**. Any
  primary-vendor-only view reads $0 / 0% share.
- $13.5M of real Arthrex COG (8,986 rows) is `off_contract` because the Arthrex
  contract was never created in the system. 2,630 of those rows have a null
  category; the rest use price-file category names that match no
  `ProductCategory`.

## Goals

1. Every ingest (COG, price file, contract PDF) auto-resolves vendor identity
   and category, and auto-creates contracts, acting on its best guess.
2. Every automated decision is **logged with confidence and is reversible in one
   click** — the safety mechanism that makes autonomy acceptable ("bots never do
   unrequested, unauditable things").
3. The app **never requires** a manual map/merge/recompute step. Genuinely
   ambiguous cases land in a review queue but never block the import.
4. A one-time reconciliation fixes the *existing* fragmented prod data, not just
   future imports.

## Non-goals

- Replacing human judgment entirely. Low-confidence decisions are queued, not
  forced. The human can always audit and override.
- Changing the rebate math, the canonical reducers, or the matching engine.
  This layer feeds those systems; it does not alter them.
- Multi-tenant vendor taxonomy redesign. Vendors and `ProductCategory` stay
  global as today.

## Existing infrastructure (reuse, do not rebuild)

| Capability | Where | Reuse as |
|---|---|---|
| Vendor resolve (exact→alias→fuzzy 0.7→create) + per-facility `VendorNameMapping` Pass 0 | `lib/vendors/resolve.ts` (`resolveVendorId`), `lib/actions/imports/shared.ts` (`findOrCreateVendorByName`) | fuzzy fallback inside `decideVendor` |
| Category resolve + confirmed `CategoryMapping` Pass 0 | `lib/categories/resolve.ts` (`resolveCategoryNamesBulk`) | category apply path |
| Fuzzy category scorer | `lib/categories/category-suggest.ts` (`scoreCategoryMatch`, shipped 2026-06-02) | scoring inside `decideCategory` |
| Structured AI extraction over PDFs (AI SDK v6 `Output.object`, primary+fallback model, `type:"file"` PDF parts) | `lib/ai/generate-structured.ts`, `lib/ai/pdf-chunker.ts`, `lib/ai/schemas.ts` (`richContractExtractSchema`) | contract-from-PDF extract |
| Extracted-data → Contract persistence (terms, tiers, carve-out) | `lib/actions/imports/contract-import.ts` (`ingestContract`), `lib/actions/imports/shared.ts` (enum coercers) | contract-from-PDF persist |
| Post-import metric refresh + match recompute | `bulkImportCOGRecords` → `refreshContractMetrics`; `remapCOGCategory` → `recomputeMatchStatusesForVendor` | auto-recompute orchestrator |
| Group-vendor invariant guard | `scripts/oracles/grouped-vendor-scope.ts` (shipped 2026-06-02) | regression guard |

The work is wiring these into an auto-applying pipeline + a decision ledger +
a one-time reconciliation — not green-field construction.

## Architecture

### 1. Normalization engine — `lib/normalize/`

Pure, dependency-light decision functions (no Prisma writes; they take the
candidate set and return a decision):

```
decideVendor(name: string, vendors: VendorRow[]): VendorDecision
  → { vendorId?: string; confidence: number; method: "canonical_key" | "exact" | "alias" | "fuzzy" | "new"; canonicalKey: string }

decideCategory(raw: string, canonicalNames: string[]): CategoryDecision
  → { target?: string; confidence: number; method: "exact" | "normalized" | "fuzzy" | "none" }
```

**Deterministic vendor canonical key** (`lib/normalize/vendor-key.ts`): lowercase,
`&`→`and`, strip punctuation, drop trailing corporate suffixes
(`inc llc corp co ltd plc gmbh sa ag nv co.` etc.), collapse whitespace.
`SMITH & NEPHEW INC` and `Smith & Nephew, Inc.` both → `smith and nephew`.
Key equality = confidence 1.0. This beats Levenshtein for the suffix/punctuation
case (which is the dominant fragmentation mode). The existing Levenshtein 0.7
stays as the fuzzy fallback for typos.

### 2. Decision ledger — `NormalizationDecision` (new Prisma model)

The audit trail and undo log. One row per automated decision.

```prisma
model NormalizationDecision {
  id            String   @id @default(cuid())
  facilityId    String?               // null for global (e.g. category) decisions
  type          String                // "vendor" | "category" | "contract"
  inputValue    String                // raw input (incoming name / category / file name)
  chosenValue   String?               // resolved output (vendorId / category name / contractId)
  confidence    Float                 // 0..1
  method        String                // canonical_key | exact | alias | fuzzy | extract | none
  source        String   @default("auto")  // auto | queued | confirmed | reverted
  affectedRowIds Json?                // ids of rows the decision touched (for revert + recompute)
  createdAt     DateTime @default(now())
  resolvedAt    DateTime?             // when a queued item was actioned
  @@index([facilityId, type, source])
}
```

Revert re-runs the inverse (unmap category + retag rows back, un-merge vendor,
delete/deactivate a draft contract), flips `source` to `reverted`, and triggers
recompute. The ledger is browsable as an audit log.

### 3. Confidence gates (the "balanced" line)

| Domain | Auto-apply | Queue (review, non-blocking) | Else |
|---|---|---|---|
| Vendor | canonical-key match (1.0) **or** Levenshtein ≥0.85 | [0.7, 0.85) | <0.7 → create new vendor (logged) |
| Category | exact / normalized (1.0) **or** fuzzy ≥0.8 | [0.5, 0.8) | <0.5 → leave raw + queue |
| Contract PDF | schema-valid + required fields present → create **draft** (one-tap activate) | partial extract → draft + flagged fields | extract failure → surfaced error (per AI-action error-path rules) |

Imports never block. Confident rows apply immediately and recompute; unsure
rows land in the Review Queue and the underlying rows stay in a safe default
until actioned:

- **Category** unsure/none → the row's category stays raw (null-canonical), so
  it simply doesn't attribute yet — no wrong attribution.
- **Vendor** unsure [0.7, 0.85) → **create a provisional new vendor** and assign
  the row to it (a COG row must have *some* vendor), then queue a "merge into
  `<candidate>`?" decision. We never *auto-merge* below 0.85, so the failure mode
  is a harmless duplicate vendor (caught by the queue + reconciliation) rather
  than a wrong merge. Accepting the queued merge reassigns the rows and
  recomputes; the canonical-key pass means true spelling-variants are ≥0.85 and
  never reach this branch.

### 4. Auto-recompute orchestrator — `lib/normalize/recompute-after.ts`

After any ingest or any decision change (apply / accept / revert), enqueue
match + accrual recompute for the affected vendor set (`contractVendorIds`-aware)
and contracts. Replaces every manual "Recompute" affordance. Reuses the existing
recompute functions; this is wiring + dedup of affected ids, not new math.

### 5. Contract-from-PDF flow

Upload PDF (dialog already accepts `.pdf`) → `pdf-chunker` → `generate-structured`
with `richContractExtractSchema` → `ingestContract` creates a **draft** Contract
with extracted terms/tiers/carve-out and a `NormalizationDecision{type:"contract"}`
carrying per-extract confidence → one-tap "Activate" in the review queue.
Vendor on the contract is resolved through `decideVendor` so a PDF and a COG
file naming the vendor differently still land on one vendor row.

### 6. One-time legacy reconciliation — `scripts/reconcile/`

Run once against prod (read+write, transactional, dry-run flag first):
- **Vendor merge:** group existing vendors by canonical key; pick a survivor;
  reassign COG + contracts + pricing to it; record `NormalizationDecision`
  rows; recompute. Fixes the two S&N rows.
- **Category backfill:** for distinct unmapped COG/pricing categories, apply
  `decideCategory`; auto-confirm ≥0.8, queue the rest; retag + recompute.
- Emits a report of every merge/map for review; fully reversible via the ledger.

## Data flow (COG / price-file import)

```
file → parse rows
  → load vendor + category candidate sets once
  → per row: decideVendor, decideCategory
       confident → apply (resolve id / set category), write NormalizationDecision(source:auto)
       unsure    → leave raw, write NormalizationDecision(source:queued)
  → persist rows (existing bulk path)
  → recompute-after(affected vendors + contracts)
```

## Error handling

- AI extraction failures follow the existing AI-action error-path rule
  (`console.error('[contract-extract]', err, {...})` + a user-facing
  `AI request error: <reason>` / `AI returned an invalid payload: <zod path>`).
- Decision application is wrapped so a single bad row never aborts a batch; the
  row is logged as `method:"none"` and queued.
- Reconciliation scripts run in a transaction per merge group with a `--dry-run`
  that prints the plan and writes nothing.

## Testing

- Unit: `vendor-key` (real Arthrex/S&N name fixtures collapse correctly),
  `decideVendor` / `decideCategory` gates (threshold boundaries), revert inverse.
- Oracle: new `no-subthreshold-autoapply` — asserts no `NormalizationDecision`
  with `source:"auto"` has `confidence` below its domain's auto bar. The
  existing `grouped-vendor-scope` oracle continues to guard the group invariant.
- Round-trip: Arthrex PDF → extract → `ingestContract` produces the QAS spend
  tiers + 2% Distal Extremities carve-out (the `qasTerm`/`distalExtremitiesTerm`
  round-trip test already exists; extend it through the autonomous path).
- All gated by the standard verify checklist (tsc, vitest, `bun run oracles`).

## Build phases (one design, phased implementation)

1. **Engine + ledger + auto-apply + auto-recompute** — `lib/normalize/`, the
   `NormalizationDecision` model + migration, wire `decideVendor`/`decideCategory`
   into COG + price-file import, `recompute-after`. (Core of A+B+C.)
2. **Review queue + audit/undo UI** — one inbox for queued decisions (one-tap
   accept/override), an audit log view, revert action.
3. **Contract-from-PDF autonomous flow** — wire upload → extract → draft contract
   → one-tap activate. (D.)
4. **Legacy reconciliation** — `scripts/reconcile/` vendor-merge + category
   backfill, dry-run then live on prod. Fixes the existing $13.5M / $7.25M data.

Each phase ships independently and is independently verifiable.

## Open questions (resolved)

- Autonomy level: **Balanced** — auto-apply confident, queue unsure, all logged
  + reversible (user decision, 2026-06-02).
- Scope: all four pillars in one design, phased build (user decision).
