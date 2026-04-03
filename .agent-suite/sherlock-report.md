# Sherlock Verification Report
## Date: 2026-04-01
## Verdict: ISSUES FOUND

---

## Spec Verification Matrix

### Pages -- Dashboard (Facility)

| # | Item | v0 File | Production File | Status | Notes |
|---|------|---------|-----------------|--------|-------|
| 1 | Dashboard Home | `app/dashboard/page.tsx` | `app/dashboard/page.tsx` | PASS | |
| 2 | Contracts List | `app/dashboard/contracts/page.tsx` | `app/dashboard/contracts/page.tsx` | PASS | |
| 3 | Contract New | `app/dashboard/contracts/new/page.tsx` | `app/dashboard/contracts/new/page.tsx` | PASS | |
| 4 | Contract Detail | `app/dashboard/contracts/[id]/page.tsx` | `app/dashboard/contracts/[id]/page.tsx` | PASS | |
| 5 | Contract Edit | `app/dashboard/contracts/[id]/edit/page.tsx` | `app/dashboard/contracts/[id]/edit/page.tsx` | PASS | |
| 6 | Contract Terms | `app/dashboard/contracts/[id]/terms/page.tsx` | -- | FAIL | No standalone terms page in production; terms entry is embedded in contract form components |
| 7 | Contract Score | `app/dashboard/contracts/[id]/score/page.tsx` | `app/dashboard/contracts/[id]/score/page.tsx` | PASS | |
| 8 | COG Data | `app/dashboard/cog-data/page.tsx` | `app/dashboard/cog-data/page.tsx` | PASS | |
| 9 | Case Costing Main | `app/dashboard/case-costing/page.tsx` | `app/dashboard/case-costing/page.tsx` | PASS | |
| 10 | Case Costing Compare | `app/dashboard/case-costing/compare/page.tsx` | `app/dashboard/case-costing/compare/page.tsx` | PASS | |
| 11 | Case Costing Reports | `app/dashboard/case-costing/reports/page.tsx` | `app/dashboard/case-costing/reports/page.tsx` | PASS | |
| 12 | Analysis Main | `app/dashboard/analysis/page.tsx` | `app/dashboard/analysis/page.tsx` | PASS | |
| 13 | Analysis Prospective | `app/dashboard/analysis/prospective/page.tsx` | `app/dashboard/analysis/prospective/page.tsx` | PASS | |
| 14 | Invoice Validation | `app/dashboard/invoice-validation/page.tsx` | `app/dashboard/invoice-validation/page.tsx` | PASS | Production also has `[id]` detail page (exceeds v0) |
| 15 | Purchase Orders | `app/dashboard/purchase-orders/page.tsx` | `app/dashboard/purchase-orders/page.tsx` | PASS | Production also has `new` and `[id]` sub-pages |
| 16 | Renewals | `app/dashboard/contract-renewals/page.tsx` | `app/dashboard/renewals/page.tsx` | PASS | Route renamed from `contract-renewals` to `renewals` |
| 17 | Reports Main | `app/dashboard/reports/page.tsx` | `app/dashboard/reports/page.tsx` | PASS | |
| 18 | Reports Price Discrepancy | `app/dashboard/reports/price-discrepancy/page.tsx` | `app/dashboard/reports/price-discrepancy/page.tsx` | PASS | |
| 19 | Settings | `app/dashboard/settings/page.tsx` | `app/dashboard/settings/page.tsx` | PASS | |
| 20 | Alerts List | `app/dashboard/alerts/page.tsx` | `app/dashboard/alerts/page.tsx` | PASS | |
| 21 | Alerts Detail | `app/dashboard/alerts/[id]/page.tsx` | `app/dashboard/alerts/[id]/page.tsx` | PASS | |
| 22 | AI Agent | `app/dashboard/ai-agent/page.tsx` | `app/dashboard/ai-agent/page.tsx` | PASS | |
| 23 | Rebate Optimizer | `app/dashboard/rebate-optimizer/page.tsx` | `app/dashboard/rebate-optimizer/page.tsx` | PASS | |

### Pages -- Vendor

