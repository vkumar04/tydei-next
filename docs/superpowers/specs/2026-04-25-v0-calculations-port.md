# Wire all v0 calculations into the app — spec

**Status:** in-progress
**Origin:** `lib/v0-spec/` ports the v0 calculation library (~30 helpers) but ZERO are consumed by `lib/actions/`, `components/`, or `app/`. They sit as test oracles only. This spec wires them through to user-facing UI + builds the pieces the v0 doc defines but tydei never had.

## Inventory

### Tier-1 (build server action + new UI surface)

1. **Contract Composite Score** (active contracts) — 6-axis radar (rebate efficiency / tier progress / market share / price performance / compliance / time value) → grade A-F. New `/dashboard/contracts/[id]/score` page; ContractScoreCard on contract detail header.
2. **Renewal Risk Score** — 6-factor weighted (days to expiration / compliance / price variance / vendor responsiveness / rebate utilization / open issues) → LOW/MED/HIGH bucket. New card on contract detail.
3. **Spend Concentration (HHI)** — vendor market concentration on the facility's purchases. Index < 1500 = Low, < 2500 = Moderate, ≥ 2500 = High. New tile on dashboard.
4. **Admin Time Savings** — facility-level estimator: contracts × tasks × hours saved/month. New tile on dashboard.
5. **Tie-in Bundle Compliance** — wires `v0TieInAllOrNothing` + `v0TieInProportional` with bonus + accelerator tiers. New card on tie-in contract detail.
6. **Cross-Vendor Tie-in** — wires `v0CrossVendorTieIn` with vendor commitments + facility GPO bonus. New card on tie-in contract detail.
7. **Service SLA Penalty** — wires `v0ServiceSlaPenalty` (response-time + uptime). New card on `service` contract detail.
8. **Per-Purchase Compliance Evaluation** — 5-check audit per purchase with violations list. New `/dashboard/reports/compliance` route.
9. **Rebate Forecast Pipeline** — wires spend forecast → rebate forecast through tier ladder. New card on contract detail.

### Tier-2 (wire existing v0-spec via consolidation; no new UI)

10. **v0RebateUtilization** — render alongside the existing rebate optimizer surface.
11. **v0SurgeonScore / v0CMIAdjustedSpend / v0PeerVariancePct** — wire into case-costing surgeon scorecards.
12. **v0Margins / v0RebateAllocationToProcedure** — wire into case-costing margin views.
13. **v0CogPriceVarianceBand** — wire into the existing price-discrepancy report.
14. **v0SpendTrend** — wire into dashboard charts.
15. **Forecast trend categorization** — augment `buildForecast` to return `'increasing'/'decreasing'/'stable'` + annualized growth rate + confidence (R²-derived) — matches v0's API.

### Tier-3 (defer / already-equivalent)

16. **v0Cumulative / v0Marginal** — already covered by tydei's rebate engine.
17. **v0EarnedAtTier / v0SpendNeededToNextTier / v0RebateOpportunity** — already covered by `lib/actions/contracts/threshold-optimizer.ts` + spend optimizer.
18. **v0StraightLine / v0DecliningBalanceDepreciation** — tydei wires MACRS already; the v0 alternates can stay as oracles.
19. **Quarterly True-Up + Annual Settlement** — `recompute-accrual.ts` already does period reconciliation; surface a label only.
20. **Surgeon demographic breakdowns** — schema doesn't carry payor / BMI / age on Case yet; defer.

## Server-action layout

```
lib/actions/analytics/
  contract-score.ts      — getContractCompositeScore(contractId)
  renewal-risk.ts         — getRenewalRisk(contractId)
  spend-concentration.ts  — getFacilitySpendConcentration()
  admin-time-savings.ts   — getAdminTimeSavings()
  tie-in-compliance.ts    — getTieInCompliance(contractId)
  rebate-forecast.ts      — getRebateForecast(contractId)
  service-sla.ts          — evaluateServiceSla(contractId)
  purchase-compliance.ts  — evaluatePurchaseCompliance({ from, to })
```

Every action gates via `requireFacility()` + `contractOwnershipWhere` (auth-scope-scanner enforces). All math delegates to `lib/v0-spec/` so the parity tests stay the oracle source.

## UI layout

- **Dashboard tiles** (top of `/dashboard/dashboard`):
  - SpendConcentrationCard
  - AdminTimeSavingsCard
- **Contract detail** (`/dashboard/contracts/[id]`):
  - ContractScoreCard (header sublabel + link to /score sub-page)
  - RenewalRiskCard
  - TieInComplianceCard (when tie_in or capital)
  - RebateForecastCard
  - ServiceSlaCard (when service)
- **New sub-page** `/dashboard/contracts/[id]/score`:
  - 6-axis radar chart (recharts)
  - Score weights breakdown
  - Trend over time
- **New report** `/dashboard/reports/compliance`:
  - Per-purchase compliance audit
  - Violations list with severity buckets

## What the agents test

- Each new server action: ownership check; correct math vs the v0 oracle; degenerate cases (zero spend, single tier, no rebates).
- Each new UI surface: renders for the supported contract types, hides for others, no broken imports, accessible via the right portal.
- Cross-cutting: auth-scope scanner stays green; prisma-select scanner stays green; no new dead-field references.
