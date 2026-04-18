# Facility Dashboard Rewrite — Design Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the subsystems below. Each subsystem gets its own per-subsystem TDD plan generated on demand. Steps in those plans use checkbox (`- [ ]`) syntax for tracking.

**Date:** 2026-04-18
**Branch:** `facility-dashboard-rewrite` (create via worktree before execution)
**Status:** Design approved by Vick (structure), UI inconsistencies flagged from live screenshots
**Related specs:**
- Completed: `2026-04-18-contracts-rewrite.md` (reuses rebate engine, compliance engine, tier progress engine)
- Needed next (out of scope here): shell polish spec — `PortalShell` header/nav sizing, branding block height, notification-badge weighting. These affect every page, not just dashboard.

**Goal:** Bring `/dashboard` (facility dashboard) to full functional and visual parity with the canonical spec the user provided, translating prototype storage patterns (IndexedDB, `window` event bus, `localStorage` fallbacks, `MM/DD/YY` date parsing) to tydei's Prisma + TanStack Query stack.

**Architecture:** Gap-closure on an existing surface. The current dashboard has a working foundation — 8 components (`dashboard-client.tsx`, `-filters.tsx`, `-stats.tsx`, three chart components, `recent-contracts.tsx`, `recent-alerts.tsx`), 475 lines of server actions, TanStack Query hooks, date range state wired through. Each subsystem closes a specific gap: data-shape audit, KPI refinement, chart polish, multi-dimension filters, table/feed polish, and UI consistency. Subsystems 1-7 are parallelizable after subsystem 0 lands.

**Tech Stack (unchanged):** Next.js 16, Prisma 7, Better Auth (+ org + Stripe), Tailwind v4, shadcn/ui, TanStack Query, react-hook-form + Zod, recharts, Bun. Claude via `@ai-sdk/anthropic` is wired but **not used** by this rewrite — AI features on dashboard deferred until we decide the global AI strategy.

---

## 1. Scope

### In scope

The 8 subsystems below. Surface is `/dashboard` (facility portal). The components that get touched:

```
app/dashboard/
  page.tsx                                 (light — checks auth, renders client)
  loading.tsx                              (Suspense fallback)

components/facility/dashboard/
  dashboard-client.tsx                     (orchestrator)
  dashboard-filters.tsx                    (date range + 3 new dims)
  dashboard-stats.tsx                      (4 KPI cards — card-height fix lives here)
  total-spend-chart.tsx                    (monthly line chart)
  spend-by-vendor-chart.tsx                (top 8 bar)
  spend-by-category-chart.tsx              (pie — pricing-file join)
  recent-contracts.tsx                     (top 5 table)
  recent-alerts.tsx                        (alert feed)

hooks/use-dashboard.ts                     (TanStack Query hooks)
lib/actions/dashboard.ts                   (server actions — 475 lines)
```

### Out of scope

- **AI features.** Explicitly deferred by user decision. The `lib/ai/` module stays wired in place; nothing on dashboard consumes it in this rewrite.
- **Real-time / SSE live updates.** TanStack Query invalidation on server-action mutations is sufficient.
- **Cross-facility aggregation.** Single-facility scope. Health-system rollup is a separate initiative.
- **COG date-string parser (`MM/DD/YY`, 2-digit year handling).** Tydei's `COGRecord.transactionDate` is a typed `DateTime` — parser unnecessary.
- **PortalShell / top-nav polish.** The screenshot issue with the oversized TYDEi branding block + search-bar height + notification-badge styling affects every page. Separate spec — do not touch shell files from this rewrite's PRs.
- **New Prisma columns or models.** All fields the spec requires should already exist. Any genuine gap becomes its own flagged item.

### Non-goals (preserved)

- No stack swaps. No data-model regression. No debug-route ports.
- No unilateral refactor of unrelated files touched incidentally.

---

## 2. Translation notes — prototype spec → tydei

The canonical spec the user provided was written for the v0 prototype (client-side IndexedDB, window events, localStorage, 2-digit year date parsing). Translate these before copying logic:

