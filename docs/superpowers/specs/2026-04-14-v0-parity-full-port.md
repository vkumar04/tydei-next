# v0 Parity — Full 50-Route Port

**Date:** 2026-04-14
**Branch:** `v0-parity-full`
**Commit:** `d3e20db`
**Status:** Landed — all routes return 200 under demo sessions, build clean, typecheck clean.

## Context

Tydei-next is the production build of a healthcare contract-management SaaS. A v0.dev prototype at `~/Downloads/b_kkwtOYstuRr/` defined the canonical look, feel, and feature set. This spec documents the full port of the prototype's 50+ routes into tydei, keeping tydei's stack (Prisma 7, Better Auth, Stripe, S3, Gemini) untouched.

This is the second iteration of the port. The first (`v0-parity` → merged) closed foundation, landing, auth, and most facility pages. This one closes the rest: remaining facility polish, all vendor routes, all admin routes, missing shadcn primitives, and the AI prompt layer.

## Goal

Every v0 page exists in tydei with matching visual design (tokens, typography, layout, copy, icons, charts, empty states) and matching functional behavior, backed by tydei's Prisma + server-action data layer.

## Non-goals (preserved)

- No stack swaps. Next.js 16, Prisma 7, Better Auth (+ Stripe + org plugin), Tailwind v4, shadcn/ui, TanStack Query, react-hook-form + Zod, Bun.
- No infrastructure removal. Stripe plugin, Better Auth organization/invitations, S3 presigned uploads, Upstash rate-limiting, audit log, webhooks all intact.
- No AI model swap. Gemini via `@ai-sdk/google`. `@ai-sdk/gateway` is explicitly NOT introduced; v0's prompts and tool schemas get rewired to Gemini.
- No data model regression. Tydei's 44 Prisma models stay; this port is additive-only.
- No debug route ports (`/clear-cog`, `/force-clear` excluded).

## What landed

### Foundation

**22 missing shadcn primitives** ported from v0 into `components/ui/`:
`aspect-ratio`, `button-group`, `carousel`, `chart`, `context-menu`, `drawer`, `empty`, `field`, `form`, `hover-card`, `input-group`, `input-otp`, `item`, `kbd`, `menubar`, `navigation-menu`, `pagination`, `radio-group`, `resizable`, `spinner`, `toggle`, `toggle-group`.

All rewritten to tydei's unified `radix-ui` import style and Icon-suffixed lucide imports. Deps added: `embla-carousel-react`, `vaul`, `react-resizable-panels`, `input-otp`.

Design tokens (oklch, Inter font, chart palette, glass-card, gradient-text, glow-primary utilities) were already landed in the prior PR via `app/globals.css`.

**PortalShell** (`components/shared/shells/portal-shell.tsx`) was already structurally aligned with v0's `dashboard-shell.tsx` from prior work — one unified shell with variant config covers facility/vendor/admin. No changes this pass.

### Facility portal — 16 routes

| Route | Source (tydei) | Data |
|---|---|---|
| `/dashboard` | `components/facility/dashboard/dashboard-client.tsx` | `hooks/use-dashboard.ts` → `lib/actions/dashboard.ts` |
| `/dashboard/contracts` | `components/contracts/contracts-list-client.tsx` | `hooks/use-contracts.ts` → `lib/actions/contracts.ts` |
| `/dashboard/contracts/new` | `components/facility/contracts/contract-create-client.tsx` | `hooks/use-contract-form.ts` |
| `/dashboard/contracts/[id]` | `components/contracts/contract-detail-client.tsx` | `lib/actions/contracts.ts` |
| `/dashboard/contracts/[id]/edit` | `components/facility/contracts/contract-edit-client.tsx` | `lib/actions/contracts.ts`, `contract-terms.ts` |
| `/dashboard/contracts/[id]/terms` | `components/facility/contracts/contract-terms-page-client.tsx` | `lib/actions/contract-terms.ts` |
| `/dashboard/contracts/[id]/score` | `components/facility/contracts/contract-score-client.tsx` | `lib/ai/tools.ts` → Gemini |
| `/dashboard/cog-data` | `components/facility/cog/cog-data-client.tsx` | `hooks/use-cog.ts`, `hooks/use-cog-import.ts` |
| `/dashboard/purchase-orders` | `components/facility/purchase-orders/po-list.tsx` | `hooks/use-purchase-orders.ts` |
| `/dashboard/invoice-validation` | `components/facility/invoices/invoice-validation-client.tsx` | `hooks/use-invoices.ts` |
| `/dashboard/case-costing` | `components/facility/case-costing/*` | `hooks/use-case-costing.ts` |
| `/dashboard/case-costing/compare` | `app/dashboard/case-costing/compare/compare-client.tsx` | `hooks/use-case-costing.ts` (rewritten to 620 lines, v0 layout) |
| `/dashboard/case-costing/reports` | `app/dashboard/case-costing/reports/reports-client.tsx` | same + `lib/actions/reports.ts` |
| `/dashboard/analysis` | `components/facility/analysis/*` | `hooks/use-analysis.ts`, `hooks/use-prospective.ts` |
| `/dashboard/alerts`, `/alerts/[id]` | `components/shared/alerts/*` | `hooks/use-alerts.ts` |
| `/dashboard/reports`, `/reports/price-discrepancy` | `components/facility/reports/*` | `lib/actions/reports.ts`, `report-scheduling.ts` |
| `/dashboard/renewals` (aliased to `/contract-renewals`) | `components/facility/renewals/renewals-client.tsx` | `hooks/use-renewals.ts` |
| `/dashboard/rebate-optimizer` | `components/facility/rebate-optimizer/optimizer-client.tsx` | `hooks/use-rebate-optimizer.ts` |
| `/dashboard/ai-agent` | `components/facility/ai-agent-client.tsx` | `app/api/ai/chat/route.ts` + `lib/ai/tools.ts` + `lib/ai/prompts.ts` |
| `/dashboard/settings` | `components/facility/settings/settings-client.tsx` | `hooks/use-settings.ts`, `use-ai-credits.ts`, `use-connections.ts` |

