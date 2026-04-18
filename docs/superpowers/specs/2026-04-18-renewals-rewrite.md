# Contract Renewals Rewrite — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps in those plans use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** `renewals-rewrite` (create via worktree before execution, or continue in `contracts-rewrite-00-schema`)
**Status:** Design approved by Vick (2026-04-18). Four architectural decisions locked in (see §3 header).
**Related specs:**
- Completed: `2026-04-18-contracts-rewrite.md` — reuses `computeRebateFromPrismaTiers`, `ContractPeriod`, `RebateAccrual`, `ContractChangeProposal` patterns
- Parked: `2026-04-18-facility-dashboard-rewrite.md` — uniform `MetricCard` slot contract is inherited here for renewal stats cards
- Needed next (out of scope here): email/Slack alert delivery cron — will apply to renewals, reports, and notifications at once

**Goal:** Bring `/dashboard/renewals` (facility) and `/vendor/renewals` (vendor) to full functional and visual parity with the canonical functional spec. Both sides get rewritten as one unified effort because they share the renewal record shape, status classification, spend aggregation, timeline math, stats card pattern, ICS export, and text summary generator.

**Architecture:** Gap-closure on existing surfaces. Current state: ~1240 lines on facility side (including a 1007-line `renewals-client.tsx` that needs splitting), ~760 lines on vendor side, 227 lines of server actions, 44-line TanStack Query hook. Substantial foundation — most work is shape correction, engine wiring, and UI consistency.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, Better Auth, Tailwind v4, shadcn/ui, TanStack Query, recharts, date-fns, Bun. Reuses calculation engines from the contracts rewrite (`computeRebateFromPrismaTiers`, `calculateTierProgress`, `evaluatePurchaseCompliance`) and the uniform `MetricCard` slot contract from the dashboard rewrite. Claude is wired via `@ai-sdk/anthropic` but **not used** by this rewrite — AI-powered negotiation points are explicitly deferred.

---

## 1. Scope

### In scope

Both `/dashboard/renewals` (facility portal) and `/vendor/renewals` (vendor portal). Touched files:

```
app/dashboard/renewals/
  page.tsx                                         (auth check, renders client)
  loading.tsx                                      (Suspense fallback)

app/vendor/renewals/
  page.tsx                                         (auth check, renders client)
  loading.tsx

components/facility/renewals/                      (split from 1007-line client)
  renewals-client.tsx                              (orchestrator)
  renewals-header.tsx                              (title + Configure Alerts + Export)
  renewals-critical-banner.tsx                     (conditional alert)
  renewals-filters.tsx                             (tabs + vendor filter)
  renewals-table.tsx                               (contract list)
  renewals-detail-dialog.tsx                       (7-section dialog)
  renewal-initiate-dialog.tsx                      (exists; stays)
  renewal-summary-card.tsx                         (exists; reworked)
  alert-settings-dialog.tsx                        (new)

components/vendor/renewals/                        (split from 508-line pipeline)
  vendor-renewals-client.tsx                       (orchestrator)
  vendor-renewals-table.tsx                        (facility-grouped list)
  vendor-renewals-detail-dialog.tsx                (with RenewalNote timeline)
  vendor-renewal-empty.tsx                         (new — no fallback demo data)
  propose-terms-dialog.tsx                         (new)

components/shared/renewals/                        (new, consumed by both sides)
  renewal-timeline.tsx                             (365-day timeline w/ zones + markers)
  renewal-stat-card.tsx                            (uniform MetricCard-shaped slot)

lib/renewals/                                      (new)
  engine.ts                                        (status, spend map, history, points)
  exports.ts                                       (ICS builder + text summary)
  __tests__/engine.test.ts

lib/actions/renewals.ts                            (audit + extend; 227 → ~500 lines)
hooks/use-renewals.ts                              (audit + extend)

prisma/schema.prisma                               (additive migration; see §3)
```

### Out of scope