| Prototype pattern | Tydei equivalent |
|---|---|
| IndexedDB stores (`contract-data-store`, `cog-data-store`, `pricing-items`) | Prisma tables; loaded server-side in `lib/actions/dashboard.ts` |
| `window.addEventListener('cog-data-updated', ...)` | `queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all(...) })` from the mutation's `onSuccess` |
| `window.addEventListener('contract-data-updated', ...)` | Same — `queryClient.invalidateQueries` on contract CRUD success |
| `localStorage.getItem('tydei_facilities')` with system-default fallback | `prisma.facility.findMany({ where: { status: 'active' } })` via `getFacilities()` server action — seeded |
| `parseCogDate('6/15/24')` custom MM/DD/YY parser with 50/49 century split | Drop entirely. `COGRecord.transactionDate` is a typed `DateTime`. Pass `Date` objects directly into Prisma `where` clauses. |
| `initializeContracts()` runtime seed on mount | Drop. Tydei seeds via `bun run db:seed`. |
| `formatDistanceToNow` for alert age | Same — `date-fns` already a dep. Use as-is. |
| "Demo data fallback" when the IndexedDB store is empty | Keep as a *rendering-level* fallback when a server action legitimately returns an empty array (fresh tenant, pre-seed state). Do NOT use this to mask bugs where data exists but doesn't render. |
| Hydration-safe `[mounted, setMounted]` flag for "All Time" label | Keep — the current `WIDE_RANGE` sentinel in `dashboard-client.tsx:24-28` is a workaround. Replace with `mounted` gate. |
| Currency formatting helper `formatCurrencyShort` | Use existing `formatCurrencyShort` from `lib/formatting.ts` if present; add if missing. |

---

## 3. Subsystems — priority-ordered

Priority rubric (different from contracts — dashboard is read-only, so no silent-wrong-number P0 bugs):
- **P0** = blocker for other subsystems OR visibly broken (e.g., inconsistent card heights today)
- **P1** = missing feature vs the canonical spec
- **P2** = polish / edge cases

### Subsystem 0 — Data layer audit (P0)

**Priority:** P0 — blocks 1-7.
**Why:** Before adding UI, confirm every server action returns the exact shape the new UI needs. The current actions are close but may have drift.

**Files:**
- Modify (audit only, fix where needed): `lib/actions/dashboard.ts`
- Modify (types): `hooks/use-dashboard.ts` — ensure `DateRange` is consistent with `DateRange` from canonical spec

**What the audit must verify:**

1. `getDashboardStats` returns these fields, all present and non-null:
   - `activeCount` (int)
   - `totalContractValue` (number — dollars)
   - `recentContractsAdded` (int, last 30 days)
   - `totalSpendYTD` (number — all COG sum in window)
   - `totalContractSpend` (number — COG matched to contract pricing items)
   - `spendProgress` (0-100 percent)
   - `rebatesEarned` (number — uses `computeRebateFromPrismaTiers` with correct method)
   - `rebatesCollected` (number)
   - `rebateCollectionRate` (0-100)
   - `pendingAlerts` (int — expiring ≤90d OR commitment progress < 80%)
2. `getMonthlySpend` returns last 12 months, grouped `YYYY-MM`, with zero-fill for missing months (timeline continuity).
3. `getSpendByVendor` returns top 8.
4. `getSpendByCategory` returns top 8 using the pricing-file join described in canonical spec §5. Vendor-item-number is primary match; vendor-name (first word) is fallback.
5. `getRecentContracts` returns 5 most recent by `effectiveDate`, enriched with `vendor.name`.
6. `getRecentAlerts` returns alerts with all fields the UI needs: `id`, `type`, `title`, `message`, `status`, `createdAt`, `metadata`.

**Acceptance:**
- Each action has a Vitest test or a hit-the-action smoke invocation asserting the returned shape.
- `bunx tsc --noEmit` → 0 errors.
- Any genuine schema gap is documented here and added to this subsystem's plan, not snuck into a later subsystem.

**Plan detail:** On-demand — `2026-04-18-facility-dashboard-rewrite-00-data-audit-plan.md`.

---

### Subsystem 1 — KPI metric polish (P1)

