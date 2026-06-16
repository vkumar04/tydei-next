# Vendor Reports Hub — Full Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the vendor Reports tab full parity with the facility Reports Hub — Overview, per-contract-type performance details (Usage/Capital/Service/Tie-In/Grouped/Pricing), By Rebate Type, and Calculations — all scoped to the calling vendor's contracts across every facility they serve.

**Architecture:** Mirror the facility hub. Reuse the purely-presentational sub-components (`ReportPeriodTable`, `ReportTrendChart`, `ReportContractHeader`, recharts wrappers) verbatim. Build vendor-scoped sibling server actions that return the SAME payload shapes the facility actions return, so the presentational layer is shared. Vendor scoping goes through ONE new canonical helper (`contractsOwnedByVendor`) to avoid the group-vendor-drift class. The facility hub's "Vendor filter" becomes a "Facility filter" on the vendor side.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7, TypeScript strict, TanStack Query, shadcn/ui, recharts, Vitest.

**Demo facts (prod):** Vendor (e.g. Arthrex/J&J/S&N/Stryker) relates to facility "Lighthouse Surgical Center" via `Contract.facilityId`. Lighthouse has 5 active contracts across these vendors. So the vendor hub's facility filter will show Lighthouse; the per-type tabs will show that vendor's contract(s).

---

## Canonical scoping rule (read first)

Vendor contract scope = primary `vendorId` **OR** membership in a grouped contract's `additionalVendorIds`. NEVER scope by bare `vendorId` (memory: group-vendor-drift). All vendor report queries MUST go through the new helper below — the facility analog is `contractsOwnedByFacility` / `contractOwnershipWhere` in `lib/actions/contracts-auth.ts`.

COG/Rebate axis differs from facility: facility actions scope COG by `facilityId`; vendor actions scope COG by the vendor's participating-vendor set (`vendorId` of the COGRecord ∈ contract's vendor set) and Rebate by contract-owned-by-vendor. Do not blindly copy `facilityId:` filters.

---

## File Structure

**New — server:**
- `lib/actions/contracts-vendor-auth.ts` — `contractsOwnedByVendor(vendorId)`, `contractOwnershipWhereVendor(contractId, vendorId)`
- `lib/actions/vendor-reports/report-data.ts` — `getVendorReportData(input)`
- `lib/actions/vendor-reports/overview.ts` — `getVendorReportsOverview(input?)`
- `lib/actions/vendor-reports/by-rebate-type.ts` — `getVendorRebateBreakdownByType()`
- `lib/actions/vendor-reports/audit-trail.ts` — `getVendorRebateCalculationAudit(contractId)`
- `lib/actions/vendor-reports/contracts-list.ts` — `getVendorReportContracts()` (selector list) + `getVendorReportFacilities()` (facility-filter options; can reuse `getVendorRelatedFacilities`)

**New — client (components/vendor/reports/hub/):**
- `vendor-reports-hub-client.tsx` — orchestrator (mirror of facility `reports-client.tsx`)
- `vendor-reports-control-bar.tsx` — date range + Facility filter + Contract selector + schedules CTA
- `vendor-reports-overview-tab.tsx`
- `vendor-reports-per-type-tab.tsx`
- `vendor-reports-by-rebate-type-tab.tsx`
- `vendor-reports-calculations-tab.tsx`
- `vendor-reports-tab-router.tsx` (+ `computeAvailableVendorTabs`)
- `vendor-reports-types.ts` (mirror `reports-types.ts`)

**Reused verbatim (no change):** `components/facility/reports/report-period-table.tsx`, `report-trend-chart.tsx`, `report-contract-header.tsx`, and the `ContractPeriodRow` / `report-columns` types.

**Modified:**
- `lib/query-keys.ts` — add `vendorReports` key group
- `components/vendor/reports-client.tsx` — mount the new hub (tab or section) alongside the existing CSV cards (do NOT delete the CSV exports; add the hub)
- `app/vendor/reports/page.tsx` — pass through whatever the hub needs (already fetches facilities)

---

## Payload-shape contract (vendor actions MUST match facility shapes)