| # | Item | v0 File | Production File | Status | Notes |
|---|------|---------|-----------------|--------|-------|
| 24 | Vendor Dashboard | `app/vendor/page.tsx` | `app/vendor/dashboard/page.tsx` | PASS | Route restructured to `/vendor/dashboard` |
| 25 | Vendor Contracts List | `app/vendor/contracts/page.tsx` | `app/vendor/contracts/page.tsx` | PASS | |
| 26 | Vendor Contract New | `app/vendor/contracts/new/page.tsx` | `app/vendor/contracts/new/page.tsx` | PASS | |
| 27 | Vendor Contract Detail | `app/vendor/contracts/[id]/page.tsx` | `app/vendor/contracts/[id]/page.tsx` | PASS | |
| 28 | Vendor Contract Edit | `app/vendor/contracts/[id]/edit/page.tsx` | -- | FAIL | No dedicated edit page; edits likely handled via change proposals |
| 29 | Vendor Pending Edit | `app/vendor/contracts/pending/[id]/edit/page.tsx` | -- | FAIL | No dedicated pending edit page; pending contracts handled via `pending-contract-card` component |
| 30 | Vendor POs | `app/vendor/purchase-orders/page.tsx` | `app/vendor/purchase-orders/page.tsx` | PASS | |
| 31 | Vendor Invoices | `app/vendor/invoices/page.tsx` | `app/vendor/invoices/page.tsx` | PASS | |
| 32 | Vendor Market Share | `app/vendor/market-share/page.tsx` | `app/vendor/market-share/page.tsx` | PASS | |
| 33 | Vendor Performance | `app/vendor/performance/page.tsx` | `app/vendor/performance/page.tsx` | PASS | |
| 34 | Vendor Renewals | `app/vendor/renewals/page.tsx` | `app/vendor/renewals/page.tsx` | PASS | |
| 35 | Vendor Reports | `app/vendor/reports/page.tsx` | `app/vendor/reports/page.tsx` | PASS | |
| 36 | Vendor Settings | `app/vendor/settings/page.tsx` | `app/vendor/settings/page.tsx` | PASS | |
| 37 | Vendor Alerts | `app/vendor/alerts/page.tsx` | `app/vendor/alerts/page.tsx` | PASS | |
| 38 | Vendor AI Agent | `app/vendor/ai-agent/page.tsx` | `app/vendor/ai-agent/page.tsx` | PASS | |
| 39 | Vendor Prospective | `app/vendor/prospective/page.tsx` | `app/vendor/prospective/page.tsx` | PASS | |

### Pages -- Admin

| # | Item | v0 File | Production File | Status | Notes |
|---|------|---------|-----------------|--------|-------|
| 40 | Admin Dashboard | `app/admin/page.tsx` | `app/admin/dashboard/page.tsx` | PASS | Route restructured to `/admin/dashboard` |
| 41 | Admin Users | `app/admin/users/page.tsx` | `app/admin/users/page.tsx` | PASS | |
| 42 | Admin Vendors | `app/admin/vendors/page.tsx` | `app/admin/vendors/page.tsx` | PASS | |
| 43 | Admin Facilities | `app/admin/facilities/page.tsx` | `app/admin/facilities/page.tsx` | PASS | |
| 44 | Admin Billing | `app/admin/billing/page.tsx` | `app/admin/billing/page.tsx` | PASS | |
| 45 | Admin Payor Contracts | `app/admin/payor-contracts/page.tsx` | `app/admin/payor-contracts/page.tsx` | PASS | |

### Pages -- Auth

| # | Item | v0 File | Production File | Status | Notes |
|---|------|---------|-----------------|--------|-------|
| 46 | Login | `app/auth/login/page.tsx` | `app/(auth)/login/page.tsx` | PASS | Route group pattern `(auth)` |
| 47 | Sign Up | `app/auth/sign-up/page.tsx` | `app/(auth)/sign-up/page.tsx` | PASS | |
| 48 | Sign Up Success | `app/auth/sign-up-success/page.tsx` | `app/(auth)/sign-up-success/page.tsx` | PASS | |
| 49 | Auth Error | `app/auth/error/page.tsx` | `app/(auth)/error/page.tsx` | PASS | |

### Components -- contracts/

| # | Item | v0 File | Production File | Status | Notes |
|---|------|---------|-----------------|--------|-------|
| 50 | contract-pdf-upload | `components/contracts/contract-pdf-upload.tsx` | `components/contracts/document-upload.tsx` | PASS | Renamed to `document-upload`; handles multi-doc upload |
| 51 | contract-terms-entry | `components/contracts/contract-terms-entry.tsx` | `components/contracts/contract-terms-entry.tsx` | PASS | Same name |
| 52 | contract-score-badge | `components/contracts/contract-score-badge.tsx` | `components/facility/contracts/contract-score-client.tsx` | PARTIAL | Score feature exists but as a full page client, not a standalone badge component |
| 53 | contract-transactions | `components/contracts/contract-transactions.tsx` | -- | FAIL | No contract transaction ledger component found |
| 54 | ai-contract-description | `components/contracts/ai-contract-description.tsx` | `components/contracts/ai-extract-dialog.tsx` + `ai-extract-review.tsx` | PASS | Refactored into extract dialog + review workflow |
| 55 | amendment-extractor | `components/contracts/amendment-extractor.tsx` | -- | FAIL | No amendment extractor component; document-upload handles multi-file but no explicit amendment extraction |
| 56 | definition-tooltip | `components/contracts/definition-tooltip.tsx` | -- | FAIL | No definition tooltip component found |

