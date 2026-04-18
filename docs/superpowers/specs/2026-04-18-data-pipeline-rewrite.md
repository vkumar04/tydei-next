# Data Pipeline Rewrite — Invoices + POs + Price Discrepancy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps in those plans use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18). Scope trimmed — COG rewrite is its own spec; this covers the three downstream consumer pages of the enrichment pipeline.
**Related specs:**
- Required dependency: `2026-04-18-cog-data-rewrite.md` (enrichment columns + `matchStatus` + contract-save recompute)
- Required dependency: `2026-04-18-platform-data-model-reconciliation.md` (canonical matcher + vendor resolve)
- Required dependency: `2026-04-18-ai-integration-foundation.md` (AI column-mapping, match-status explainer)
- Optional: `2026-04-18-rebate-term-types-extension.md` (carve_out filtering surfaced on invoice validation when contract has carve-out rules)

**Goal:** Bring `/dashboard/invoice-validation`, `/dashboard/purchase-orders`, and `/dashboard/reports/price-discrepancy` to full functional parity — using the enrichment engines + `matchStatus` the COG rewrite persists. Add facility-side invoice dispute flag (no vendor-side resolution in this pass). Split the two mega-files in the invoice suite.

**Architecture:** Gap-closure. Every downstream consumer already has a working surface; the rewrite wires them to the canonical match algorithm + price-variance engine landed in earlier specs.

Current state:
- `components/facility/invoices/invoice-validation-client.tsx` — 740 lines (⚠️ mega-file)
- `components/facility/invoices/invoice-import-dialog.tsx` — 927 lines (⚠️ mega-file)
- `components/facility/invoices/invoice-validation-table.tsx` — 107 lines
- `components/facility/invoices/invoice-validation-detail.tsx` — 142 lines
- `components/facility/invoices/invoice-columns.tsx` — 144 lines
- `components/facility/purchase-orders/po-list.tsx` — 436 lines
- `components/facility/purchase-orders/po-create-form.tsx` — 435 lines
- `components/facility/purchase-orders/po-detail.tsx` — 104 lines
- `components/facility/purchase-orders/po-columns.tsx` — 146 lines
- `components/facility/purchase-orders/po-line-item-builder.tsx` — 127 lines
- `lib/actions/invoices.ts` — 372 lines
- `lib/actions/purchase-orders.ts` — 230 lines
- `lib/actions/reports.ts` — 199 lines (includes price-discrepancy sub-report)

Substantial foundation. Most subsystems are wire-up + polish; two are genuine tech-debt splits.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, shadcn/ui, TanStack Query, recharts, Zod, Bun.

---

## 1. Scope

### In scope

