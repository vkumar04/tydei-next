# Alerts Rewrite — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** continue in `contracts-rewrite-00-schema`
**Status:** Design approved by Vick (2026-04-18) via batch approval
**Brainstormed via:** superpowers:brainstorming
**Related specs:**
- Required dependency: `2026-04-18-platform-data-model-reconciliation.md` (match status drives `off_contract` alerts)
- Required dependency: `2026-04-18-contracts-rewrite.md` (tier progress + compliance + accrual engines provide the data alerts are derived from)
- Required dependency: `2026-04-18-cog-data-rewrite.md` (contract-save recompute triggers alert re-synthesis)
- Referenced by: every page that renders the alerts badge in the shell header

**Goal:** Rewrite `/dashboard/alerts` (list) and `/dashboard/alerts/[id]` (detail) to:
- Use Prisma-backed alerts (not localStorage)
- Synthesize alerts from live contract/COG state via a rules engine
- Fix the "mock data on detail page" inconsistency from the prototype
- Render the 5 type-specific detail blocks (off-contract items table, tier-progress bar, etc.)
- Support bulk actions with optimistic UX

**Architecture:** Tydei already has an `Alert` Prisma model. This spec (a) persists the 5 alert types + their metadata, (b) runs a rules engine on-demand (contract save, COG import, term update) to generate/resolve alerts, (c) unifies the list + detail pages on a single server action, (d) removes the mock data path on detail.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, shadcn/ui, TanStack Query, Zod, date-fns. Uses existing `Alert` model + audit log.

---

## 1. Scope

### In scope

- **Schema audit** — confirm `Alert` model + `AlertType` enum values match canonical (may need additive fields on metadata JSON)
- **Alert synthesizer** — on-demand rules engine fires on contract save / COG recompute / term update; generates fresh alerts + resolves ones no longer applicable
- **List page** — tabs (all / unread / off_contract / expiring / rebates), 4 summary cards, bulk actions (mark-read / resolve / dismiss), select-all
- **Detail page** — unified with list store; 5 type-specific content blocks; actions sidebar with type-specific primary CTA
- **Route mapping** — `actionLink` per alert type
- **Header badge** — count reflects real unresolved-new alerts across every page
- **UI polish** — empty states, a11y, hydration-safe rendering

### Out of scope

- **Cron-based nightly re-synthesis** — all alert generation is event-driven (inline in the mutating user's session, same pattern as contracts-rewrite's accrual recompute)
- **Vendor-side alerts** — separate vendor-portal spec
- **Email / Slack dispatch** — belongs to the future notification-delivery spec
- **AI-generated alert narratives** — prototype shows a "Recommendations" card with static copy per type; tydei v1 ports the static copy. AI-generated guidance is a follow-up.
- **Alert grouping** — prototype shows one alert per PO even if 50 items are off-contract. Same approach for tydei.
- **Historical alert audit view** — no "all resolved alerts in the last year" archive page in v1.

### Non-goals (preserved)

- No stack swaps. No cron infrastructure.

---

## 2. Translation notes — canonical prototype → tydei

| Prototype pattern | Tydei equivalent |
|---|---|
| `useAlerts('facility')` localStorage hook | `useAlerts()` TanStack Query hook hitting `lib/actions/alerts.ts` |
| `isHydrated` gate on client-only store | Suspense + TanStack's `isPending` |
| Detail page reads a local mock array | Detail page reads the same `getAlert(id)` action as the list. **Mock removed.** |
| `alertIcons / alertColors / priorityColors / statusColors` constants | Same constants, lifted to `components/shared/alerts/alert-styles.ts` for reuse |
| Bulk action: `resolveAlerts(ids[])` client call | Server action `bulkResolveAlerts(ids[])` + TanStack invalidation |
| `window` events from other pages | TanStack Query invalidation on mutation success |
| Mock data on detail page fallback `450000 / 500000` for tier_threshold | Real `current_spend` / `tier_threshold` from `Alert.metadata` (populated by synthesizer) |
| Priority enum: `high | medium | low` | Map to existing Prisma `AlertSeverity` enum (values may be `high`/`medium`/`low` already; verify in subsystem 0) |

---

