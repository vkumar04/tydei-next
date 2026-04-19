# COG Data Rewrite — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps in those plans use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18)
**Related specs:**
- Required dependency: `2026-04-18-platform-data-model-reconciliation.md` (vendor resolve, match algorithm, rebate split)
- Required dependency: `2026-04-18-ai-integration-foundation.md` (Claude primitives for CSV mapping, dedup advisor, quality narrator, division inference)
- Downstream: `data-pipeline-rewrite` consumes the enrichment engine via the match status persisted here

**Goal:** Rewrite `/dashboard/cog-data` to be the **fast, correct, trusted feeder** that the rest of the platform depends on. Ingest ERP CSV exports, enrich against contract pricing using the canonical match algorithm, surface match-rate and savings with real numbers (no synthesis), and use Claude for advisory assistance on uploads, dedup, and data quality — without ever writing data without user confirmation.

**Architecture:** Gap-closure on an existing surface with significant schema and engine additions.

Current state:
- `components/facility/cog/cog-data-client.tsx` — 372 lines
- `components/facility/cog/cog-import-dialog.tsx` — 570 lines
- `components/facility/cog/pricing-import-dialog.tsx` — 327 lines
- `components/facility/cog/cog-records-table.tsx` — 240 lines
- `components/facility/cog/duplicate-validator.tsx` — 204 lines
- `components/facility/cog/vendor-name-matcher.tsx` — 289 lines
- `components/import/mass-upload.tsx` — 1454 lines (⚠️ shared across uploads; splits in subsystem 9)
- `lib/actions/cog-records.ts` — 643 lines
- `lib/actions/mass-upload.ts` — 1093 lines

Substantial foundation. Most gaps are:
- Enrichment columns + persisted match status (§data-model)
- Engine wiring: subsystem-1 of data-pipeline (price variance) + §5 of platform-data-model (canonical matcher)
- AI subsystems plugging into upload + dedup + quality
- Mega-file splits

**Tech Stack (unchanged):** Next.js 16, Prisma 7, Better Auth, Tailwind v4, shadcn/ui, TanStack Query, date-fns, papaparse (existing), Bun. Reuses platform data-model reconciliation primitives + AI foundation.

---

## 1. Scope

### In scope

- **COG ingestion pipeline** — CSV + XLSX parse, auto-detect mapping, duplicate detection, enrichment, bulk persist
- **Enrichment engine** — pure function that populates `COGRecord` enrichment columns from contract pricing
- **Contract-save recompute** — when contracts change, recompute affected COG match statuses
- **Data quality panel** — post-upload rule-based scoring with AI-narrated summary
- **COG records table** — list, filter, per-row enrichment badges, match-status drill-down
- **Pricing files table** — import history + stats + recompute button
- **AI integrations plugged in** — column-mapping assist, vendor/item dedup advisors, division inference, quality narrator
- **Tech debt:**
  - Split `components/import/mass-upload.tsx` (1454 lines) into focused files
  - Split `lib/actions/mass-upload.ts` (1093 lines) into per-domain action files
  - Audit + light refactor of `lib/actions/cog-records.ts` (643 lines)
  - Audit + light refactor of `components/facility/cog/cog-import-dialog.tsx` (570 lines)

### Out of scope

- **Persisted field-mapping configs** (`FieldMappingConfig` Prisma model). Auto-detect + per-upload selection only. V2 feature.
- **Alias-based item matching via a `ContractItemAlias` table.** Exact vendorItemNo match + Claude fuzzy advisor at import time. V2 feature.
- **Streaming upload for files >50MB.** Chunked in-memory processing (1k-row batches) handles up to ~20MB comfortably; larger uploads get a "split your file" error message. V2.
- **PDF export.** CSV + XLSX only.
- **Trend analysis + linear-regression forecast on COG metrics.** Belongs to `/dashboard/analysis/prospective` spec (future).
- **Per-row soft-delete with deleted/deletedAt/deletedBy columns.** File-level delete + AuditLog only.
- **Compliance-violation detection with severity.** Handled by contracts-rewrite subsystem 4's compliance engine + renders on contract detail pages, not here.

### Non-goals (preserved)

- No stack swaps. No debug-route ports.
- No unilateral refactor of unrelated files touched incidentally.

---

## 2. Translation notes — canonical COG doc → tydei

