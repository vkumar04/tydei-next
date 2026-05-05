---
date: 2026-05-04
status: active
topic: tydei-v1-ship
supersedes: all prior specs (deleted in commit e019386)
---

# tydei v1 — ship what works, declare done

## Why this spec exists

Three weeks of subsystem-by-subsystem porting from the v0 prototype
(`/Users/vickkumar/Downloads/b_T2SEkJJdo8w/`) hit a wall. The substrate is solid
(Prisma schema, auth gates, oracle layer, canonical helpers, ~20 server-action
modules with parity tests). The half-built UI tail isn't converging because
"matches v0" is checked manually and never declared done.

This spec stops that loop. The audit on 2026-05-04 confirmed that **most surfaces
already ship**. The remaining pain is ~6 stub buttons across 5 surfaces. Hide
those, run verify, ship v1.

Future v0 parity work, if any, becomes a separate cycle — not a blocker on shipping.

## What's in v1

Every route currently in the app, EXCEPT the deferrals listed below. Specifically:

**Facility portal (`/dashboard/*`):**
- Dashboard, Contracts (list + detail + new + edit + terms + bundles), COG Data,
  Alerts, Analysis (prospective), Case Costing (+ compare + reports),
  Invoice Validation, Purchase Orders, Rebate Optimizer, Renewals, Reports
  (+ compliance + price-discrepancy), Settings, AI Agent (Chat tab only)

**Vendor portal (`/vendor/*`):**
- Dashboard, Contracts (list + new + detail + edit + pending edit), Alerts,
  Invoices, Market Share, Performance, Prospective, Purchase Orders, Renewals,
  Reports, Settings, AI Agent (Chat tab only)

**Admin portal (`/admin/*`):**
- Dashboard, Billing, Facilities, Users, Vendors, Payor Contracts

**Auth + marketing:**
- Login, Sign-up, Sign-up-success, Forgot/Reset password, Error, Landing page

## What's deferred (not in v1, not deleted)

These features stay in the codebase but their entry points are hidden for v1:

| Feature | Where it lives | What we do for v1 |
|---|---|---|
| AI Agent — Documents tab | `components/{facility,vendor}/ai-agent/` | Hide tab, leave Chat-only |
| AI Agent — Reports tab | same | Hide tab, leave Chat-only |
| Invoice Validation — Bulk dispute | `components/facility/invoices/invoice-validation-client.tsx` | Hide button (per-row dispute works) |
| Invoice Validation — Export | same | Hide button |
| Purchase Orders — Scan | `components/facility/purchase-orders/po-list.tsx` | Hide button |
| Purchase Orders — Export | same | Hide button |
| Reports / Price Discrepancy — Export | `app/dashboard/reports/price-discrepancy/page.tsx` | Hide button (it was a fake `toast.success`) |
| Vendor Contract Detail — Document upload | `components/vendor/contracts/vendor-contract-detail-client.tsx` | Hide button |
| Admin Billing — Export Report | `app/admin/billing/page.tsx` | Hide button (no `onClick`) |

## What's explicitly NOT in v1 (cut, not deferred)

Nothing. The audit didn't surface anything that needed cutting outright; just
hiding stub buttons. If during morning testing a surface turns out to be broken
in a way that can't be polished in <30 min, we cut it then — not now.

## Ship criteria

A surface is "v1-ready" when:

1. The page renders without crashing in dev (`bun run dev`)
2. Every visible button does what it claims to do (no `toast.success("...")`
   placeholders, no buttons without handlers)
3. Auth gate is correct (`requireFacility`/`requireVendor`/`requireAdmin`)
4. `bunx tsc --noEmit` is green for the file
5. Any regression test guarding the surface is green (most live in
   `lib/actions/__tests__/`)

The whole repo is "v1-ready" when:

1. `bunx tsc --noEmit` → 0 errors
2. `bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'` → green
3. `rm -rf .next && bun run dev` → starts cleanly, all top-level routes load
4. Every surface in the "What's in v1" list has been smoke-tested per
   `MORNING.md`

## How v1 gets shipped

This spec is the entire spec. There is one corresponding plan
(`docs/superpowers/plans/2026-05-04-v1-polish-plan.md`) that lists the
button-removal commits. After polish is committed and verify is green,
`MORNING.md` at the repo root drives the human smoke test.

If smoke testing surfaces fixable issues, they get bug-fix commits — not new
specs, not new plans. If smoke testing surfaces unfixable-tonight issues, they
get logged in `MORNING.md`'s "known limitations for v1" section and shipped
anyway.

## Future cycles (out of scope for tonight)

These are noted so they don't get lost, but they DO NOT block v1:

- **v0 parity inventory** — earlier draft existed in deleted spec
  `2026-05-04-v0-parity-inventory-design.md` (recoverable from git history).
  Revisit after v1 is shipped if customers ask for v0-only features.
- **Documents/Reports AI Agent tabs** — real implementations, not stubs. Pick up
  in a future cycle.
- **Bulk dispute, Export buttons** — real implementations.
- **Document upload (vendor contracts)** — real implementation.