**Priority:** P1 + contains a P0 UI-consistency fix (card heights).
**Spec reference:** Canonical spec §4.

**Files:**
- Modify: `components/facility/dashboard/dashboard-stats.tsx` — today 83 lines. Will need refactor.
- Create: `components/facility/dashboard/metric-card.tsx` — single reusable component with a strict content slot contract.

**Approach:**

Create a `MetricCard` component with a strict, uniform slot structure:

```tsx
interface MetricCardProps {
  icon: LucideIcon
  title: string
  value: string                // primary big number, e.g. "$904K" or "7"
  changeValue: string           // e.g. "+5", "99.7%", "71.9%"
  changeType: "positive" | "negative" | "neutral"
  secondaryBadge?: {            // optional — every card reserves the space
    label: string               // e.g. "On Contract", "Collected"
    value: string               // e.g. "$901K"
  }
  description: string           // bottom caption
}
```

Every card renders the same DOM structure even when `secondaryBadge` is absent — we reserve the vertical space with an invisible placeholder so grids align. This is the fix for the jagged heights in the screenshot.

Four cards, unified to the canonical-spec wording:

| Card | title | value | changeValue | secondaryBadge | description |
|---|---|---|---|---|---|
| 1 | "Active Contracts" | `activeCount` | `+{recentContractsAdded}` | `{label: "Total Value", value: formatCurrencyShort(totalContractValue)}` | "in active portfolio" |
| 2 | "Contract Spend" | `formatCurrencyShort(totalContractSpend)` | `{spendProgress.toFixed(1)}%` | `{label: "Total YTD", value: formatCurrencyShort(totalSpendYTD)}` | "of contract value used" |
| 3 | "Rebates Earned" | `formatCurrencyShort(rebatesEarned)` | `{rebateCollectionRate.toFixed(1)}%` | `{label: "Collected", value: formatCurrencyShort(rebatesCollected)}` | "collection rate" |
| 4 | "Pending Alerts" | `pendingAlerts.toString()` | — | `{label: "Action", value: pendingAlerts === 0 ? "None" : "Needed"}` | "review in Alerts" |

Card 4 now has a secondaryBadge too (previously it was short) — this is the heights fix. The badge is real information, not filler: it tells the user whether there's work to do.

**Acceptance:**
- All 4 cards render at identical heights at every breakpoint (verify via Playwright visual snapshot or manual pixel check).
- No jagged grid.
- Secondary-label wording is consistent ("Total Value", "Total YTD", "Collected", "Action") — the old mix ("from last month", "YTD spend", "earned from contracts", "action needed") is gone.
- Change arrows (`↗ +5`, `↘ 7`, etc.) use the same color semantics across all 4 cards.

**Plan detail:** On-demand — `01-kpi-polish-plan.md`.

---

### Subsystem 2 — Monthly spend trend chart (P2)

**Priority:** P2 — likely close to spec today.
**Spec reference:** Canonical spec §5 chart 1.

**Files:**
- Modify: `components/facility/dashboard/total-spend-chart.tsx` (77 lines today)
- Verify: `lib/actions/dashboard.ts::getMonthlySpend`

**What to verify/fix:**
- Rolling 12-month window, not calendar year.
- Zero-fill missing months so the line is continuous.
- Uses the chart color palette from canonical spec §5 (emerald-first for line).
- Axis labels, tooltips use `formatCurrencyShort`.
- Demo-data fallback when `data.length === 0`.

**Acceptance:** Chart renders continuously for any seeded contract with non-zero spend in the last 12 months; empty-state fallback renders with a "Demo Data" badge.

**Plan detail:** On-demand — `02-monthly-spend-plan.md`.

---

### Subsystem 3 — Top vendors bar chart (P2)

**Priority:** P2.
**Spec reference:** Canonical spec §5 chart 2.

**Files:**
- Modify: `components/facility/dashboard/spend-by-vendor-chart.tsx` (81 lines)
- Verify: `lib/actions/dashboard.ts::getSpendByVendor`