**Changes this pass:**
- Dashboard home default date range flipped to "All Time" + icon suffix rename.
- Contracts list: Rebate Earned column added, search/facility filter wired, detail-header button order (AI Score / Edit / Add Amendment / Export) matched to v0.
- `getContracts` server action now aggregates `rebateEarned`/`rebateCollected` from the existing `rebates` relation.
- COG data: Clear All Data button + AlertDialog, Data Date Range card, header button order. Added `useClearAllCOGRecords` mutation + `clearAllCOGRecords` action. `getCOGStats` returns `minPODate`/`maxPODate`.
- Purchase orders: removed Delivery column, status-breakdown stat cards.
- Case-costing compare: full rewrite to match v0 (filter card → benchmark card → surgeon comparison table → side-by-side bar charts → what-if savings card). Reads `?surgeon=&procedure=` from URL.
- Case-costing reports: v0 inline header + 4-card stats + tabs with icons + 9-option date range.
- Price-discrepancy: inline header + Export Report button.
- Settings: canonical v0 tab order (profile → notifications → billing → members → account → facilities → connections → vendors → categories → features → ai-credits → addons).

### Vendor portal — 16 routes

Routes ported:
`/vendor` → redirect to `/vendor/dashboard` · `/vendor/dashboard` · `/vendor/contracts` (+ `/new`, `/[id]`, `/[id]/edit`, `/pending/[id]/edit`) · `/vendor/invoices` · `/vendor/purchase-orders` · `/vendor/market-share` · `/vendor/performance` · `/vendor/prospective` · `/vendor/renewals` · `/vendor/alerts` · `/vendor/ai-agent` · `/vendor/reports` · `/vendor/settings`.

**Changes this pass:**
- New `app/vendor/page.tsx` that `redirect("/vendor/dashboard")` so v0 links resolve.
- `components/vendor/performance/performance-client.tsx` rewritten to v0's 4-tab structure:
  1. **Overview** — Spend vs Target AreaChart + Performance Scorecard RadarChart + Monthly Rebates BarChart
  2. **By Contract** — contract list with compliance + rebate columns
  3. **Rebate Progress** — filters + dynamic tier display + YTD summary
  4. **By Category** — horizontal BarChart + table
  Live-queries `getVendorPerformance`, falls back to v0 mock data when no contracts.
- `components/vendor/reports-client.tsx` dropped extra Contract Performance DataTable, restored v0's 4 report-type cards + recent reports table + generate-report dialog.
- `app/vendor/alerts/page.tsx`, `/vendor/invoices/page.tsx`, `/vendor/purchase-orders/page.tsx`, `/vendor/reports/page.tsx` — switched from `PageHeader` component to v0's inline `<h1>` header with actions in the right column.
- Fixed 3 pre-existing recharts formatter TS errors in `performance-client.tsx`.
- `components/vendor/ai-agent-client.tsx`, `market-share-client.tsx`, `renewals/*`, `prospective/*`, `settings/*` were already structurally v0-aligned from prior work.

Data source: `hooks/use-vendor-dashboard.ts`, `use-vendor-contracts.ts`, `use-vendor-alerts.ts`, `use-vendor-crud.ts`, `use-pending-contracts.ts`, `use-prospective.ts`. Auth guard: `requireVendor()` preserved on every page.

### Admin portal — 6 routes

| Route | Source | Data |
|---|---|---|
| `/admin` → redirect | `app/admin/page.tsx` | redirects to `/admin/dashboard` |
| `/admin/dashboard` | `components/admin/admin-dashboard-client.tsx` | `lib/actions/admin/*` |
| `/admin/users` | `components/admin/user-table.tsx` | `lib/actions/admin/users.ts` |
| `/admin/facilities` | `components/admin/facility-table.tsx` | `lib/actions/admin/facilities.ts` |
| `/admin/vendors` | `components/admin/vendor-table.tsx` | `lib/actions/admin/vendors.ts` |
| `/admin/payor-contracts` | `components/admin/payor-contract-table.tsx` | `lib/actions/payor-contracts.ts` |
| `/admin/billing` | `components/admin/billing-client.tsx` | `lib/stripe.ts` + `lib/actions/admin/billing.ts` |