| Canonical prototype pattern | Tydei equivalent |
|---|---|
| `tydei_cog_records` IndexedDB + `tydei_cog_files` localStorage | `COGRecord` + `PricingFile` Prisma tables |
| `window.dispatchEvent('cog-data-updated')` | `queryClient.invalidateQueries({ queryKey: queryKeys.cog.all(facilityId) })` |
| `normalizeVendorName()` as local function | Reuses `lib/vendors/normalize.ts` from platform-data-model subsystem 1 |
| Fuzzy vendor matching | Platform-data-model subsystem 1's cascade: exact → canonical alias → Claude fallback (AI foundation feature #2) |
| `lookupContractPricing` function | Replaced by canonical `matchCOGRecordToContract` (platform-data-model §4.9) + its enrichment wrapper from this spec's subsystem 2 |
| `refreshCogContractStatus()` manual button | Triggers `recomputeMatchStatusesForFacility` server action from platform-data-model subsystem 5 |
| `FieldMappingConfig` Prisma model | Dropped. Auto-detect runs fresh per upload; user can override per column in the import dialog. |
| Random `85 + Math.floor(Math.random() * 15)` compliance placeholder | Dropped. Real values or empty state. |
| `SavingsClassification` 6-level enum | Dropped. Three-level severity (minor / moderate / major) from platform-data-model §4.12. |
| Streaming file reader | Chunked in-memory for files ≤20MB; error banner above that. |
| "Demo data fallback" when store is empty | Dropped. Empty-state panels with helpful copy. |
| Per-row soft-delete | File-level delete via existing pattern + AuditLog. |

---

## 3. Data model changes

**`COGRecord` enrichment columns** (5 new nullable, ship in this spec's subsystem 0 — independent of platform-data-model's `matchStatus` column):

```prisma
model COGRecord {
  // ... existing fields

  // Enrichment columns (this spec)
  contractId       String?
  contractPrice    Decimal? @db.Decimal(12, 2)
  isOnContract     Boolean  @default(false)
  savingsAmount    Decimal? @db.Decimal(14, 2)
  variancePercent  Decimal? @db.Decimal(6, 2)

  // matchStatus ships via platform-data-model spec subsystem 0.
  // If this spec executes first, add the matchStatus column here.
  // If platform-data-model executes first, skip.

  @@index([contractId])
  @@index([facilityId, isOnContract])
}
```

**`PricingFile` extension** (stats columns — additive):

```prisma
model PricingFile {
  // ... existing fields

  recordCount      Int?       // rows in the file
  onContractSpend  Decimal?   @db.Decimal(14, 2)
  offContractSpend Decimal?   @db.Decimal(14, 2)
  totalSavings     Decimal?   @db.Decimal(14, 2)
  matchedRecords   Int?
  unmatchedRecords Int?
  uniqueVendors    Int?
  uniqueItems      Int?
  minTransactionDate DateTime? @db.Date
  maxTransactionDate DateTime? @db.Date
  errorCount       Int?       @default(0)
  warningCount     Int?       @default(0)
  processingDurationMs Int?
  status           String?    @default("completed")  // "pending" | "processing" | "completed" | "failed" | "partial"
}
```

No new models. No new enums.

**Sign convention** (per platform-data-model §4.11):
- `savingsAmount > 0` → facility paid less than list (win).
- `variancePercent > 0` → facility paid *more* than contract (alert).
- On-contract row with `variancePercent ≈ 0` → at-contract price (normal).

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Schema migration + action audit (P0)

**Priority:** P0 — blocks 1-9.

**Files:**
- Modify: `prisma/schema.prisma` (5 COGRecord enrichment columns + 11 PricingFile stats columns)
- Audit: `lib/actions/cog-records.ts` (643 lines) — tag every function with a short summary comment. Catalog every duplicated normalization, every ad-hoc vendor-matching, every sign-convention violation. Produces the refactor list consumed by subsystem 9.
- Audit: `lib/actions/mass-upload.ts` (1093 lines) — same treatment. Catalog which functions belong to which domain (COG, pricing, invoice, case-costing) for the subsystem 9 split.

**Acceptance:**
- `bunx prisma validate` → valid.
- `bun run db:push` → in sync, zero data-loss warnings.
- Audit reports filed in subsystem 0's plan: `lib/actions/cog-records.ts` and `lib/actions/mass-upload.ts` get function-by-function catalogs.
- `bunx tsc --noEmit` → 0 errors.