## 3. Data model changes

**Verify / extend, not replace.** Tydei has `Alert` + `AlertType` + `AlertSeverity` + `AlertStatus` enums already.

**Subsystem 0 audit confirms:**

```prisma
model Alert {
  id          String         @id @default(cuid())
  facilityId  String
  type        AlertType
  severity    AlertSeverity
  status      AlertStatus    @default(new_alert)
  title       String
  message     String
  metadata    Json           // flexible per-type fields
  createdAt   DateTime       @default(now())
  resolvedAt  DateTime?
  dismissedAt DateTime?
  readAt      DateTime?

  facility    Facility @relation(fields: [facilityId], references: [id])

  @@index([facilityId, status])
  @@index([facilityId, type])
  @@map("alert")
}

enum AlertType {
  off_contract
  expiring_contract
  tier_threshold
  rebate_due
  payment_due
  pricing_error
  compliance
}

enum AlertSeverity {
  high
  medium
  low
}

enum AlertStatus {
  new_alert       // "new" — not yet viewed
  read            // viewed, not resolved
  resolved        // actioned + closed
  dismissed       // hidden without action (soft-delete-like)
}
```

**Metadata JSON shape per type** — documented as typed helpers in `lib/alerts/metadata.ts`:

- `OffContractMeta`: `{ po_id, vendor_name, item_count, total_amount, items: [{sku, name, quantity, unitPrice, contractPrice | null}] }`
- `ExpiringContractMeta`: `{ contract_name, contract_id, vendor_name, days_until_expiry, expiration_date, annual_value }`
- `TierThresholdMeta`: `{ contract_name, contract_id, current_spend, tier_threshold, amount_needed, target_tier, tier_rebate }`
- `RebateDueMeta`: `{ contract_name, contract_id, vendor_name, amount, period }`
- `PaymentDueMeta`: `{ contract_name, contract_id, vendor_name, amount, due_date }`

If the existing `Alert` model is missing fields, they get added additively in subsystem 0.

---

## 4. Subsystems — priority-ordered

### Subsystem 0 — Data audit + schema extension (P0)

**Priority:** P0.

**Files:**
- Audit: `prisma/schema.prisma` — verify `Alert` model + enums match spec; flag any gaps
- Audit: `lib/actions/alerts.ts` (201 lines existing) — catalog functions; flag signature/shape drift vs canonical
- Modify as needed: add missing fields/types if gaps are small; otherwise file migration tickets

**Acceptance:**
- Schema matches spec (or explicit gap list filed).
- `bunx prisma validate` → valid.
- `bunx tsc --noEmit` → 0 errors.

**Plan detail:** On-demand — `00-audit-plan.md`.

---

### Subsystem 1 — Synthesizer engine (P0)

**Priority:** P0.

**Files:**
- Create: `lib/alerts/synthesizer.ts` — runs 5 rule types, returns `{ toCreate: AlertInput[], toResolve: string[] }`
- Create: `lib/alerts/__tests__/synthesizer.test.ts`
- Create: `lib/actions/alerts.ts::synthesizeForFacility(facilityId)` — server action that runs the engine + applies the deltas atomically

**Rules engine (each produces + resolves):**