- **Route migration** `/dashboard/renewals` → `/dashboard/contract-renewals`. Keep current path. Optional one-liner redirect from `/contract-renewals` in `proxy.ts` if external links demand it.
- **AI-powered negotiation points.** Current rule-based `generateNegotiationPoints` gets ported as-is. Real Claude-powered recommendations belong to the deferred AI initiative.
- **Email / Slack alert delivery.** Settings UI only; dispatch infrastructure (cron + Resend template + bounce handling + unsubscribe) is a cross-cutting follow-up that covers renewals, reports, and notifications at once.
- **Realtime updates (SSE/websockets).** TanStack Query invalidation on mutation success is sufficient.
- **Renewal history / audit view.** Existing `ContractChangeProposal` review surface is assumed adequate; no separate renewal-history page in this rewrite.
- **Vendor-initiated full new contracts.** Handled by the existing `PendingContract` flow — unchanged.

### Non-goals (preserved)

- No stack swaps. No data-model regression. No debug-route ports.
- No unilateral refactor of unrelated files touched incidentally.

---

## 2. Translation notes — prototype spec → tydei

The canonical functional spec was written for the v0 prototype (client-side stores, `window` event bus, fuzzy vendor-name matching, hardcoded fallback data). Translate these before copying logic — every subsystem plan must cite this table.

| Prototype pattern | Tydei equivalent |
|---|---|
| `systemContracts` array / `initializeContracts()` / `getActiveContracts()` | `prisma.contract.findMany({ where: { status: { in: [active, expiring] } } })` via `getRenewals()` server action |
| `getAllCogRecordsAsync()` + in-memory `vendorSpendMap` (`Map<vendorKey, number>`) | SQL-side aggregation — `prisma.cOGRecord.groupBy({ by: ['vendorId'], _sum: { extendedPrice: true } })`. Keyed on `vendorId`, not fuzzy first-word-of-vendor-name |
| Fuzzy vendor matching (`vendor.split(/[\s,]+/)[0].replace(/[^a-z0-9]/gi, '')`) | Use `vendorId` foreign key directly. Vendor name normalization isn't needed when the relation is typed |
| `usePendingContracts()` client-side hook | `prisma.pendingContract.findMany(...)` server action. `PendingContract` table exists; don't invent a new one |
| `window.addEventListener('cog-data-updated', ...)` | `queryClient.invalidateQueries({ queryKey: queryKeys.renewals.* })` on COG import and contract CRUD mutation success |
| `calculateRebatesEarned(contract, actualSpend)` — tier-walking function inside renewals | Dropped. Calls `computeRebateFromPrismaTiers(spend, term.tiers, { method: term.rebateMethod })` from `lib/rebates/calculate.ts` — single source of truth landed in contracts-rewrite subsystem 1 |
| `FALLBACK_TIER_PERCENTAGES = [0, 2, 4, 6, 8]` | Dropped. Real tier percentages come from `ContractTier.rebateValue`; missing tiers default to 0, not magic numbers |
| Synthesized 2-year history (`spend × 0.85`, `× 0.72`, `compliance - 5pp`) | Dropped. `getRealPerformanceHistory(contractId)` aggregates `ContractPeriod` + `RebateAccrual` per year. Empty state when no closed periods exist |
| `sampleContracts` hardcoded fallback (vendor side) | Dropped. Empty-state card when `renewals.length === 0`. Fresh tenants see a CTA, not fake data |
| `85 + Math.floor(Math.random() * 15)` compliance value | Dropped. Real `Contract.complianceRate` (populated by contracts-rewrite subsystem 4), or "—" when unknown |
| Renewal notes stored in in-memory `renewalNotes: []` array | New `RenewalNote` Prisma model. See §3 |
| Alert settings stored in component `useState` | New `RenewalAlertSettings` Prisma model, per-user. See §3 |
| `RenewalProposal` separate status flow (`DRAFT → SUBMITTED → UNDER_REVIEW → ACCEPTED/REJECTED/COUNTERED`) | Reuses `ContractChangeProposal` with `proposalType: 'renewal'` + extended `ProposalStatus` enum (add `countered`). See §3 |
| 1-year default expiration when `contract.expirationDate` is missing | Dropped. Tydei's `Contract.expirationDate` is NOT NULL; contracts without one can't exist |
| Format-string `MM/DD/YY` 2-digit year handling for COG dates | Dropped. `COGRecord.transactionDate` is typed `DateTime` |