### Components -- cog/

| # | Item | v0 File | Production File | Status | Notes |
|---|------|---------|-----------------|--------|-------|
| 57 | cog-importer | `components/cog/cog-importer.tsx` | `components/facility/cog/cog-import-dialog.tsx` | PASS | Restructured under facility/cog |
| 58 | cog-csv-upload | `components/cog/cog-csv-upload.tsx` | `components/facility/cog/file-dropzone.tsx` + `cog-import-preview.tsx` | PASS | Split into dropzone + preview |
| 59 | duplicate-validator | `components/cog/duplicate-validator.tsx` | `components/facility/cog/duplicate-validator.tsx` | PASS | |
| 60 | vendor-name-matcher | `components/cog/vendor-name-matcher.tsx` | `components/facility/cog/vendor-name-matcher.tsx` | PASS | |

### Components -- import/

| # | Item | v0 File | Production File | Status | Notes |
|---|------|---------|-----------------|--------|-------|
| 61 | mass-upload | `components/import/mass-upload.tsx` | -- | FAIL | No standalone mass-upload component; doc upload handles multi-file but no AI classification hub |
| 62 | contract-import-modal | `components/import/contract-import-modal.tsx` | `components/contracts/ai-extract-dialog.tsx` | PASS | Equivalent via AI extract dialog |
| 63 | cog-import-modal | `components/import/cog-import-modal.tsx` | `components/facility/cog/cog-import-dialog.tsx` | PASS | |
| 64 | vendor-matcher | `components/import/vendor-matcher.tsx` | `components/facility/cog/vendor-name-matcher.tsx` | PASS | Consolidated into cog/ |

### Components -- pricing/

| # | Item | v0 File | Production File | Status | Notes |
|---|------|---------|-----------------|--------|-------|
| 65 | pricing-file-upload | `components/pricing/pricing-file-upload.tsx` | `components/facility/cog/pricing-import-dialog.tsx` | PASS | Moved under cog/ |

### Components -- charts/

| # | Item | v0 File | Production File | Status | Notes |
|---|------|---------|-----------------|--------|-------|
| 66 | forecast-chart | `components/charts/forecast-chart.tsx` | `components/facility/analysis/price-projection-chart.tsx` | PARTIAL | Renamed to price-projection-chart; forecast concept exists in analysis/capital/projections-tab but no standalone forecast-chart |
| 67 | forecast-table | `components/charts/forecast-table.tsx` | -- | FAIL | No standalone forecast table component |

### Components -- case-costing/

| # | Item | v0 File | Production File | Status | Notes |
|---|------|---------|-----------------|--------|-------|
| 68 | payor-contracts-manager | `components/case-costing/payor-contracts-manager.tsx` | `components/facility/case-costing/payor-contracts-manager.tsx` | PASS | |
| 69 | ai-supply-matcher | `components/case-costing/ai-supply-matcher.tsx` | `components/facility/case-costing/ai-supply-match.tsx` | PASS | Slightly renamed |
| 70 | case-costing-explainer | `components/case-costing/case-costing-explainer.tsx` | -- | FAIL | No case costing explainer component found |

### Components -- dashboard/

| # | Item | v0 File | Production File | Status | Notes |
|---|------|---------|-----------------|--------|-------|
| 71 | dashboard-metrics | `components/dashboard/dashboard-metrics.tsx` | `components/facility/dashboard/dashboard-stats.tsx` | PASS | Renamed to dashboard-stats |
| 72 | dashboard-charts | `components/dashboard/dashboard-charts.tsx` | `components/facility/dashboard/spend-by-category-chart.tsx` + `spend-by-vendor-chart.tsx` + `total-spend-chart.tsx` | PASS | Split into individual chart components |
| 73 | dashboard-filters | `components/dashboard/dashboard-filters.tsx` | `components/facility/dashboard/dashboard-filters.tsx` | PASS | |
| 74 | dashboard-shell | `components/dashboard/dashboard-shell.tsx` | `components/shared/shells/portal-shell.tsx` | PASS | Generalized to portal-shell |

### Features