1. **off_contract** — For every COG row where `matchStatus = 'off_contract_item'` AND PO is newer than the most recent alert of this type for that PO: create. Resolve when all matched items are now on-contract.
2. **expiring_contract** — For every active contract where `expirationDate - today <= 90 days` AND no active alert of this type for this contract: create with days-remaining. Resolve when contract is renewed or expires.
3. **tier_threshold** — For every contract with remaining tiers where `currentSpend` is within 15% of the next threshold (per contracts-rewrite subsystem 2's `calculateTierProgress`): create. Resolve when spend passes the threshold OR drops below 85% of target.
4. **rebate_due** — When a `ContractPeriod` closes and `rebateEarned > 0` and no rebate-payment exists: create. Resolve when `rebateCollected >= rebateEarned`.
5. **payment_due** — For capital contracts with upcoming payment schedules: create N days before due date. Resolve on payment.

**Trigger points (event-driven, no cron):**
- `contractCreated`, `contractUpdated`, `contractDeleted` → re-synth for that vendor/facility
- `cogRecordsImported` → re-synth off_contract rules for that facility
- `rebatePaid` → re-resolve rebate_due rules for that contract
- `paymentRecorded` → re-resolve payment_due rules for that contract

**Acceptance:**
- Running the synthesizer twice without changes is idempotent.
- Tests cover each rule's create-and-resolve lifecycle.
- Synthesizer runs in <2s on demo scale (≤50 contracts + ≤10K COG rows).

**Plan detail:** On-demand — `01-synthesizer-plan.md`.

---

### Subsystem 2 — List page (P1)

**Priority:** P1.

**Files:**
- Modify: `components/shared/alerts/alerts-list.tsx` (existing) — wire to new actions
- Create: `components/shared/alerts/alert-list-filters.tsx` — 5-tab filter
- Create: `components/shared/alerts/alert-summary-cards.tsx` — 4 summary cards
- Create: `components/shared/alerts/alert-bulk-actions.tsx` — bulk action bar (appears when `selectedAlerts.length > 0`)
- Create: `components/shared/alerts/alert-row.tsx` — single row w/ checkbox + icon tile + type-colored styling
- Modify: `lib/actions/alerts.ts::getAlerts(facilityId, { tab? })`, `bulkResolveAlerts(ids)`, `bulkDismissAlerts(ids)`, `bulkMarkReadAlerts(ids)`, `markAllRead(facilityId)`

**Feature parity with canonical:**
- Tabs: `all / unread / off_contract / expiring / rebates`
- Summary cards: Off-Contract Alerts, Expiring, Rebates Due, Total Unresolved
- Bulk toolbar: Mark Read, Resolve, Dismiss; clears selection on completion
- "Mark All Read" header-level button (no selection required)
- Row: checkbox + icon + title + time + message + metadata badges + View Details link + Resolve button
- Unread row tint `bg-muted/30`

**Acceptance:**
- All tabs filter correctly.
- Bulk actions invalidate TanStack queries; summary counts update instantly.
- Select-all behavior: if all filtered selected → clear; else select all filtered.

**Plan detail:** On-demand — `02-list-page-plan.md`.

---

### Subsystem 3 — Detail page (P1)

**Priority:** P1.

**Files:**
- Modify: `app/dashboard/alerts/[id]/page.tsx` — loads via `getAlert(id)` server action (not mock)
- Create: `components/shared/alerts/alert-detail-header.tsx` — icon + title + time + badges
- Create: `components/shared/alerts/alert-detail-metadata.tsx` — 2-column grid of present metadata fields
- Create: `components/shared/alerts/alert-detail-off-contract-items.tsx` — items table when `type === 'off_contract'`
- Create: `components/shared/alerts/alert-detail-tier-progress.tsx` — progress bar + copy when `type === 'tier_threshold'`
- Create: `components/shared/alerts/alert-detail-actions.tsx` — type-specific primary action button + resolve/dismiss

**Type-specific primary action button labels:**
- `off_contract` → "View Purchase Order"
- `expiring_contract` → "View Contract"
- `tier_threshold` → "View Contract"
- `rebate_due` → "View Rebate Details"
- `payment_due` → "View Contract"

**Acceptance:**
- Detail page reads from same store as list.
- Mock data removed entirely.
- Type-specific content blocks render when metadata present.
- Fallbacks handled: missing metadata → skip that field; unknown type → `AlertTriangle` + "Unknown alert type" message.

**Plan detail:** On-demand — `03-detail-page-plan.md`.

---

### Subsystem 4 — Status workflow + persistence (P1)

**Priority:** P1.

**Files:**
- Modify: `lib/actions/alerts.ts` — status transition actions:
  - `markRead(id)` — new_alert → read (sets `readAt`)
  - `resolve(id)` — any non-dismissed → resolved (sets `resolvedAt`)
  - `dismiss(id)` — any → dismissed (sets `dismissedAt`)
  - Bulk variants of each
- Modify: ensure each mutation writes to `AuditLog` (`action = 'alert.resolved'`, etc.)
- Modify: bulk action toast messages + selection clearing post-action

**Acceptance:**
- Every status transition writes an AuditLog row with `userId`, `action`, `metadata: { alertId, type, fromStatus, toStatus }`.
- Dismissed alerts do NOT show in `getAlerts` results (scoped WHERE status != 'dismissed' by default).
- Resolved alerts do NOT show in "Unresolved" summary card.

**Plan detail:** On-demand — `04-status-workflow-plan.md`.

---

### Subsystem 5 — Header badge + nav integration (P2)

**Priority:** P2.

**Files:**
- Modify: `components/shared/shells/portal-shell.tsx` or equivalent — subscribes to `useAlertsBadge(facilityId)` TanStack hook returning `{ count: number }` scoped to `status = 'new_alert'`
- The "7" badge in screenshot 2 (from dashboard spec) reflects this count
- Pulse animation when count increases

**Acceptance:**
- Badge appears on Alerts nav item.
- Count updates in real time via TanStack invalidation on any alert mutation.
- Pulse triggers on count increase (subtle; not on every re-render).

**Plan detail:** On-demand — `05-badge-integration-plan.md`.

---

### Subsystem 6 — UI polish (P2)

**Priority:** P2.

**Files:**
- Empty-state polish (tab-context-aware copy: "You're all caught up!" vs "No alerts in this category")
- a11y: row checkbox keyboard navigation, detail page heading hierarchy, summary card contrast in dark mode
- Responsive: table → card stack on `sm`
- Hydration-safe dates via Suspense/TanStack

**Acceptance:**
- Lighthouse a11y pass on both routes.
- Manual smoke at `sm`, `md`, `lg`, `xl`.

**Plan detail:** On-demand — `06-ui-polish-plan.md`.

---

## 5. Execution model

**Sequencing:**

```
Subsystem 0 (audit)
  ↓
Subsystem 1 (synthesizer)
  ↓                             ↘
Subsystem 2 (list)            Subsystem 3 (detail)
  ↓                             ↓
         Subsystem 4 (status workflow)
                ↓
         Subsystem 5 (header badge)
                ↓
         Subsystem 6 (UI polish)
```

**Global verification:**
```bash
bunx tsc --noEmit
bun run test
bun run build
bun run db:seed
bun run test lib/alerts/__tests__/synthesizer.test.ts
```

---

## 6. Acceptance (whole rewrite)

- All 6 subsystems merged to main.
- `Alert` table populated by the synthesizer after contract/COG mutations.
- List page renders all tabs, summary cards, bulk actions correctly.
- Detail page loads from the same store; no mock data path remains.
- Header badge reflects real unresolved-new count.
- `bunx tsc --noEmit` → 0 errors.
- `bun run test` → passing.

---

## 7. Known risks

1. **Synthesizer storm.** Big COG import triggers re-synth for every affected contract/vendor. Mitigation: scope recompute tight (per-facility, per-vendor); 10k COG rows doesn't rebuild all alerts.
2. **Alert deduplication across runs.** Running synth twice shouldn't create dupes; the existing-alert check must key on type + primary entity (PO id, contract id). Idempotency test required.
3. **Dismissed alerts returning after fresh synth.** If the underlying condition still applies, a new alert is created (not the same row un-dismissed). Mitigation: synthesizer respects the dismissal — if user dismissed an alert for contract X expiring, don't re-create it until state changes materially (e.g., <30 days from expiry triggers a fresh high-severity alert).
4. **Header badge flicker.** TanStack invalidation can cause count flicker. Mitigation: badge debounces UI updates 200ms.
5. **Mock removal regression.** Detail page currently 404s when alert id isn't in the mock array. Removing the mock means real 404s for truly non-existent ids. Mitigation: `getAlert(id)` returns typed `AlertNotFound` error; UI renders a polished 404 card with back button.

---

## 8. Out of scope (explicit)

- Cron-based nightly resynthesis
- Vendor-side alerts UI
- Email/Slack dispatch
- AI-generated recommendation copy
- Alert grouping across related entities
- Historical (resolved) alert archive view

---

## 9. How to iterate

1. Start with subsystem 0.
2. Generate per-subsystem plan via superpowers:writing-plans.
3. Execute; commit each separately.
4. Verify; merge; proceed.