---

## 3. Data model changes

Additive migration. No existing columns change. Batch all four items into one `bun run db:push` + `prisma generate` pass during subsystem 0.

### 3.1 Extend `ProposalStatus` enum

Add `countered` value. Covers the vendor-propose-terms counter flow (facility reviews a renewal proposal, suggests changes, sends back to vendor for revision). Existing values stay: `proposed`, `approved`, `rejected`, `applied`, `expired`.

```prisma
enum ProposalStatus {
  proposed
  approved
  rejected
  applied
  expired
  countered   // new
}
```

### 3.2 Extend `ProposalType` enum

Verify current values during subsystem 0 audit. Add `renewal` if not present. Renewal proposals are change proposals with this discriminator so the shared review UI can filter / label them distinctly.

### 3.3 New `RenewalNote` model

Vendor-side renewal conversation log per contract. Only vendors write; facility side doesn't see these per canonical spec §19. Enforce via `requireVendor` in the read action.

```prisma
model RenewalNote {
  id         String   @id @default(cuid())
  contractId String
  authorId   String
  note       String   @db.Text
  createdAt  DateTime @default(now())

  contract Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  author   User     @relation(fields: [authorId], references: [id])

  @@index([contractId, createdAt])
  @@map("renewal_note")
}
```

### 3.4 New `RenewalAlertSettings` model

Per-user preferences. Settings UI only in this rewrite; delivery job reads these when it ships.

```prisma
model RenewalAlertSettings {
  id               String   @id @default(cuid())
  userId           String   @unique
  email30Days      Boolean  @default(true)
  email60Days      Boolean  @default(true)
  email90Days      Boolean  @default(false)
  emailWeekly      Boolean  @default(false)
  emailRecipients  String?  // comma-separated
  slackEnabled     Boolean  @default(false)
  slackChannel     String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("renewal_alert_settings")
}
```

Back-relations on `Contract` (`renewalNotes RenewalNote[]`) and `User` (`renewalNotes RenewalNote[]`, `renewalAlertSettings RenewalAlertSettings?`) — added inline.

---

## 4. Subsystems — priority-ordered

Priority rubric same as prior rewrites:
- **P0** = blocks later subsystems OR silent-wrong-number on user-facing numbers
- **P1** = missing feature vs canonical spec, user-visible
- **P2** = polish / edge cases

### Subsystem 0 — Data layer + schema migration (P0)

**Priority:** P0 — blocks 1-9.
**Files:**
- Modify: `prisma/schema.prisma` (§3.1, §3.2, §3.3, §3.4)
- Modify: `lib/actions/renewals.ts` — audit current shape; extend with missing actions
- Modify: `hooks/use-renewals.ts` — hooks for new actions
- Modify: `lib/query-keys.ts` — `queryKeys.renewals.*` namespace

**What the audit must verify (current `lib/actions/renewals.ts`):**

1. `getFacilityRenewals()` returns contracts with `id`, `contractId`, `name`, `vendor {id, name}`, `productCategory`, `expirationDate`, `status`, `totalSpend`, `commitmentMet`, `rebatesEarned`, `rebatesCollected`, `currentTerms` (baseTier/maxTier/minCommitment/paymentTerms), `performanceHistory` (real, from `ContractPeriod`), `renewalTasks`, `suggestedNegotiationPoints`, `alertsConfigured`, `daysUntilExpiration`.
2. `getVendorRenewals()` returns contracts scoped via `requireVendor` with facility info, `totalSpend`, `rebatesPaid`, `rebateRate`, `currentTier`/`maxTier`, real `performanceHistory`, `facilityContact`, `renewalNotes` (via new model), `proposedTerms` (via ContractChangeProposal lookup).
3. Rebate values use `computeRebateFromPrismaTiers` — **never a local tier-walking reimplementation**.
4. All aggregations are SQL-side (`groupBy` / `_sum`), not client-side loops.