| # | Item | Status | Notes |
|---|------|--------|-------|
| 75 | Multi-document upload with AI classification | PARTIAL | `document-upload.tsx` supports multi-file uploads; AI extract exists but no AI-based file type classification hub |
| 76 | Amendment extraction | FAIL | No amendment extraction component or feature found |
| 77 | Contract transaction ledger | FAIL | No contract-transactions component found |
| 78 | Contract score badges on list | PARTIAL | Score page exists (`contract-score-client.tsx`, `ai-score-page.tsx`) but no inline badge on the contracts list table |
| 79 | Definition tooltips | FAIL | No definition-tooltip component found |
| 80 | AI free-text contract entry | PASS | `ai-extract-dialog.tsx` and `ai-extract-review.tsx` implement AI-assisted contract entry |
| 81 | Forecast visualization | PARTIAL | `price-projection-chart.tsx` and `projections-tab.tsx` exist; no standalone forecast-chart/forecast-table matching v0 |
| 82 | Vendor alias matching | PASS | `vendor-name-matcher.tsx` in facility/cog handles vendor alias matching |
| 83 | Category auto-detection from pricing files | PARTIAL | `pricing-column-mapper.tsx` handles column mapping; no explicit category auto-detection logic found |

---

## Compilation Check

```
npx tsc --noEmit
```

**Result: CLEAN -- 0 errors**

---

## Convention Violations

| Issue | File(s) | Severity |
|-------|---------|----------|
| `: any` type annotation | `test-fixtures/test-e2e-pricing-import.ts` (2 occurrences) | LOW (test file only) |
| `as any` cast | `lib/actions/contracts.ts` (1), `lib/actions/admin/billing.ts` (1), `app/api/parse-file/route.ts` (1) | MEDIUM |
| `as any` cast (generated) | `lib/generated/zod/index.ts` (16 occurrences) | SKIP (auto-generated) |
| `@ts-ignore` | None found | -- |
| `.env` file exposure | `.env` exists but is listed in `.gitignore` | OK |
| Skeleton loading states | 120 occurrences of `Skeleton` across 31 component files | OK (proper loading pattern) |
| UUID display in JSX | No raw UUIDs rendered in component output | OK |
| Duplicate utility functions | Single `lib/utils.ts` + `lib/utils/levenshtein.ts`; no feature-folder duplication | OK |

---

## Summary

| Status | Count |
|--------|-------|
| PASS | 63 |
| PARTIAL | 6 |
| FAIL | 14 |
| SKIP | 0 |

### FAIL Items (14 total)

1. **#6** -- Contract Terms standalone page (`/dashboard/contracts/[id]/terms`) -- terms entry is embedded in contract forms, not a separate route
2. **#28** -- Vendor Contract Edit page (`/vendor/contracts/[id]/edit`) -- no dedicated page; handled via change proposals
3. **#29** -- Vendor Pending Contract Edit page (`/vendor/contracts/pending/[id]/edit`) -- no dedicated page; pending contracts use card component
4. **#52** -- `contract-score-badge` -- exists as full score page/client, not an inline badge component (also counted as PARTIAL)
5. **#53** -- `contract-transactions` -- no transaction ledger component
6. **#55** -- `amendment-extractor` -- no amendment extraction component
7. **#56** -- `definition-tooltip` -- no definition tooltip component
8. **#61** -- `mass-upload` with AI classification -- no standalone mass upload hub
9. **#67** -- `forecast-table` -- no standalone forecast table
10. **#70** -- `case-costing-explainer` -- no explainer component
11. **#76** -- Amendment extraction feature
12. **#77** -- Contract transaction ledger feature
13. **#79** -- Definition tooltips feature

### PARTIAL Items (6 total)

1. **#52** -- Contract score badge -- score feature exists but not as inline list badge
2. **#66** -- Forecast chart -- price projection chart exists but differently structured
3. **#75** -- Multi-doc upload with AI classification -- multi-file upload exists but no AI classification routing
4. **#78** -- Score badges on contracts list -- score page exists but not surfaced on list
5. **#81** -- Forecast visualization -- projections tab exists but no standalone forecast components
6. **#83** -- Category auto-detection -- column mapper exists but no explicit category detection

### Key Observations

- Production codebase is well-organized with proper separation: `facility/`, `vendor/`, `admin/`, `shared/` component folders
- Server actions in `lib/actions/` with matching Zod validators in `lib/validators/` -- clean architecture
- TypeScript is fully clean (0 errors)
- Only 3 hand-written `as any` casts in non-generated code
- Skeleton loading states are properly used across 31 client components
- The primary gaps are v0 prototype features that were deprioritized or redesigned: amendment extraction, contract transactions, definition tooltips, forecast table, case-costing explainer, and the mass-upload classification hub