**Plan detail:** On-demand — `00-schema-audit-plan.md`.

---

### Subsystem 1 — Enrichment engine (P0)

**Priority:** P0 — every downstream page depends on this.

**Files:**
- Create: `lib/cog/enrichment.ts` — exports:
  - `enrichCOGRecord(record, matchResult)` — pure function that maps match result to enrichment columns
  - `enrichBatch(records, contracts)` — batched enrichment for bulk import
- Create: `lib/cog/__tests__/enrichment.test.ts` — covers all 6 match statuses + sign convention + edge cases (zero quantity, null price, etc.)

**Approach:**
- Delegates to `matchCOGRecordToContract` from platform-data-model §5 for the actual matching logic. This module is a thin adapter between the match result and the persisted columns.
- Tests verify the sign convention: 10 records × $100 actual × $90 contract → `savingsAmount = (90-100)*quantity × -1`... wait, reread: "savings positive when facility paid less". Actual $100, contract $90 → facility paid MORE. `savingsAmount = (contractPrice - actualPrice) × quantity = (90-100) × qty = -10 × qty` (negative, because overpaid). So `savingsAmount < 0` indicates overpay; positive indicates savings.
- `variancePercent = ((actualPrice - contractPrice) / contractPrice) × 100`. Positive = overpaid.

Document the sign convention in the file header and in inline comments on every computation.

**Acceptance:**
- All 6 match statuses produce correct enrichment output.
- Sign convention locked in + tested.
- Consumable by POs + invoice subsystems in data-pipeline spec.

**Plan detail:** On-demand — `01-enrichment-plan.md`.

---

### Subsystem 2 — Contract-save recompute trigger (P0)

**Priority:** P0.

**Files:**
- Modify: `lib/actions/contracts.ts` — on `createContract`, `updateContract`, `deleteContract` success, inline call to `recomputeMatchStatusesForVendor(vendorId)` (from platform-data-model §5) + TanStack Query invalidation.
- Verify: same hooks fire on `approvePendingContract`, `rejectPendingContract`, `requestRevisionForContract`, contract-term CRUD.
- Create: `lib/cog/recompute.ts` — bulk-update helper that walks the recompute result and writes enrichment columns in a single Prisma transaction (per-vendor, scoped tight).

**Acceptance:**
- Contract create → within 2s (demo scale), all that vendor's COG rows are re-enriched with updated `contractId`, `isOnContract`, `savingsAmount`, `variancePercent`, `matchStatus`.
- Contract update to expiration date → rows outside new date range flip to `out_of_scope`.
- Contract delete → rows reset to `unknown_vendor` or `off_contract_item`.
- TanStack Query cache invalidated; UI on COG + dashboard + rebate optimizer + price discrepancy pages refreshes.

**Plan detail:** On-demand — `02-recompute-trigger-plan.md`.

---

### Subsystem 3 — COG import pipeline (P0)

**Priority:** P0 — closes the feeder story.