**New actions to add (if missing):**

- `getRealPerformanceHistory(contractId)` → `{ year, spend, rebate, compliance }[]` from `ContractPeriod` + `RebateAccrual`
- `getRenewalAlertSettings()` / `saveRenewalAlertSettings(input)` — per-user
- `listRenewalNotes(contractId)` / `createRenewalNote({contractId, note})` — vendor-only
- `submitRenewalProposal({contractId, proposedTerms, notes})` — creates `ContractChangeProposal` with `proposalType: 'renewal'`
- `reviewRenewalProposal({proposalId, decision, notes})` — facility sets `approved | rejected | countered`

**Acceptance:**

- `bunx prisma validate` passes.
- `bun run db:push` applies migration with zero data-loss warnings.
- `bunx prisma generate` succeeds; zod types regenerate.
- `bunx tsc --noEmit` → 0 errors.
- `bun run db:seed` → 10/10 QA sanity passing.
- Every new action has a smoke test asserting return shape.

**Plan detail:** On-demand — `2026-04-18-renewals-rewrite-00-data-layer-plan.md`.

---

### Subsystem 1 — Shared calculation engine (P0)

**Priority:** P0 — every UI subsystem consumes this.
**Spec reference:** Canonical spec §§4, 5, 6, 7, 13, 15.

**Files:**
- Create: `lib/renewals/engine.ts`
- Create: `lib/renewals/__tests__/engine.test.ts` (alongside, per project convention)

**Exports:**

```ts
// Status classification — spec §4
export function classifyRenewalStatus(daysUntilExpiration: number):
  "critical" | "warning" | "upcoming" | "ok"

// Real performance history from ContractPeriod + RebateAccrual — spec §13
export interface PerformanceHistoryRow {
  year: number
  spend: number
  rebate: number
  compliance: number | null  // null when unknown — NO synthesis
}

// Rule-based negotiation points — spec §15 rules 1-5
export function generateNegotiationPoints(input: {
  commitmentMet: number
  currentMarketShare: number | null
  marketShareCommitment: number | null
  currentTier: number
  maxTier: number
}): string[]

// Renewal task checklist — spec §14
export function generateRenewalTasks(commitmentMet: number): {
  id: string; task: string; completed: boolean
}[]
```

**Rules locked in (from canonical spec, no drift):**

- Status thresholds: `≤30 critical`, `≤90 warning`, `≤180 upcoming`, `else ok`.
- Negotiation points: always include (4) "Review pricing on top 10 SKUs vs market rates" and (5) "Consider multi-year agreement for rate lock"; conditionally (1) "Strong performance" when `commitmentMet >= 100`; (2) "Market share exceeded" when `currentMarketShare >= marketShareCommitment`; (3) dynamic tier-advancement text when `currentTier < maxTier`.
- Task checklist: 5 items. Task 1 auto-completes at `commitmentMet >= 80`; task 2 at `>= 90`; tasks 3-5 manual only.

**Tests (minimum — covers spec examples):**

- Status classification at day boundaries (30/31, 90/91, 180/181).
- Negotiation points emits exactly the rules that match.
- Task checklist auto-completion at the two thresholds.
- Real history returns empty array for a contract with zero `ContractPeriod` rows (no synthesis anywhere).

**Acceptance:** All tests green, exports typed end-to-end, no `any` usage.

**Plan detail:** On-demand — `01-engine-plan.md`.

---

### Subsystem 2 — Renewal timeline component (P1)

**Priority:** P1 — shared between both sides.
**Spec reference:** Canonical spec §10.

**Files:**
- Create: `components/shared/renewals/renewal-timeline.tsx`

**Props:**

```tsx
interface RenewalTimelineProps<T extends { id: string; daysUntilExpiration: number; status: RenewalStatus; label: string }> {
  renewals: T[]
  onMarkerClick?: (renewal: T) => void
}
```

**Implementation:**