**What to verify/fix:**
- Top 8 vendors (not top N for other N).
- Horizontal bar (not vertical).
- Long vendor names truncate with tooltip showing full name.
- Matches chart color palette.

**Plan detail:** On-demand — `03-top-vendors-plan.md`.

---

### Subsystem 4 — Category pie chart (P1)

**Priority:** P1 — the pricing-file join is the non-trivial bit.
**Spec reference:** Canonical spec §5 chart 3.

**Files:**
- Modify: `components/facility/dashboard/spend-by-category-chart.tsx` (113 lines)
- Modify: `lib/actions/dashboard.ts::getSpendByCategory` — this is where the join lives

**What to implement:**

1. **Primary match:** for each `COGRecord`, look up a matching `ContractPricing` row by `vendorItemNo` (case-insensitive trim). If matched, use that pricing row's category (via `ContractPricing.category` if present, else `Contract.productCategory.name`).
2. **Fallback match by vendor name:** if the item number doesn't match, try matching the COG record's vendor name (first word, case-insensitive) against vendors that have any categorized pricing item; pick that vendor's first-seen category.
3. Aggregate spend by category, sort descending, take top 8.
4. "Other" bucket for anything outside the top 8 (optional — per canonical spec, just trim to 8).

**Acceptance:**
- Seeded contract with categorized pricing + matching COG records produces non-empty category pie.
- A COG record with no item-number match but a matching vendor-name falls into the vendor's category.
- No uncategorized fallback bucket swallows the whole pie.

**Plan detail:** On-demand — `04-category-pie-plan.md`.

---

### Subsystem 5 — Multi-dimension filters (P1)

**Priority:** P1 — today the filters panel shows dummy "All Facilities / All Vendors / All Types" dropdowns per the screenshot, suggesting the state exists but doesn't filter.
**Spec reference:** Canonical spec §6.

**Files:**
- Modify: `components/facility/dashboard/dashboard-filters.tsx` (224 lines today — likely has the UI shells)
- Modify: `components/facility/dashboard/dashboard-client.tsx` — lift filter state up, pass to all data hooks
- Modify: `hooks/use-dashboard.ts` — accept filter params
- Modify: `lib/actions/dashboard.ts` — all aggregation functions accept `{ facilityId?, vendorId?, contractType? }`

**Filter dimensions beyond date range:**

