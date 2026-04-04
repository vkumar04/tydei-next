# Final Gap Report

Generated: 2026-04-01 | Sherlock Build Verifier

## MISSING UI (production needs these)

| # | Page | What's Missing | v0 File | Impact |
|---|------|---------------|---------|--------|
| 1 | `/dashboard/settings` | Missing **Vendors** tab (vendor CRUD management inline in settings) | `app/dashboard/settings/page.tsx` L1580 | Low -- vendor management is available in Admin portal; facility users lose self-service vendor add/edit |
| 2 | `/dashboard/settings` | Missing **Categories** tab (product category CRUD inline in settings) | `app/dashboard/settings/page.tsx` L1781 | Low -- categories not user-manageable in production; admin may need to add this if facilities need it |

**That's it.** Every other page, tab, stat card, chart, table column, form field, and empty state is at parity or exceeds v0.

## NOTES ON DIFFERENCES (production is BETTER than v0)

| Page | Detail |
|------|--------|
| `/dashboard/contracts/[id]` | v0 is a stub ("Contract details coming soon"); production has full detail view with overview, terms, transactions, amendments tabs |
| `/dashboard/analysis` | Production adds a **Forecasts** tab beyond v0's 5 tabs (upload, inputs, projections, analysis, report) |
| `/dashboard/settings` | Production adds an **Addons** tab not in v0 |
| `/dashboard/alerts` | Production has richer summary cards (Off-Contract, Expiring, Rebates Due, Total Unresolved) with icons and colored borders; v0 has simpler stat badges |
| `/dashboard/invoice-validation` | Production adds Discrepancies + Analytics tabs; v0 imports Tabs but doesn't render them |
| `/admin/users` | Production has All/Facility/Vendor/Admin filter tabs; v0 only has Facility/Vendor |

## AT PARITY (no action needed)

**41 of 43 pages verified at parity** (the 2 missing settings tabs are noted above).

### Facility Portal (21 pages)
- `/dashboard` -- stat cards (4), filters, 3 charts, recent contracts, recent alerts
- `/dashboard/contracts` -- 3 stat cards, 2 tabs (All Contracts, Compare), table with DataTable, filters
- `/dashboard/contracts/new` -- 3 entry mode tabs (AI, PDF, Manual), all form fields present
- `/dashboard/contracts/[id]` -- production exceeds v0 (v0 is stub)
- `/dashboard/contracts/[id]/terms` -- term tiers table, add/edit dialog
- `/dashboard/contracts/[id]/score` -- radar chart, bar charts, scoring breakdown
- `/dashboard/cog-data` -- 4 tabs (COG Data, COG Files, Pricing Files, Pricing List)
- `/dashboard/case-costing` -- 3 tabs (Cases, Surgeons, Payor Contracts), case detail dialog
- `/dashboard/case-costing/compare` -- surgeon compare view
- `/dashboard/case-costing/reports` -- reports view
- `/dashboard/analysis` -- 5+ tabs (upload, inputs, projections, analysis, report, forecasts)
- `/dashboard/analysis/prospective` -- 4 tabs (upload, pricing, analysis, history)
- `/dashboard/invoice-validation` -- upload, table, discrepancy/analytics tabs
- `/dashboard/purchase-orders` -- 4 stat cards, PO table with matching columns
- `/dashboard/renewals` -- 5 tabs (All, Critical, Warning, Upcoming, On Track)
- `/dashboard/reports` -- 8 tabs (usage, service, capital, tie_in, grouped, pricing_only, overview, calculations)
- `/dashboard/reports/price-discrepancy` -- price discrepancy table
- `/dashboard/rebate-optimizer` -- rebate earnings chart, tier progress, opportunities
- `/dashboard/ai-agent` -- chat interface with suggested prompts
- `/dashboard/settings` -- 10 of 11 tabs present (missing: vendors, categories)
- `/dashboard/alerts` -- 5 tabs (All, Unread, Off-Contract, Expiring, Rebates), 4 summary cards

### Vendor Portal (16 pages)
- `/vendor` -- stat cards, spend chart, market share chart (at `/vendor/dashboard` in prod)
- `/vendor/contracts` -- contract list with status tabs, New Contract button
- `/vendor/contracts/new` -- submission form with facility selection
- `/vendor/contracts/[id]` -- contract detail with overview, terms, transactions, amendments tabs
- `/vendor/contracts/[id]/edit` -- contract edit form
- `/vendor/contracts/pending/[id]/edit` -- pending contract edit
- `/vendor/prospective` -- 4 stat cards, 5 tabs (Opportunities, Proposals, Deal Scorer, Benchmarks, Analytics)
- `/vendor/market-share` -- pie chart, category breakdown, facility bars, growth opportunities
- `/vendor/performance` -- 4 stat cards, 4 tabs (Overview, By Contract, Rebate Progress, By Category)
- `/vendor/purchase-orders` -- PO table with stat cards
- `/vendor/invoices` -- invoice list with 7 status tabs (All, Draft, Submitted, Validated, Disputed, Approved, Paid)
- `/vendor/renewals` -- renewal pipeline
- `/vendor/reports` -- reports view
- `/vendor/alerts` -- 2 tabs (Active, Resolved)
- `/vendor/ai-agent` -- chat interface
- `/vendor/settings` -- 6 tabs (Profile, Notifications, Organization, Connections, Billing, AI Credits)

### Admin Portal (6 pages)
- `/admin` -- 4 stat cards, pending actions, quick actions, activity feed (at `/admin/dashboard` in prod)
- `/admin/users` -- user table with All/Facility/Vendor/Admin tabs, CRUD dialogs
- `/admin/vendors` -- vendor table (Vendor, Category, Status, Reps, Contracts, Created)
- `/admin/facilities` -- facility table (Facility, Location, Status, Users, Contracts, Created)
- `/admin/billing` -- subscription card, recent invoices
- `/admin/payor-contracts` -- 4 stat cards, contract table with CPT rates