- 365-day horizontal timeline.
- Three colored zones (critical 0-30, warning 30-90, upcoming 90-180) rendered via absolute-positioned divs. Zone percentages: `w-[8%]`, `left-[8%] w-[17%]`, `left-[25%] w-[25%]` per canonical spec §10.
- Per-renewal marker at `left: min(daysUntilExpiration / 365 × 100, 100)%`, colored by status (red/yellow/blue/green).
- Hover tooltip shows `label` + days.
- Click invokes `onMarkerClick`.
- Axis labels: Today / 30d / 60d / 90d / 180d / 1 year.

**Acceptance:** Works for both facility (vendor label) and vendor (facility label) sides with the same component. Keyboard focus ring on markers. No overlapping markers at the same day (nudge horizontally by index).

**Plan detail:** On-demand — `02-timeline-plan.md`.

---

### Subsystem 3 — Stats cards (P1)

**Priority:** P1 — fixes card-height consistency per dashboard lesson.
**Spec reference:** Canonical spec §8.

**Files:**
- Create: `components/shared/renewals/renewal-stat-card.tsx`

**Slot contract (uniform across both sides, same pattern as dashboard-rewrite's `MetricCard`):**

```tsx
interface RenewalStatCardProps {
  icon: LucideIcon
  title: string
  value: string             // primary big number
  description: string       // bottom caption
  borderAccent?: "red" | "yellow" | "blue" | "green"
}
```

Every card reserves the same vertical footprint even when content is short. Grids are always uniform height at `sm`, `md`, `lg`, `xl` breakpoints.

**Facility cards (4, per canonical spec §8):**

| # | Card | value | description | borderAccent |
|---|---|---|---|---|
| 1 | Expiring in 30 Days | `stats.critical` | "immediate attention" | red |
| 2 | Expiring in 90 Days | `stats.critical + stats.warning` | "action needed" | yellow |
| 3 | At-Risk Spend | `formatCurrency(stats.atRiskSpend180)` | "expiring within 6 months" | blue |
| 4 | Uncollected Rebates | `formatCurrency(stats.uncollectedRebates)` | "across all active" | red |

**Vendor cards (5, per canonical spec §8):**

| # | Card | value | description | borderAccent |
|---|---|---|---|---|
| 1 | Expiring in 30 Days | `stats.critical` | "urgent" | red |
| 2 | Expiring in 90 Days | `stats.critical + stats.warning` | "action needed" | yellow |
| 3 | At-Risk Revenue | `formatCurrency(stats.atRiskRevenue90)` | "next 90 days" | blue |
| 4 | Rebates Paid YTD | `formatCurrency(stats.rebatesPaidYTD)` | "year to date" | green |
| 5 | Active Facilities | `stats.facilitiesCount` | "with active contracts" | — |

**Acceptance:** Grid renders uniform heights at all breakpoints. No jagged cards. Border accent colors match.

**Plan detail:** On-demand — `03-stats-plan.md`.

---

### Subsystem 4 — Facility page (P1)

**Priority:** P1 — closes functional gaps.
**Spec reference:** Canonical spec §§2, 3, 11, 12.

**Files (post-split — the 1007-line file becomes ~6 focused files):**

- Modify: `components/facility/renewals/renewals-client.tsx` (orchestrator, ≤200 lines target)
- Create: `components/facility/renewals/renewals-header.tsx` (title + Configure Alerts + Export Calendar)
- Create: `components/facility/renewals/renewals-critical-banner.tsx` (conditional alert)
- Create: `components/facility/renewals/renewals-filters.tsx` (tabs + vendor filter)
- Create: `components/facility/renewals/renewals-table.tsx`
- Create: `components/facility/renewals/renewals-detail-dialog.tsx` (the 7-section dialog)

**Details dialog (canonical spec §12) has 7 sections in order:**

1. Status banner (days to expiration + action line + Contact Vendor button)
2. Performance summary (4 metrics: Total Spend, Commitment Met %, Rebates Earned, Uncollected)
3. Current Terms (4-col grid: Base Rebate, Max Rebate, Min Commitment, Payment Terms)
4. Performance History table — real data only; empty state when no closed periods
5. Renewal task checklist (from engine)
6. Negotiation recommendations (from engine, numbered)
7. Alert configuration preview (from `RenewalAlertSettings` + per-contract `alertsConfigured`)

**Acceptance:**
- Tabs/filters sort by `daysUntilExpiration` ascending.
- Clicking a row or a timeline marker opens the detail dialog.
- `renewals-client.tsx` is ≤200 lines; logic moved into focused child files.
- Dialog renders all 7 sections; empty states for §4 and §7 are informative.

**Plan detail:** On-demand — `04-facility-page-plan.md`.

---

### Subsystem 5 — Vendor page (P1)

**Priority:** P1.
**Spec reference:** Canonical spec §§2, 19.

**Files:**

- Modify: `components/vendor/renewals/vendor-renewals-client.tsx` (orchestrator)
- Create: `components/vendor/renewals/vendor-renewals-table.tsx` (facility-grouped list)
- Create: `components/vendor/renewals/vendor-renewals-detail-dialog.tsx` (facility contact + notes timeline)
- Create: `components/vendor/renewals/vendor-renewal-empty.tsx` (no sample-contracts fallback)
- Modify: `components/vendor/renewals/vendor-renewal-pipeline.tsx` (shrink/repurpose; current 508 lines)

**Differences from facility side:**
- Uses label `Urgent` instead of `Critical` on status config.
- Shows facility-contact block per contract.
- Shows renewal-notes timeline (uses new `RenewalNote` model; chronological desc).
- "Propose Terms" CTA opens subsystem 6's dialog.
- Empty state when `renewals.length === 0`: icon + "No Contracts Found" + CTA to `/vendor/contracts/new`. **No `sampleContracts` array in code.**
- Stats card: 5 cards (per §3).

**Acceptance:**
- Vendor session at `/vendor/renewals` sees only that vendor's contracts.
- Facility-contact rendered as read-only block (backed by real user/facility data, not hardcoded).
- Notes timeline sorted desc by `createdAt`. Empty array renders empty-state microcopy.

**Plan detail:** On-demand — `05-vendor-page-plan.md`.

---

### Subsystem 6 — Propose Terms workflow (P1)

**Priority:** P1 — state-change flow.
**Spec reference:** Canonical spec §20.

**Files:**
- Create: `components/vendor/renewals/propose-terms-dialog.tsx`
- Modify: `lib/actions/renewals.ts` — add `submitRenewalProposal` + `reviewRenewalProposal`
- Modify: `components/facility/contracts/proposal-review-list.tsx` (existing) — render `proposalType === 'renewal'` rows with renewal-specific preview

**Dialog fields (canonical spec §20):**
- Proposed rebate tiers (repeatable group: threshold + rate)
- Proposed pricing changes (repeatable: itemNumber + oldPrice + newPrice)
- Proposed term length (months)
- Proposed payment terms (string)
- Proposed minimum commitment (dollars)
- Notes textarea

**Persistence:**
```ts
await prisma.contractChangeProposal.create({
  data: {
    contractId,
    proposalType: "renewal",
    status: "proposed",
    payload: { /* typed renewal payload */ },
    submittedById: session.user.id,
    notes: input.notes,
  },
})
```

**Status transitions (uses extended enum from §3.1):**
- Vendor submits → `proposed`
- Facility approves → `approved` → `applied` (terms written into new contract version)
- Facility rejects → `rejected`
- Facility counter-proposes with notes → `countered` → vendor revises → `proposed` again

**Acceptance:**
- Vendor can submit; row appears in facility's review list with renewal-specific preview.
- Facility can approve/reject/counter; status flows correctly.
- On `approved → applied`, the new tier/pricing data is written to the contract (new `ContractTerm` row, new `ContractPricing` updates). Detailed diff-apply logic lives in the per-subsystem plan.

**Plan detail:** On-demand — `06-propose-terms-plan.md`.

---

### Subsystem 7 — Alert settings dialog (P1, settings-only)

**Priority:** P1.
**Spec reference:** Canonical spec §16.

**Files:**
- Create: `components/facility/renewals/alert-settings-dialog.tsx`
- Add to `lib/actions/renewals.ts`: `getRenewalAlertSettings()` / `saveRenewalAlertSettings(input)`

**Dialog shape (canonical spec §16):**
- Email toggle: 30-day (red), 60-day (yellow), 90-day (green), weekly digest
- Email recipients input (comma-separated)
- Slack enable toggle + channel input
- **Banner at top of dialog:** *"Alert delivery is in development. These settings will apply once the scheduled job goes live."*

**Per-contract preview inside detail dialog (from subsystem 4):**

Each active contract's detail dialog shows three dots for 90/60/30-day alerts, green when that alert is configured to fire for that contract's current day-until-expiration. Logic:
```ts
alertsConfigured = {
  email90Days: settings.email90Days,
  email60Days: settings.email60Days && daysUntilExpiration <= 90,
  email30Days: settings.email30Days && daysUntilExpiration <= 60,
}
```

**Acceptance:**
- Settings persist across reloads.
- Per-user — two different users see their own settings.
- Banner is visible and non-dismissable.

**Plan detail:** On-demand — `07-alert-settings-plan.md`.

---

### Subsystem 8 — Exports (P2)

**Priority:** P2.
**Spec reference:** Canonical spec §§17, 18.

**Files:**
- Create: `lib/renewals/exports.ts`
- Wire into: `renewals-header.tsx` (facility) and `vendor-renewals-client.tsx` (vendor)

**Exports:**

```ts
// ICS calendar — 3 events per contract per canonical spec §17
export function buildICSContent(renewals: RenewalLike[]): string

// Text summary — canonical spec §18
export function buildTextSummary(renewal: RenewalLike): string
```

**Acceptance:**
- ICS parses in Google Calendar / macOS Calendar / Outlook.
- 3 events per contract: expiration (main), 90-day reminder, 30-day alert. UIDs unique.
- Text summary downloads as `renewal-summary-{contractId}-YYYY-MM-DD.txt`.
- Empty-renewals list produces an empty-but-valid ICS (no crash).

**Plan detail:** On-demand — `08-exports-plan.md`.

---

### Subsystem 9 — UI polish + split integration (P1 for split, P2 for rest)

**Priority:** P1 on the facility-client split integration. P2 for the remaining items.
**Spec reference:** Canonical spec §§10, 11, 16.

**What lands:**

1. **Verify facility client split** — final `renewals-client.tsx` is ≤200 lines and delegates to the header/banner/filters/table/dialog children from subsystem 4.
2. **Uniform card heights** — integration check at `sm`, `md`, `lg`, `xl`. No jagged KPI grid.
3. **Hydration-safe relative-time rendering** — `formatDistanceToNow(createdAt, { addSuffix: true })` guarded by `mounted` flag so SSR/client agree.
4. **Responsive breakpoints audit:** table collapses to card list on `sm`, timeline stacks vertically, dialog fits on `md`.
5. **Empty states:** informative microcopy in every spot where synthesis used to be ("Insufficient history — first-year contract or no closed periods yet.").
6. **A11y pass:** timeline markers have `role="button"`, aria-labels mention contract + days, dialog has focus trap, keyboard navigation through tabs works.

**Not in this subsystem:**
- PortalShell / top-nav polish — separate cross-cutting spec.
- Cron-based alert delivery — separate follow-up.

**Plan detail:** On-demand — `09-ui-polish-plan.md`.

---

## 5. Execution model

**Sequencing:**

```
Subsystem 0 (data layer + schema)
  ↓
Subsystem 1 (engine)
  ↓                                         ↘
Subsystem 2 (timeline)     Subsystem 3 (stats)
  ↓               ↘                ↙              ↘
Subsystem 4 (facility page)   Subsystem 5 (vendor page)
  ↓                                  ↓
Subsystem 7 (alerts)           Subsystem 6 (propose terms)
  ↓                                  ↓
           Subsystem 8 (exports)
                   ↓
           Subsystem 9 (polish)
```

Subsystems 2-3 parallelize after 1 lands. Subsystems 4-5 and 6-7 parallelize after their shared deps. Subsystem 9 is last.

**Per-subsystem cadence:**

1. Generate per-subsystem plan on demand via superpowers:writing-plans.
2. Continue in the current worktree (`contracts-rewrite-00-schema` — it's the active branch and rebases cleanly on main).
3. Execute via superpowers:subagent-driven-development.
4. Verify per the subsystem's "Acceptance" section.
5. Code review via superpowers:code-reviewer before merge.
6. Merge to `main` (FF when possible, per user directive).

**Global verification (after every subsystem):**

```bash
bunx tsc --noEmit          # 0 errors
bun run lint               # 0 new errors
bun run test               # all pass
bun run build              # all routes emit
bun run db:seed            # 10/10 qa-sanity
```

Plus a manual smoke at `/dashboard/renewals` and `/vendor/renewals` after each merge (demo-facility + demo-vendor sessions) to confirm no layout regression.

---

## 6. Acceptance (whole rewrite)

- All 9 subsystems merged to main.
- Facility (`/dashboard/renewals`) and vendor (`/vendor/renewals`) both match the canonical functional spec's data model, calculations, filters, dialog structure, and exports.
- No synthesized performance history anywhere — every number shown is from real `ContractPeriod` / `RebateAccrual` / `CaseSupply` rows, or "—" / empty state.
- No `sampleContracts` fallback, no random `Math.floor(Math.random() * 15)` compliance values, no 0.85/0.72 multipliers.
- `bunx tsc --noEmit` → 0 errors.
- `bun run test` → all pass (new `lib/renewals/__tests__/engine.test.ts` + existing contracts engine tests).
- `bun run build` → compiled successfully.
- `bun run db:seed` → 10/10 QA sanity.
- Facility-client file is ≤200 lines; the 1007-line monolith is gone.
- KPI cards render uniform heights at every breakpoint (same pattern as dashboard rewrite).
- Vendor can submit a renewal proposal; facility can review/approve/reject/counter via existing `ContractChangeProposal` surface.
- Alert settings persist per-user; banner signals delivery is deferred.
- ICS export parses in Google Calendar.

---

## 7. Known risks

1. **Enum migration on a non-empty DB.** Adding `countered` to `ProposalStatus` and `renewal` to `ProposalType` requires a migration. Existing rows unaffected. Mitigation: additive-only changes, applied via `bun run db:push` with zero data-loss warnings.
2. **Facility client split regression risk.** 1007 lines of entangled state. Splitting carries a chance of breaking a filter interaction or a dialog open/close handler. Mitigation: subsystem 4 does the split in a single commit with file-level diffs, and the acceptance check is "every filter + tab + dialog still behaves as before." No other subsystem commits changes while the split is in flight.
3. **Empty-state proliferation.** Dropping synthesis means many surfaces may render empty for fresh tenants (no closed periods, no notes, no proposals). Design risk: the pages feel barren. Mitigation: every empty state has informative microcopy explaining *why* it's empty ("First-year contract — no closed periods yet") rather than a blank space.
4. **Propose-terms diff-apply complexity.** When a facility approves a renewal proposal, we need to atomically update the contract's terms/tiers/pricing. Prisma transaction required. Mitigation: subsystem 6's plan enumerates the transaction boundaries explicitly; no auto-apply without review.
5. **Alert settings without delivery creates a "ghost feature" impression.** Users may configure alerts expecting emails. Mitigation: prominent non-dismissable banner in the dialog; tooltip on the save button; docs updated.

---

## 8. How to iterate

1. Pick a subsystem from the priority-ordered list (start with 0).
2. Ask me to generate its detailed per-subsystem plan via superpowers:writing-plans.
3. Execute per plan.
4. Verify, review, merge, proceed to next subsystem.

Per-subsystem plans land in `docs/superpowers/plans/` as they're generated. This design spec stays as the anchor doc.