So the presentational layer is shared, each vendor action returns the SAME TypeScript shape as its facility counterpart (see the architecture map in the controller's context):
- `getVendorReportData` → `{ facilityName→(use vendor or "All Facilities"), contracts: [{ id,name,contractNumber,vendor,vendorId,contractType,effectiveDate,expirationDate,totalValue,rebateEarnedCanonical,rebateCollectedCanonical,marginCanonical,periods: ContractPeriodRow[] }], reportType, dateFrom, dateTo }`
- `getVendorReportsOverview` → `ReportsOverviewPayload` (`{ lifecycle, monthlyTrend, stats }`)
- `getVendorRebateBreakdownByType` → `RebateTypeBucket[]`
- `getVendorRebateCalculationAudit` → `RebateCalcAudit`

Canonical totals: use `sumEarnedRebatesLifetime` / `sumCollectedRebates` (NEVER raw `ContractPeriod.rebateEarned`). Reuse `computeSyntheticContractPeriods` fallback when no persisted periods (already exists; it takes a facilityId — generalize or call per-facility for the contract's facility).

---

## Tasks

### Task 1: Canonical vendor scoping helper

**Files:** Create `lib/actions/contracts-vendor-auth.ts`; Test `lib/actions/__tests__/contracts-vendor-auth.test.ts`

- [ ] Write failing test asserting `contractsOwnedByVendor("v1")` returns `{ OR: [{ vendorId: "v1" }, { additionalVendorIds: { has: "v1" } }] }` and `contractOwnershipWhereVendor("c1","v1")` returns `{ id: "c1", OR: [...] }`.
- [ ] Implement both as pure functions (no auth inside — they return Prisma `where` fragments, mirroring `contracts-auth.ts`).
- [ ] Run test → pass. Commit.

### Task 2: `getVendorReportData`

**Files:** Create `lib/actions/vendor-reports/report-data.ts`; Test sibling.

- [ ] `"use server"`; `requireVendor()`; contracts via `contractsOwnedByVendor(vendor.id)` + `contractType` filter + `status: { in: ["active","expiring"] }`, include terms/periods/rebates exactly like `getReportData`.
- [ ] Build `ContractPeriodRow[]` with the synthetic-period fallback; canonical totals via `sumEarnedRebatesLifetime`/`sumCollectedRebates`. Return the facility-identical shape (`facilityName` = "All Facilities" or the single facility's name).
- [ ] Test with a seeded vendor+grouped contract asserting grouped membership is included. Commit.

### Task 3: `getVendorReportsOverview`
Mirror `lib/actions/reports/overview.ts`, swapping `contractsOwnedByFacility(facility.id)` → `contractsOwnedByVendor(vendor.id)` and the COG `facilityId` filter → the vendor participating-set filter. Same return payload. Test + commit.

### Task 4: `getVendorRebateBreakdownByType`
Mirror `lib/actions/reports/by-rebate-type.ts` with `where: { contract: contractsOwnedByVendor(vendor.id) }`. Same `RebateTypeBucket[]` shape. Test + commit.

### Task 5: `getVendorRebateCalculationAudit`
Mirror `lib/actions/reports/audit-trail.ts` with `contractOwnershipWhereVendor(contractId, vendor.id)`; COG scoped by vendor set, not facilityId. Same `RebateCalcAudit` shape. Test + commit.

### Task 6: Vendor selector lists + types
`getVendorReportContracts()` (contracts owned by vendor → `ReportsContract`-shaped rows incl. `facilityName`); facility-filter options via existing `getVendorRelatedFacilities()`. Add `vendor-reports-types.ts` mirroring `ReportTabKey`/`ReportsContract`/`ReportsDateRange`. Commit.

### Task 7: Query keys
Add `vendorReports: { data, overview, byRebateType, audit, contracts }` to `lib/query-keys.ts`, keyed by `vendorId`. Commit.

### Task 8: Vendor tab components (reuse presentational children)
Build `vendor-reports-overview-tab`, `-per-type-tab`, `-by-rebate-type-tab`, `-calculations-tab`, `-tab-router` (+ `computeAvailableVendorTabs`). Each mirrors its facility counterpart but calls the vendor action and the new query keys; per-type + calculations reuse `ReportContractHeader`/`ReportPeriodTable`/`ReportTrendChart` verbatim. The control bar's first filter is **Facility** (options from `getVendorRelatedFacilities`), second is **Contract**. Commit per component.

### Task 9: Hub client + mount + wiring
`vendor-reports-hub-client.tsx` orchestrator (state: dateRange, selectedFacilityId, selectedContractId, activeTab; auto-route to type tab on contract select). Mount it in `components/vendor/reports-client.tsx` (new "Performance Details" tab/section above or below the CSV cards — keep the CSVs). Ensure `app/vendor/reports/page.tsx` passes needed props. Commit.

### Task 10: Verify
- [ ] `bunx tsc --noEmit` → 0 errors
- [ ] `bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'` → green
- [ ] Confirm every vendor query uses `contractsOwnedByVendor` (grep; no bare `{ vendorId }` in vendor-reports/).
- [ ] Confirm canonical rebate totals (`sumEarnedRebatesLifetime`/`sumCollectedRebates`) — no raw `ContractPeriod.rebateEarned`.
- [ ] Prod smoke against Lighthouse vendor.

---

## Self-Review notes
- Shapes MUST match facility payloads exactly or the shared presentational components break — diff the interfaces.
- Don't touch the facility actions (sacred scoping). Vendor is additive.
- `additionalVendorIds` grouped membership is the #1 correctness risk — Task 2's test must cover it.