1. **Facility** — single-select dropdown (spec allows multi, but single is sufficient for MVP; match the dropdown's current single-select behavior). Options loaded from `getFacilities()` server action. Defaults to "All Facilities".
2. **Vendor** — single-select dropdown. Options loaded from `getVendors()`. Defaults to "All Vendors".
3. **Contract type** — single-select. Options: all, usage, capital, service, tie_in, grouped, pricing_only.
4. **Clear filters** — resets all three non-date filters; leaves date range alone (per canonical spec §6).
5. **Active filter badge** — counts non-default filters and shows a badge on the filter card header.

**Where filtering applies:**

- `getDashboardStats` — scope `activeContracts` by `vendorId`/`contractType`; scope COG by `vendorId`.
- `getMonthlySpend`, `getSpendByVendor`, `getSpendByCategory` — same vendor scope; contractType filters which contracts' pricing items count as "on contract" for the category join.
- `getRecentContracts` — scope by `vendorId` + `contractType`.
- `getRecentAlerts` — unscoped by vendor/contractType (alerts are cross-cutting), but `facilityId` still applies.

**Acceptance:**
- Picking a vendor narrows every card and every chart.
- Clear filters resets the three dims without resetting date range.
- Active filter badge count matches the number of non-default dims.

**Plan detail:** On-demand — `05-filters-plan.md`.

---

### Subsystem 6 — Recent contracts table polish (P2)

**Priority:** P2.
**Spec reference:** Canonical spec §7.

**Files:**
- Modify: `components/facility/dashboard/recent-contracts.tsx` (114 lines today)

**What to verify/fix:**
- 5 most recent by `effectiveDate` descending.
- Safe date formatting for `expirationDate` (handles invalid/missing strings).
- Status badge colors: green for active, red for expired, yellow for expiring, gray for draft/pending.
- Contract-type badge uses the same type labels as the contracts list page.
- Empty state: "No contracts available" + CTA linking to `/dashboard/contracts/new`.
- "View all" button links to `/dashboard/contracts`.

**Plan detail:** On-demand — `06-recent-contracts-plan.md`.

---

### Subsystem 7 — Recent alerts feed polish (P1)

**Priority:** P1 — user-visible and likely needs the most work per the canonical spec.
**Spec reference:** Canonical spec §8.

**Files:**
- Modify: `components/facility/dashboard/recent-alerts.tsx` (98 lines)

**What to implement/verify:**

1. **Icon-per-type** with semantic color:
   - `off_contract` → `FileX`, red
   - `expiring_contract` → `Clock`, yellow
   - `tier_threshold` → `DollarSign`, blue
   - `rebate_due` → `DollarSign`, green
   - `payment_due` → `DollarSign`, orange
2. **New-alert count badge** in the card header, hidden when zero.
3. **Relative time** via `formatDistanceToNow(alert.createdAt, { addSuffix: true })`.
4. **Empty state:** `CheckCircle` icon + "No alerts" + "You're all caught up!"
5. **Each alert row links** to `/dashboard/alerts/{id}`.
6. **"View all"** button links to `/dashboard/alerts`.
7. **Scroll list** (not fixed 5) with `max-h-` constraint so long lists don't push the page.

**Acceptance:**
- All 5 alert types render with the correct icon + color.
- New-alert badge count matches `alerts.filter(a => a.status === 'new').length`.
- Relative time updates on re-render (not hardcoded timestamps).
- Empty state renders when `alerts.length === 0`.

**Plan detail:** On-demand — `07-recent-alerts-plan.md`.

---

### Subsystem 8 — UI consistency + polish (P0 for heights, P1 for rest)

**Priority:** P0 on the card-heights fix (user-visible in screenshot), P1 for the remaining items.
**Spec reference:** Canonical spec §§10, 15, 16.

**Files:**
- Modify: `components/facility/dashboard/dashboard-client.tsx` — replace `WIDE_RANGE` sentinel with `mounted`-gated "All Time" display
- Modify: `components/facility/dashboard/dashboard-stats.tsx` — already handled in subsystem 1, but verify at integration
- Modify: any chart card whose heights drift

**What lands:**

1. **Equal KPI card heights.** Handled by subsystem 1's `MetricCard` uniform slot structure. Verify at integration here. Acceptance: grid has zero visual jag at `sm`, `md`, `lg`, `xl` breakpoints.
2. **Hydration-safe "All Time" label.** Replace the `WIDE_RANGE` sentinel with a `mounted` flag:
   ```tsx
   const [mounted, setMounted] = useState(false)
   useEffect(() => { setMounted(true) }, [])
   const dateRangeText = mounted && pickedRange?.from && pickedRange?.to
     ? `${format(pickedRange.from, 'MMM d, yyyy')} - ${format(pickedRange.to, 'MMM d, yyyy')}`
     : 'All Time'
   ```
3. **Suspense boundaries per section** so one slow query doesn't hold up the rest.
4. **Responsive breakpoints audit.** At `sm`, metrics stack 2×2; at `lg`, 4×1. Charts stack below `lg`. Recent sections stack below `lg`. Matches canonical spec §15.
5. **Accessibility pass.** Semantic headings, chart tooltips have descriptive labels, tables use `<TableHead>`, badges pass contrast in dark mode. Canonical spec §16.

**Not in this subsystem (separate spec):**
- PortalShell / top-nav sizing (oversized TYDEi branding block + search bar + notification badge from screenshot 2)
- Any cross-portal visual consistency concerns

**Plan detail:** On-demand — `08-ui-polish-plan.md`.

---

## 4. Execution model

**Sequencing:**

```
Subsystem 0 (data-layer audit)
  ↓
Subsystem 1 (KPI polish, card heights)
  ↓                 ↘
Subsystem 2         Subsystem 5 (filters)
Subsystem 3         Subsystem 6 (recent contracts)
Subsystem 4         Subsystem 7 (recent alerts)
  ↓                 ↙
      Subsystem 8 (UI polish integration)
```

Subsystems 2-4 and 5-7 are two parallel tracks. Subsystem 8 merges the integration review.

**Per-subsystem cadence (applies to every one):**

1. Generate per-subsystem plan on demand via superpowers:writing-plans.
2. Create worktree via superpowers:using-git-worktrees (or continue in the current one).
3. Execute via superpowers:subagent-driven-development (one fresh subagent per task, review between).
4. Run verification per the subsystem's "Acceptance" section.
5. Code review via superpowers:code-reviewer before merge.
6. Merge to `main` (per user directive: commit to main, not PR-based).

**Global verification (run after every subsystem merges):**

```bash
bunx tsc --noEmit                   # 0 errors
bun run lint                        # 0 new errors
bun run test                        # all pass
bun run build                       # all routes emit
bun run db:seed                     # 10/10 QA sanity
docker compose up -d && bun run dev # smoke test /dashboard
```

Plus a manual visual check at `/dashboard` on `sm`, `md`, `lg`, `xl` viewports after every merge to confirm no layout regression.

---

## 5. Acceptance (whole rewrite)

- All 8 subsystems merged to main.
- `/dashboard` matches the canonical functional spec's KPI calculations, chart outputs, filter behavior, and layout.
- **Card-heights fix verified** in screenshot — all 4 KPI cards render at uniform height.
- **Hydration-safe "All Time" label** — no client/server mismatch warnings.
- `bunx tsc --noEmit` → 0 errors.
- `bun run test` → all pass (including any new dashboard-specific tests).
- `bun run build` → compiled successfully.
- `bun run db:seed` + qa-sanity → 10/10 passing.
- Manual smoke: demo-facility session, `/dashboard` renders with real data, filters work, charts render, alerts list renders, no console errors.

---

## 6. Known risks

1. **Prototype storage references leaking into tydei code.** The canonical spec's code examples call `getAllCogRecordsAsync()`, `getActiveContracts()`, `getContractSpendFromCOGData()` — client-side helpers that don't exist in tydei. Every subsystem plan must re-derive the logic server-side. Mitigation: the Translation notes table in §2 is authoritative; subsystem plans cite it.
2. **Rebate calculation drift vs contracts-rewrite engines.** Dashboard aggregates rebates across all contracts; contracts-rewrite engines (`computeRebateFromPrismaTiers`) are per-contract. Must call the engine per contract and sum, not write a new parallel path. Mitigation: subsystem 0 audit explicitly verifies `getDashboardStats` uses `computeRebateFromPrismaTiers`.
3. **Filter cross-product state bugs.** Combining date range + facility + vendor + type across 5 data hooks is 4-dimensional state. Easy to forget one hook. Mitigation: subsystem 5 plan enumerates each hook and its filter signature explicitly.
4. **Card-height fix regresses at smaller viewports.** `MetricCard` slot structure must work at `sm` (2×2 grid) as well as `lg` (4×1). Mitigation: subsystem 8 acceptance explicitly requires breakpoint verification.

---

## 7. Out of scope (explicitly deferred)

- **AI features on dashboard.** No natural-language queries, no AI-generated insights, no forecast cards. Revisit after the full-app rewrite per user's 2026-04-18 direction.
- **Shell polish.** PortalShell oversized branding block, search bar height, notification badge styling. Separate spec — will affect every page, needs its own scope doc.
- **Real-time updates.** No SSE, no websockets. TanStack Query invalidation on server-action success is the pattern.
- **Health-system / multi-facility rollup.** Single-facility scope.
- **Playwright visual-diff CI gates.** Follow-up after subsystems 0-8 stabilize.

---

## 8. How to iterate

1. Pick a subsystem from the priority-ordered list (start with 0; 1 is the highest-visible P0 fix).
2. Ask me to generate its detailed per-subsystem plan via superpowers:writing-plans.
3. Execute per plan.
4. Verify, review, merge, proceed to next subsystem.

Per-subsystem plans land in `docs/superpowers/plans/` as they're generated. This design spec stays as the anchor doc.