**Changes this pass:**
- `app/admin/page.tsx` added as a redirect to `/admin/dashboard` (v0 had a root admin page; tydei uses a sub-route).
- Admin dashboard: pending-actions amber alert card, 4-card stats with `+12.4%` MRR growth, Quick Actions + Recent Activity 2-up, Platform Performance 3-up. Activity feed restyled with type-colored circular icons + relative time.
- Users / facilities / vendors pages: switched from `PageHeader` to v0 inline header + back link to `/admin/dashboard`.
- Payor contracts: full table rewrite with Upload dialog (payor/type/facility/contract#/dates/notes), 4 stat cards, native table with Payor/Facility/Contract#/Effective/Expires/CPT Rates/Status/Actions columns. Added **View Rates** dialog with CPT Rates / Groupers / Contract Terms tabs (sticky headers, green-600 rate cells, Multi-procedure rule card, Implant Passthrough card, Notes card, Export Rates footer). Facility dropdown sourced from `adminGetFacilities()`.
- Billing: added MRR card (Current MRR / Active Subscriptions / Avg Revenue per Account) wired to real Stripe via `getMRRData` + `getSubscriptions`. Mock `$8,450` hardcoded values removed.

### AI layer

- `lib/ai/tools.ts` — added `calculateProspectiveRebate` (pure calculation, matches v0 shape: `annualSpend`, `rebateRate`, `contractYears`, `growthRate?`, returns `totalProjectedRebate` + `yearlyBreakdown[]` + `averageAnnualRebate`). Existing tools (`getContractPerformance`, `getMarketShareAnalysis`, `getSurgeonPerformance`, `getAlertsSummary`) cover the rest of v0's tool set.
- `lib/ai/prompts.ts` — `facilitySystemPrompt` and `vendorSystemPrompt` rewritten verbatim to v0's more detailed role descriptions (tool capability enumeration, scope boundaries, role restriction).
- `lib/ai/prompts/vendor-ai-agent.ts` — new file exporting `vendorAiAgentSystemPrompt` + `vendorAiAgentSuggestedQuestions` (6 questions matching v0).
- `app/api/ai/chat/route.ts` unchanged — `geminiModel` from `@ai-sdk/google`, portal-aware prompt selection.

## Acceptance

- `bunx tsc --noEmit` → **0 errors**
- `bun run lint` (oxlint) → 0 errors, 155 style warnings (unused imports, mostly pre-existing)
- `bun run build` → success, all 52 routes emit
- **Smoke test** (authenticated via Better Auth `/api/auth/sign-in/email` with seeded demo users): all 52 routes return 200 under the correct role's session. No runtime errors in the dev server log.

Demo logins (from `prisma/seed.ts`):
- `demo-facility@tydei.com` / `demo-facility-2024`
- `demo-vendor@tydei.com` / `demo-vendor-2024`
- `demo-admin@tydei.com` / `demo-admin-2024`

## Known gaps — deferred to follow-up PRs

These were surfaced during the port but not executed (marked as **report-only** by the porting subagents). Schema changes must be batched:

- **User `status` column** (active/inactive/pending). `/admin/users` currently renders all users as `active`.
- **User `lastLogin` timestamp**. Currently renders `createdAt`.
- **User `notificationEmails` + `notificationPreferences`**. The admin invite dialog stores these in component state only, not persisted.
- **Health-system grouping** for user facility access. Tydei has `healthSystemId` on `Facility` but no pivot model for per-user health-system access.
- **VendorDivision** model. v0's add-user dialog selects divisions under vendors; tydei has flat vendors only.
- **PayorContract rate editing**. View Rates dialog is read-only (matches v0) — a dedicated rate editor is a separate feature.

Also deferred:
- `components/vendor/performance/performance-dashboard.tsx` is now orphaned (unreferenced). Safe to delete in a cleanup PR.
- `components/admin/admin-stats.tsx` is similarly orphaned.
- The inner filter bar in `components/shared/alerts/alerts-list.tsx` duplicates the outer alerts page tabs. Low-priority polish.

## How to iterate

1. Start dev: `docker compose up -d && bun run db:push && bun run db:seed && bun run dev`
2. Visit a page in the browser (or `curl` it under a demo session).
3. If it looks wrong vs the v0 reference PNGs in `docs/v0-reference/<slug>/<theme>-<viewport>.png`, open the corresponding tydei client component and iterate.
4. All data wiring is through TanStack Query hooks in `hooks/` that call server actions in `lib/actions/` — don't reintroduce Zustand stores.

## Out of scope (explicitly)

- Vendor-portal Stripe UI (vendors don't self-serve billing yet).
- Playwright visual-diff CI gates.
- Mobile-app / PWA work.
- Health-system hierarchical access (see deferred list).