- **Invoice validation wiring** — on invoice-line save, populate `InvoicePriceVariance` via contracts-rewrite subsystem 5's engine. Display severity-graded variance per line.
- **Facility-side dispute flag** — add `Invoice.disputeStatus` + `disputeNote` columns; UI "Flag as Disputed" action + status badge. Vendor-side resolution surface deferred to vendor spec.
- **Purchase-order validation** — verify `POLineItem.contractId` + `isOffContract` populate on create/import. Surface per-line on-contract badge and PO-level off-contract total.
- **Price-discrepancy report** — aggregate over enriched `COGRecord` rows (fast, no runtime joins). Group by vendor / item / facility. Recovery totals. CSV export.
- **AI column-mapping assist on invoice + PO imports** (AI foundation feature #1)
- **AI match-status explainer on drill-down rows** (AI foundation feature #7) — already wired in COG spec; reused here
- **Tech debt:**
  - Split `invoice-validation-client.tsx` (740 lines)
  - Split `invoice-import-dialog.tsx` (927 lines) — may have already been partially split in COG rewrite subsystem 9; audit
  - Audit `lib/actions/invoices.ts` (372 lines); extract per-concern helpers

### Out of scope

- **Vendor-side dispute resolution surface** (`/vendor/invoices` acknowledge + credit memo workflow). Ships with vendor-transactions spec.
- **`InvoiceDispute` audit trail model.** V1 persists dispute status inline on `Invoice`; full audit via existing `AuditLog`. Separate table is v2.
- **GUDID / UDI FDA API integration** on POs. Its own initiative later.
- **Automated invoice dispute dispatch** (email to vendor on flag). Manual for v1.
- **Cross-facility invoice views** — single-facility scope.
- **AI-generated dispute narratives** — reserved for future AI layer.

### Non-goals (preserved)

- No stack swaps. No new external dependencies.
- No schema changes beyond the 2 nullable columns on `Invoice`.

---

## 2. Translation notes — canonical → tydei

| Canonical prototype pattern | Tydei equivalent |
|---|---|
| In-line `lookup(tydei_pricing_data, vendorItemNo + vendor)` | Uses enriched `COGRecord.contractPrice` + `contractId` already populated by COG rewrite |
| `window.dispatchEvent('cog-data-updated')` cascade to price-discrepancy page | TanStack Query invalidation on COG enrichment / contract-save recompute |
| Per-line variance computed on-the-fly in the report | Pre-computed + persisted via `InvoicePriceVariance` rows (contracts-rewrite subsystem 5) + `COGRecord.variancePercent` (COG rewrite) — report just aggregates |
| Fuzzy vendor match for PO validation | Uses `POLineItem.contractId` + `vendorId` FKs already populated |
| Price-tolerance default 2% | Kept; carried forward from platform-data-model §4.12 as the `price_variance` threshold |
| Manual "Refresh Contract Status" button on PO page | Not needed — COG rewrite's contract-save recompute already invalidates and re-enriches affected rows |

---

## 3. Data model changes

**Additive only — 2 new columns on `Invoice`:**

```prisma
enum InvoiceDisputeStatus {
  none
  disputed
  acknowledged     // reserved for vendor-transactions spec; unused in v1
  resolved         // reserved; unused in v1
}

model Invoice {
  // ... existing fields

  disputeStatus InvoiceDisputeStatus @default(none)
  disputeNote   String?

  @@index([disputeStatus])
}
```

**No other schema changes.**

- `POLineItem.contractId` + `isOffContract` exist.
- `InvoiceLineItem.contractPrice` + `variancePercent` + `isFlagged` exist.
- `InvoicePriceVariance` model exists (contracts-rewrite subsystem 0).

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Schema migration + action audit (P0)

**Priority:** P0.

**Files:**
- Modify: `prisma/schema.prisma` — add `InvoiceDisputeStatus` enum + `Invoice.disputeStatus` + `Invoice.disputeNote`
- Audit: `lib/actions/invoices.ts` (372 lines) — catalog functions; identify split candidates for subsystem 6
- Audit: `lib/actions/reports.ts` (199 lines) — specifically the price-discrepancy aggregation functions
- Audit: `lib/actions/purchase-orders.ts` (230 lines) — verify on-contract enrichment fires on PO line-item create/update

**Acceptance:**
- `bunx prisma validate` → valid.
- `bun run db:push` → in sync, zero data-loss warnings.
- `bunx tsc --noEmit` → 0 errors.
- Audit reports filed; split plan for invoice + report actions.

**Plan detail:** On-demand — `00-schema-audit-plan.md`.

---

### Subsystem 1 — Invoice variance population (P0)

**Priority:** P0.

**Files:**
- Modify: `lib/actions/invoices.ts::createInvoice` / `updateInvoice` / `importInvoices` — on every invoice line save, call `analyzePriceDiscrepancies` from contracts-rewrite subsystem 5; upsert `InvoicePriceVariance` rows keyed by `invoiceLineItemId`.
- Modify: `lib/actions/invoices.ts::getInvoice` — include `InvoicePriceVariance` relation so UI renders graded severity.

**Acceptance:**
- Every invoice with line items matched to a contract pricing row gets `InvoicePriceVariance` rows populated.
- Severity levels (minor <2% / moderate 2-10% / major ≥10%) render correctly.
- Re-importing the same invoice doesn't duplicate variance rows (upsert keyed by `invoiceLineItemId`).

**Plan detail:** On-demand — `01-variance-population-plan.md`.

---

### Subsystem 2 — Invoice validation page polish (P1)

**Priority:** P1.

**Files:**
- Modify: `components/facility/invoices/invoice-validation-client.tsx` (740 lines) — wire enrichment + variance display; subsystem 6 handles the split.
- Modify: `components/facility/invoices/invoice-validation-table.tsx` (107 lines) — variance severity badge column
- Modify: `components/facility/invoices/invoice-columns.tsx` (144 lines) — add variance + dispute-status columns
- Modify: `components/facility/invoices/invoice-validation-detail.tsx` (142 lines) — per-line variance breakdown; AI match-status explainer on hover

**UI additions:**
- Line-level variance badge (green / amber / red per severity)
- Invoice-level variance total in header ("Total overcharge: $X")
- "Flag as Disputed" action (subsystem 3)
- "Why is this line flagged?" drilldown invokes AI match-status explainer on demand

**Acceptance:**
- Invoices with variance render correctly.
- Line drill-down shows variance details + reasoning tooltip (on-demand AI call).
- No regression on existing validation flow.

**Plan detail:** On-demand — `02-invoice-validation-plan.md`.

---

### Subsystem 3 — Invoice dispute flag (P1)

**Priority:** P1.

**Files:**
- Modify: `lib/actions/invoices.ts::flagInvoiceAsDisputed(invoiceId, note)` — new action; writes `disputeStatus: "disputed"` + `disputeNote`; logs to `AuditLog`
- Modify: `components/facility/invoices/invoice-validation-client.tsx` — "Flag as Disputed" button; dispute note textarea; status badge in invoice header
- Banner in dispute dialog: *"Vendor acknowledgment workflow coming soon. Flagging sets internal status + audit trail only."*

**Acceptance:**
- Facility user can flag an invoice; status persists; audit row written.
- Banner clarifies that vendor-side resolution isn't live yet.
- Filter on invoice list: show only disputed.

**Plan detail:** On-demand — `03-dispute-flag-plan.md`.

---

### Subsystem 4 — PO validation page (P1)

**Priority:** P1.

**Files:**
- Modify: `components/facility/purchase-orders/po-list.tsx` (436 lines) — audit; add on-contract summary stat ("5 of 12 POs have off-contract lines"); filter by off-contract
- Modify: `components/facility/purchase-orders/po-detail.tsx` (104 lines) — per-line on-contract badge; show off-contract total at PO level
- Modify: `components/facility/purchase-orders/po-create-form.tsx` (435 lines) — audit; verify on-contract enrichment fires on line add
- Modify: `components/facility/purchase-orders/po-columns.tsx` (146 lines) — add "Off-contract %" column
- Modify: `components/facility/purchase-orders/po-line-item-builder.tsx` (127 lines) — real-time on-contract validation hint when user enters vendorItemNo

**Acceptance:**
- PO list shows off-contract summary + filter.
- PO detail shows per-line badge.
- Create form validates vendorItemNo against contract pricing live (on blur).

**Plan detail:** On-demand — `04-po-validation-plan.md`.

---

### Subsystem 5 — Price-discrepancy report (P1)

**Priority:** P1.

**Files:**
- Modify: `lib/actions/reports.ts::getPriceDiscrepancyReport` — aggregate over enriched `COGRecord` rows:
  - Group by vendor (top 20 by overcharge total)
  - Group by item (top 50 by overcharge total)
  - Group by facility (all, sorted by overcharge total)
  - Overall totals: overcharge / undercharge / recovery-potential
  - Dispute status rollup: `disputedTotal` / `pendingTotal` (from `Invoice.disputeStatus`)
- Create: `components/facility/reports/price-discrepancy-client.tsx` — top-N tables per grouping dimension, tabs, date filter, export-to-CSV
- Modify: `app/dashboard/reports/price-discrepancy/page.tsx` — render new client component

**Acceptance:**
- Report runs in <2s over demo-scale data (10k COG rows + variance rows).
- Dispute rollup reflects real `Invoice.disputeStatus` values.
- CSV export matches displayed rows.

**Plan detail:** On-demand — `05-price-discrepancy-plan.md`.

---

### Subsystem 6 — Mega-file splits (P1, tech debt)

**Priority:** P1 — per user's tech-debt directive.

**Files:**

**Split `components/facility/invoices/invoice-validation-client.tsx` (740 lines)** into:
- `invoice-validation-client.tsx` — orchestrator (≤200 lines)
- `invoice-validation-header.tsx` — page header + actions (import + export)
- `invoice-validation-filters.tsx` — filter bar
- `invoice-validation-summary.tsx` — summary stats cards
- `invoice-validation-list.tsx` — wraps table + pagination
- `invoice-dispute-dialog.tsx` — flag-as-disputed dialog (subsystem 3)

**Split `components/facility/invoices/invoice-import-dialog.tsx` (927 lines)** into:
- `invoice-import-dialog.tsx` — orchestrator (≤200 lines)
- `invoice-import-upload.tsx` — file upload step
- `invoice-import-mapping.tsx` — column mapping step (consumes AI column-mapping assist from AI foundation)
- `invoice-import-preview.tsx` — parsed-row preview
- `invoice-import-commit.tsx` — final commit + progress

If the COG rewrite's subsystem 9 `mass-upload.tsx` split already factored out invoice logic into `mass-upload-invoice-flow.tsx`, keep the invoice-specific dialog split aligned with that orchestrator. Audit in subsystem 0.

**Audit + light refactor `lib/actions/invoices.ts` (372 lines):**
- Extract: `invoices/variance.ts` — `analyzeInvoiceVariance` (called by subsystem 1)
- Extract: `invoices/dispute.ts` — `flagInvoiceAsDisputed` + related
- Target: root `invoices.ts` ≤250 lines

**Acceptance:**
- No functional regression on invoice validation, import, or dispute.
- Each split file has a focused responsibility.
- `bunx tsc --noEmit` → 0 errors.
- `bun run build` → compiled.

**Plan detail:** On-demand — `06-mega-file-splits-plan.md`.

---

### Subsystem 7 — UI polish + integration (P2)

**Priority:** P2.

**Files:**
- Invoice + PO + price-discrepancy pages — consistency pass: card heights, responsive, a11y, hydration-safe.
- Empty states informative.
- Dispute UX surfaces the "coming soon" banner consistently.
- Match-status explainer tooltips work on every flagged row.

**Acceptance:**
- Manual smoke at `sm`, `md`, `lg`, `xl` viewports.
- Lighthouse a11y pass on all three pages.

**Plan detail:** On-demand — `07-ui-polish-plan.md`.

---

## 5. Execution model

**Sequencing:**

```
Subsystem 0 (schema + audit)
  ↓
Subsystem 1 (invoice variance population)
  ↓
Subsystem 2 (invoice validation polish)   Subsystem 4 (PO validation)
  ↓                                         ↓
Subsystem 3 (dispute flag)                Subsystem 5 (price-discrepancy report)
  ↓                                         ↓
         Subsystem 6 (mega-file splits) — runs in parallel, lands any time after 0
                      ↓
         Subsystem 7 (UI polish integration)
```

**Per-subsystem cadence:** same as prior specs.

**Global verification:**

```bash
bunx tsc --noEmit
bun run lint
bun run test
bun run build
bun run db:seed
```

---

## 6. Acceptance (whole rewrite)

- All 7 subsystems merged to main.
- Every invoice with contract-pricing matches has populated `InvoicePriceVariance` rows.
- Facility can flag an invoice as disputed; AuditLog populated.
- PO list + detail render on-contract / off-contract indicators.
- Price-discrepancy report aggregates correctly with real numbers + recovery rollup.
- Invoice + PO upload dialogs use AI column-mapping assist (advisory).
- `invoice-validation-client.tsx` split; orchestrator ≤200 lines.
- `invoice-import-dialog.tsx` split; aligned with `mass-upload` orchestrator pattern.
- `lib/actions/invoices.ts` ≤250 lines after helper extraction.
- `bunx tsc --noEmit` → 0 errors.
- `bun run test` → all passing.
- `bun run build` → compiled.

---

## 7. Known risks

1. **Variance population latency on large invoice imports.** 5k-row invoice × analyzePriceDiscrepancies runtime. Mitigation: batch variance upsert in 500-row chunks within the import transaction.
2. **Orphan `InvoicePriceVariance` rows if invoice line deleted.** Cascade on delete from `InvoiceLineItem` (schema already handles this per contracts-rewrite subsystem 0).
3. **Dispute flag without vendor resolution feels half-built.** Mitigation: prominent banner + link to "Vendor acknowledgment coming soon" doc page.
4. **PO line-item live on-contract validation call cost.** `po-line-item-builder.tsx` makes a server-action call on vendorItemNo blur — can thrash. Mitigation: debounce 300ms; cache by `(vendorId, vendorItemNo)` in session.
5. **Mass-upload split coordination.** COG rewrite's subsystem 9 may have moved invoice logic into `mass-upload-invoice-flow.tsx`; subsystem 6 here needs to align, not duplicate. Mitigation: subsystem 0's audit verifies current state.
6. **Price-discrepancy report performance on full history.** Aggregating over 100k COG rows with multiple GROUP BYs could be slow. Mitigation: indexed `COGRecord.variancePercent` + date-range filter default (last 90 days); "All time" option available but slower.

---

## 8. Out of scope (explicit)

- **Vendor-side `/vendor/invoices` dispute resolution** — vendor-transactions spec.
- **InvoiceDispute audit-trail model** — v2 feature; inline status + AuditLog for v1.
- **GUDID / UDI FDA API** — separate initiative.
- **Automated vendor-email dispute dispatch** — v2.
- **AI dispute narratives** — future AI layer spec.
- **Cross-facility invoice views** — single-facility scope.
- **COG data page** — separate spec (already written).

---

## 9. How to iterate

1. Pick a subsystem (start with 0).
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute; commit each separately.
4. Verify; merge; proceed.