**Files:**
- Modify: `components/facility/cog/cog-import-dialog.tsx` (570 lines) — wire the full pipeline:
  1. File parse (existing)
  2. Auto-detect column mapping (existing pattern logic)
  3. **AI column-mapping assist** (AI foundation feature #1): for columns where auto-detect is unsure (confidence <0.8), show Claude proposals in the mapping UI for user confirmation. Always advisory.
  4. Duplicate detection pass (existing `duplicate-validator.tsx`, audited)
  5. **AI vendor dedup advisor** (AI foundation feature #2): for new vendor names that don't hit the alias map, surface Claude's similarity matches pair-wise in `AiReviewPanel` from AI foundation subsystem 4
  6. **AI item dedup advisor** (AI foundation feature #3): for ambiguous duplicate groups (matched on only one key), surface Claude's recommendation pair-wise
  7. **Division inference** (AI foundation feature #5): rules-first via `inferDivisionFromItem`; Claude fallback only when rules return null *and* vendor has multiple active divisions
  8. Enrichment pass (subsystem 1)
  9. Bulk persist in 1k-row transactions
  10. `PricingFile` row created + stats populated
  11. `cog-data-updated` invalidation fires downstream
- Modify: `lib/actions/cog-records.ts` (634 lines) — new action `importCOGBatch(input)` orchestrates the pipeline. Pulls heavy logic out of `mass-upload.ts` (subsystem 9 completes that split).
- Verify/modify: existing column auto-detect regex patterns — keep, extend.

**Acceptance:**
- 10k-row CSV uploads in <30s on demo scale (non-blocking UI, progress bar).
- AI advisor calls only fire when deterministic logic is ambiguous — no unnecessary Claude calls.
- User always confirms pair-wise before changes stick.
- `PricingFile` stats populated correctly.
- TanStack Query invalidates → downstream pages refresh.

**Plan detail:** On-demand — `03-import-pipeline-plan.md`.

---

### Subsystem 4 — Duplicate detection audit + refine (P1)

**Priority:** P1.

**Files:**
- Modify: `components/facility/cog/duplicate-validator.tsx` (204 lines) — audit logic; verify the two-key detection (`inventoryNumber` + `vendorItemNo`) matches canonical COG doc §7.
- Verify: bulk resolution actions (`keep_existing` / `replace` / `keep_both`) are wired.
- Wire: AI item-dedup advisor for groups that match on only one key (not `both`). Exact-match `both` cases auto-resolve to `replace` (deterministic; no Claude needed).
- Modify: `components/facility/cog/vendor-name-matcher.tsx` (289 lines) — retire or audit: replace with AI vendor-dedup advisor + shared `AiReviewPanel`. If retired, delete file.

**Acceptance:**
- `both` exact matches auto-resolve; user sees a post-facto summary.
- `inventory_number`-only and `vendor_item_no`-only matches surface in the `AiReviewPanel` with Claude's pair-wise recommendations.
- Bulk actions (`keep_existing` / `replace`) apply only to unresolved groups.
- `vendor-name-matcher.tsx` either retired (replaced by AI vendor dedup advisor) or kept as a deterministic fallback when credits exhausted.

**Plan detail:** On-demand — `04-dedup-refine-plan.md`.

---

### Subsystem 5 — Data quality panel + AI narrator (P1)

**Priority:** P1.

**Files:**
- Create: `lib/cog/quality.ts` — pure scoring function. Returns `{ overallScore: 0-100, issues: { missingVendor, missingItemNumber, missingPrice, missingDate, zeroQuantity, zeroPrice, invalidDates, unmatchedExtendedPrice } }` per canonical COG §14. No AI call here.
- Create: `components/facility/cog/quality-panel.tsx` — renders scoring results + streamed Claude narrative
- Wire: AI data-quality narrator (AI foundation feature #6) — pass scoring results to Claude; render streamed narrative + 3 recommendations. Opus 4.6 model.
- Modify: `cog-import-dialog.tsx` — render `QualityPanel` as post-upload step before "Finish."

**Acceptance:**
- Deterministic score renders first (no wait for Claude).
- Claude narrative streams in alongside the score.
- Recommendations are actionable (point to specific columns / specific fixes).
- Credits deducted; audit logged via AI foundation subsystem 0.

**Plan detail:** On-demand — `05-quality-panel-plan.md`.

---

### Subsystem 6 — COG records table + filters (P1)

**Priority:** P1.

**Files:**
- Modify: `components/facility/cog/cog-data-client.tsx` (372 lines) — audit; wire to new server actions.
- Modify: `components/facility/cog/cog-records-table.tsx` (240 lines) — add columns:
  - Match status badge (6 values, color-coded)
  - Savings (green if positive, red if negative)
  - Variance % (red if >2%, amber if 2-10%, destructive if ≥10%)
- Modify: `components/facility/cog/cog-columns.tsx` (138 lines) — add new column definitions.
- Add filter: match status multi-select (pending / on_contract / off_contract_item / out_of_scope / unknown_vendor / price_variance).
- Add quick filter: "Show only variance" (off-contract + price-variance rows).
- Wire: row drilldown → AI match-status explainer (AI foundation feature #7) on demand. Tooltip or modal.

**Acceptance:**
- Filtering by match-status is fast (indexed column).
- Variance badges use unified severity vocabulary (minor / moderate / major).
- Row click opens a drawer with details + "Why is this off-contract?" which invokes the AI explainer on demand.
- Empty state when no records for filter.

**Plan detail:** On-demand — `06-records-table-plan.md`.

---

### Subsystem 7 — Pricing files table + recompute UI (P1)

**Priority:** P1.

**Files:**
- Modify: `components/facility/cog/pricing-files-table.tsx` (116 lines) — expose the new `PricingFile` stat columns (record count, on-contract spend, savings, match rate, error/warning counts).
- Add: per-file actions — "Recompute contract matches for this file's vendor", "Delete file" (cascades to records).
- Add: "Recompute all contract matches" button at page level that fires `recomputeMatchStatusesForFacility`.
- Modify: `components/facility/cog/cog-upload-history.tsx` (287 lines) — audit; dedupe with pricing-files-table if overlap.

**Acceptance:**
- File stats render correctly.
- Recompute button shows progress and completion toast.
- Delete file cascades correctly and invalidates TanStack queries.

**Plan detail:** On-demand — `07-pricing-files-plan.md`.

---

### Subsystem 8 — CSV export + filter pipeline polish (P2)

**Priority:** P2.

**Files:**
- Create: `lib/cog/export.ts` — server action that applies the current filter set + returns CSV blob.
- Modify: COG client to expose "Export" button on the records page and on the pricing files page.
- Defer: XLSX + PDF export (v2).

**Acceptance:**
- Exports respect current filter.
- CSV handles quoted fields, commas, newlines correctly.
- Large exports (>50k rows) stream via Response body (not blocking action).

**Plan detail:** On-demand — `08-export-plan.md`.

---

### Subsystem 9 — Mega-file splits + tech debt (P1)

**Priority:** P1 — per user's tech-debt directive.

**Files:**

**Split `components/import/mass-upload.tsx` (1454 lines)** into:
- `components/import/mass-upload-orchestrator.tsx` — ≤200 lines, routes to the right sub-flow based on file-type selection
- `components/import/mass-upload-file-detect.tsx` — file-type auto-detection (COG / pricing / invoice / case-costing)
- `components/import/mass-upload-cog-flow.tsx` — delegates to `cog-import-dialog.tsx` logic
- `components/import/mass-upload-pricing-flow.tsx` — delegates to `pricing-import-dialog.tsx`
- `components/import/mass-upload-invoice-flow.tsx` — delegates to `invoice-import-dialog.tsx` (from data-pipeline spec)
- `components/import/mass-upload-case-flow.tsx` — delegates to `case-import-dialog.tsx` (out of scope for current rewrite batch; stub)
- `components/import/mass-upload-result-summary.tsx` — shared post-upload summary

**Split `lib/actions/mass-upload.ts` (1093 lines)** into:
- `lib/actions/mass-upload-orchestrator.ts` — ≤150 lines, routes to per-domain imports
- `lib/actions/cog-import.ts` — COG-specific logic moved from here
- `lib/actions/pricing-import.ts` — pricing-specific logic moved here
- (Invoice / case imports stay in their own action files — `lib/actions/invoices.ts`, `lib/actions/cases.ts`)

**Audit `lib/actions/cog-records.ts` (643 lines):**
- From subsystem 0's catalog, split long functions into focused helpers.
- Target: no function ≥80 lines; file ≤400 lines.

**Audit `components/facility/cog/cog-import-dialog.tsx` (570 lines):**
- Extract the pipeline orchestration into a custom hook `useCogImportPipeline`.
- Target: component ≤350 lines; hook ≤250 lines.

**Acceptance:**
- No functional regression on COG / pricing / invoice / case uploads.
- Split files have focused responsibilities (one responsibility per file).
- `bunx tsc --noEmit` → 0 errors.
- File sizes under the targets above.

**Plan detail:** On-demand — `09-mega-file-splits-plan.md`.

---

### Subsystem 10 — UI polish + integration (P1)

**Priority:** P1.

**Files:**
- All subsystem touches get a consistency pass: card heights, hydration-safe rendering, responsive breakpoints, a11y.
- AI review UIs use the shared components from AI foundation subsystem 4; no per-feature review UI.
- Empty states are informative (not "no data" — "upload your first COG file to start matching contracts").
- Error states are recoverable (retry buttons, not dead-end messages).

**Acceptance:**
- Manual smoke test: fresh facility account → upload sample COG → see enrichment + AI advisories → dashboards + price discrepancy report populate.
- `bun run build` → compiled successfully.
- Lighthouse a11y pass on /dashboard/cog-data.

**Plan detail:** On-demand — `10-ui-polish-plan.md`.

---

## 5. Execution model

**Sequencing:**

```
Subsystem 0 (schema + action audit)
  ↓
Subsystem 1 (enrichment engine)
  ↓
Subsystem 2 (contract-save recompute)
  ↓
Subsystem 3 (import pipeline)   Subsystem 4 (dedup refine)   Subsystem 5 (quality panel)
  ↓                              ↓                            ↓
Subsystem 6 (records table)     Subsystem 7 (pricing files)
  ↓                              ↓
       Subsystem 8 (export)
              ↓
Subsystem 9 (mega-file splits) — can run in parallel with any of 3-8 but lands last
  ↓
Subsystem 10 (UI polish integration)
```

Per-subsystem cadence: same as prior specs.

**Global verification:**

```bash
bunx tsc --noEmit
bun run lint
bun run test
bun run build
bun run db:seed
```

Plus:
```bash
bun run test lib/cog/__tests__/enrichment.test.ts
bun run test lib/cog/__tests__/quality.test.ts
```

---

## 6. Acceptance (whole rewrite)

- All 10 subsystems merged to main.
- COG enrichment columns populated for every COG row after subsystem 2 recompute (backfill script runs on existing seed data).
- 6 match statuses distributed sensibly across seeded data (not all `pending`).
- `/dashboard/cog-data` match status + savings badges render correctly.
- AI column-mapping, vendor dedup, item dedup, division inference, quality narrator, match-status explainer all wired and pass smoke test (advisory only; user confirms).
- Credits deduct; audit logs populated.
- `mass-upload.tsx` split; orchestrator ≤200 lines; each sub-flow focused.
- `mass-upload.ts` split into per-domain action files.
- `bunx tsc --noEmit` → 0 errors.
- `bun run test` → all passing.
- `bun run db:seed` → 10/10 QA sanity passing + new QA checks for match-status distribution.

---

## 7. Known risks

1. **Backfill for existing seeded COG rows.** Subsystem 2's recompute runs per-vendor inline; backfilling all seed rows requires a one-off script. Mitigation: subsystem 0's plan includes `scripts/backfill-cog-enrichment.ts` that walks every vendor and runs recompute.
2. **AI credit costs on large uploads.** A 50k-row upload with many new vendors could burn credits fast. Mitigation: cap Claude-assist per-upload to top-N ambiguous items (e.g., 50 new-vendor cases, 50 dedup cases). Everything else falls back to deterministic-only. Document limits in subsystem 3.
3. **Recompute storm on contract edit.** Same concern as contracts-rewrite — bounded by vendor scope, fine at demo scale; background-job extraction is a v2 TODO.
4. **AI advisor delays the import UX.** Claude calls in the upload flow add latency. Mitigation: parallelize Claude calls; show spinners per section ("Parsing..." / "Checking duplicates (advisor running)..." / "Enriching..."). Advisor is advisory — user can skip all and proceed with deterministic results only.
5. **Division inference false positives via Claude.** A "knee" in a free-text description that's actually about "knee height adjustment brace" could mis-route to orthopaedics. Mitigation: inference is a *hint*, not a state change — the division field is just a label on the COG row used for reports. No downstream commitment-math breaks if wrong.
6. **Mass-upload split regression.** Splitting a 1454-line shared component risks breaking invoice + case flows too. Mitigation: subsystem 9 does the split as one focused commit with a smoke-test checklist covering all four flows (COG / pricing / invoice / case).
7. **`vendor-name-matcher.tsx` retire breaks existing tests.** 289 lines, may have tests. Mitigation: audit during subsystem 4; keep if tests depend on it, retire cleanly with test updates.

---

## 8. Out of scope (explicit)

- **FieldMappingConfig Prisma model** — v2.
- **ContractItemAlias table** — v2.
- **Streaming upload** for files >50MB — v2.
- **XLSX + PDF export** — v2 (CSV only in v1).
- **Trend + forecast on COG metrics** — belongs to `/dashboard/analysis/prospective` spec.
- **Per-row soft-delete** — file-level delete + AuditLog only.
- **Compliance-violation detection within COG page** — compliance engine lives in contracts-rewrite subsystem 4; rendered on contract detail pages, not here.
- **Cross-facility COG rollup views** — multi-facility queries work (filter by `facilityId`), but no dedicated rollup UI.

---

## 9. How to iterate

1. Pick a subsystem (start with 0; 1 + 2 are on the critical path).
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute per plan; commit each separately.
4. Verify acceptance; merge to main; proceed.

---

## 10. v0 Parity Gaps

Source: 2026-04-19 audit of v0 prototype at `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/`.
These subsystems are **additive** to sections 1-9 above — they capture user-facing v0
behavior that isn't already covered by the original COG subsystems 1-6.

### Subsystem 10.1 — Import-wizard enrichment feedback

**Priority:** P1

**Why this exists:** v0's COG import wizard, after parsing the CSV, runs the
match-to-contracts step and shows a stats card on the success screen
("8,432 records matched", "1,891 unmatched", "On-contract rate: 81.7%"). Tydei's
import dialog completes silently — the user sees a toast and a count, but no
match summary.

**v0 reference:** `components/cog/cog-importer.tsx` final step + the
match-status histogram on import completion.

**Files (tydei):**
- Modify: `lib/actions/cog-import.ts::ingestCOGRecordsCSV` — return
  `{ created: number, matched: number, unmatched: number, onContractRate: number }`
  in addition to current return shape.
- Modify: `components/facility/cog/cog-import-dialog.tsx` — render a final
  "Import complete" Card with the four metrics + a "Re-run match" CTA that
  invokes Subsystem 10.2.
- Test: `lib/actions/__tests__/cog-csv-import.test.ts` — extend with a case
  asserting the return shape includes the new fields.

**Approach:**
1. Action change — after the existing ingest + enrichment passes, query
   `prisma.cOGRecord.aggregate({where:{...justImported}})` to compute
   matched/unmatched counts.
2. UI surfaces those numbers on completion.

**Acceptance:**
- Import action returns the four new fields.
- Dialog shows the stats card after a successful import.
- Test passes with the extended return shape.

**Known risks:**
- "Just imported" needs a stable filter — pass back the file id from the
  ingest action, then filter `cOGRecord.fileImportId` for the count.

**Dependencies:** Subsystem 1 (FileImport tracking) — for the per-file scoping
of the count. Otherwise falls back to facility-wide counts.

---

### Subsystem 10.2 — "Re-run match" button on COG page

**Priority:** P1

**Why this exists:** The `backfillCOGEnrichment` server action shipped today
(commit `153ae97`) lets a facility re-run match-to-contracts across every
existing COG row. The button to trigger it lives on the COG page (also shipped
in `153ae97`) — but verify it's actually visible and wired (cg subagent
reported it shipped, audit on the live page).

**v0 reference:** v0 doesn't have an explicit "re-run match" — its store
auto-recomputes on every contract change. Tydei needs the manual button
because Prisma writes are explicit.

**Files (tydei):**
- Verify: `components/facility/cog/cog-data-client.tsx` — confirm the button
  exists, is enabled for facility users, and shows the result toast.
- If missing/broken, fix per the original Bug 1 plan.
- Smoke test: hit `/dashboard/cog-data` as `demo-facility@tydei.com`, click
  the button, confirm at least one record changes from `pending` to a
  matched status.

**Approach:**
1. Read the file, check for the button + mutation wiring.
2. If absent: re-port from the worktree `agent-a5c61de1` (Task 1) which had
   the original implementation.
3. Add a Vitest assertion if missing — `bunx vitest run lib/cog/__tests__/recompute-backfill.test.ts`.

**Acceptance:**
- Button visible on the COG page header.
- Click runs `backfillCOGEnrichment`, shows "Enriched N records" toast.
- COG records table refreshes via TanStack Query invalidation.

**Known risks:** none.

**Dependencies:** Subsystem 1 (already shipped via Bug 1).

---

### Subsystem 10.3 — Pricing-file import history table

**Priority:** P2

**Why this exists:** v0 has a separate track for pricing-file imports
(distinct from COG imports) with a history table showing per-file stats
(rows imported, items matched to contracts, last import date). Tydei imports
pricing files (commit `bff3a3c` and similar) but doesn't surface the history.

**v0 reference:** `components/cog/PricingFileUpload` line ~87 (referenced in
diff report).

**Files (tydei):**
- Create: `lib/actions/imports/pricing-history.ts` — server action
  `getPricingImportHistory()` returning recent `PricingFile` rows with their
  associated `_count.items`.
- Create: `components/facility/cog/pricing-import-history-card.tsx` — table
  with columns: filename / uploaded / row count / matched items / actions
  (download original).
- Modify: `components/facility/cog/cog-data-client.tsx` — render the card
  below the existing import section.
- Test: `lib/actions/imports/__tests__/pricing-history.test.ts` — mocked
  prisma returning two pricing files, assert the rows.

**Approach:**
1. Action first.
2. UI card consuming the action via TanStack Query.
3. No mutations — read-only history.

**Acceptance:**
- Card renders the last 20 pricing-file imports.
- Empty state visible when no imports exist.
- Test passes.

**Known risks:**
- `PricingFile` schema model may not exist by that name — confirm the
  Prisma model used by the existing pricing import flow first.

**Dependencies:** existing pricing-import infrastructure (assumed shipped).

---

### Subsystem 10.4 — AI dedup advisor

**Priority:** P2

**Why this exists:** Today's duplicate detector (`lib/cog/duplicate-detection.ts`)
catches exact-match dupes via the (vendorItemNo, transactionDate, extendedPrice)
key. v0's `DuplicateValidator` component layers an AI suggestion on near-misses
("These two rows look like the same purchase split across two invoices —
deduplicate?"). Adds value when CSV exports are messy.

**v0 reference:** `components/cog/duplicate-validator.tsx`.

**Files (tydei):**
- Create: `lib/cog/ai-dedup.ts` — `findFuzzyDuplicates(records)` returns
  pairs that the deterministic detector missed but look duplicate-ish (close
  in date, same vendor, same item description, similar price). No AI call
  yet — start with a deterministic fuzzy matcher.
- Create: `components/facility/cog/dedup-advisor-card.tsx` — shows pairs +
  per-pair "Merge" / "Ignore" actions (writes a `cog_dedup_decision` log).
- Modify: `components/facility/cog/cog-import-dialog.tsx` — add a step
  between dedup-preview and confirm that surfaces the advisor.
- Test: `lib/cog/__tests__/ai-dedup.test.ts` — fixture with 2 obvious dupes
  + 1 borderline, assert the advisor flags the borderline.

**Approach:**
1. Deterministic fuzzy matcher first (Levenshtein distance on description +
   ±5% price + ±7d date).
2. AI escalation deferred — this prepares the surface for it.
3. Decisions logged in audit table for traceability.

**Acceptance:**
- Advisor flags fuzzy-match candidates that the deterministic detector misses.
- "Ignore" suppresses the pair on future imports for this facility.
- Test passes.

**Known risks:**
- Fuzzy matcher false-positive rate matters — start strict and loosen with
  feedback.

**Dependencies:** none.

---

### Subsystem 10.5 — Canonical `matchCOGRecordToContract`

**Priority:** P1

**Why this exists:** Today's COG → contract enrichment uses fuzzy vendor-name
matching (`lib/cog/match.ts`). The platform-data-model spec defines a
canonical resolver (`findVendorByName` cascade + canonical contract pricing
lookup) that should replace the interim fuzzy approach. v0 effectively
performs canonical matching via in-memory contract pricing arrays.

**v0 reference:** v0's `lib/cog-data-store.ts` matches by exact `vendorItemNo`
against contract pricing rows; misses fall back to fuzzy vendor-name only.

**Files (tydei):**
- Modify: `lib/cog/match.ts::findContractForCOGRecord` — try in order:
  1. Exact `vendorItemNo` match against `ContractPricing.vendorItemNo` for
     contracts active on `transactionDate`.
  2. Exact `vendorId` match (when COG row has a resolved vendor) AND record
     date falls within an active contract's effectiveDate/expirationDate.
  3. Fuzzy vendor-name match (current behavior — last resort).
- Modify: `lib/cog/recompute.ts::recomputeMatchStatusesForVendor` — feed the
  upgraded resolver, set `matchStatus` per the four-state enum from
  platform-data-model.
- Test: `lib/cog/__tests__/match.test.ts` — extend with cases for each
  match-mode precedence.

**Approach:**
1. Test-first: write the precedence cases.
2. Implement the cascade.
3. Re-run `backfillCOGEnrichment` on the demo facility — confirm the match
   rate improves vs the fuzzy-only baseline (489/571 from today's smoke).

**Acceptance:**
- Match rate on the demo facility's COG ≥ today's 86% (489/571), preferably
  approaching 100% for records whose vendorItemNo exists in active contract
  pricing.
- Tests cover all three precedence modes.

**Known risks:**
- `ContractPricing` rows may not exist for every active contract — will need
  to be backfilled (separate task) for the canonical match to be useful.

**Dependencies:** platform-data-model spec for the `findVendorByName`
canonical helper.

---
