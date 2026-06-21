# 2026-06-21 — Alerts + Notifications e2e refactor

**Trigger:** Vick — dashboard "198 pending" vs empty header badge; "do a full
alert/notification audit e2e and fix it… feel free to refactor to something
modern and practical."

## Diagnosis (3 parallel audits + DB + UX research)
- DB: 283 alerts, ALL `new_alert` (nothing ever resolved). off_contract 168,
  rebate_due 100, expiring 6, tier 5, pricing 4. Notifications: 6.
- Noise: off_contract = per-vendor×per-PO (rollup only when 1 vendor >5 POs);
  rebate_due = per-period. No timed auto-resolve; **dismiss doesn't stick**
  (dedup loader only sees new_alert/read → recreated next run).
- 3 contradictory counters: badge=`new_alert`+excl; dashboard=`new_alert`+`read`,
  NO excl (spend-target pollution); bell=separate Notification table.
- Wiring: dashboard kpiSummary not invalidated by alert mutations + no refetch;
  dead sidebar alert badge; bell uses literal query key; markAlertRead gated by
  requireCanMutate (read-only user auto-mark-read on detail view fails silently).

## Canonical model
ONE meaning: **Open = unresolved (`new_alert`+`read`) with exclusions**. Badge +
dashboard + page all read the same Open count via `openAlertWhere()`.
**Reading ≠ clearing; resolve/dismiss clears.** (modern task-inbox model.)

## Backend
- `lib/alerts/alert-scope.ts`: `openAlertWhere(scope)` + `excludeNonInbox` (spend-
  target + vendor-proposal) — single source. Route getUnreadAlertCount→openCount,
  getAlerts, getVendorAlerts, kpi.ts through it.
- Synthesizer: off_contract ALWAYS per-vendor rollup (count+$+POs meta);
  rebate_due per-contract rollup; dismiss-sticky (load dismissed into dedup set).
- Hooks: alert mutations also invalidate `dashboard.kpiSummary`; `onError` toast
  on mark-read. Remove dead sidebar badge. `queryKeys.notifications.*`.

## UI
- Alerts page = inbox: severity groups, collapsible repetitive groups, filters +
  search, bulk resolve/dismiss/mark-read, per-row $impact/age/entity/actions,
  "All clear" empty state. Notification bell polish.

## Verify
tsc 0; vitest green (alert-severity, synthesizer dedup/rollup, kpi parity);
DB re-query shows off_contract collapsed to ~per-vendor; badge==dashboard count.
</content>
