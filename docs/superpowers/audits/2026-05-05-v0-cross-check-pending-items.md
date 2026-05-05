---
date: 2026-05-05
scope: v0 cross-check for the 4 pending items in MORNING.md
---

# v0 cross-check — wire vs delete decisions

Read-only check of `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/` to decide whether
each pending tydei item is product-needed (wire) or pure engine cruft (delete).

## Item 1 — Per-type rebate engines

v0's `lib/types.ts` defines `TermType` with the same shapes tydei has, and
`components/contracts/contract-terms-entry.tsx` exposes every type in one
`<Select>` driven by `TERM_TYPES` (lines 260-311). v0's PDF importer
(`app/api/parse-contract-pdf/route.ts`) extracts the same enum. No real engine
exists in v0 — case-costing fakes math with a flat 4% — but the user-facing
surface is real: facility users can create any of these types today.

| Type | v0 data model | v0 create UI | v0 display UI | Verdict |
|---|---|---|---|---|
| SPEND_REBATE | yes (`spend_rebate` TermType) | yes (term-entry select) | yes (contract detail) | WIRE |
| VOLUME_REBATE | yes (`volume_rebate`) | yes | yes | WIRE |
| TIER_PRICE_REDUCTION | yes (`price_reduction`) | yes | yes | WIRE |
| MARKET_SHARE_REBATE | yes (`market_share`) | yes (with calc-type + category) | yes | WIRE |
| MARKET_SHARE_PRICE_REDUCTION | yes (`market_share_price_reduction`) | yes | yes | WIRE |
| CAPITATED | yes (`capitated_pricing_rebate` + `capitated_price_reduction`, with `capitatedProcedures[]`) | yes (full procedure-cap UI, lines 2020-2390) | yes | WIRE |
| TIE_IN_CAPITAL | yes (`ContractType='tie_in'` + `LeasedServiceItem` w/ `paymentSchedule[]` in `tie-in-contract-details.tsx`) | yes (dedicated leased-service UI) | yes | WIRE |

### Notes
- v0 also has `po_rebate` + `payment_rebate` (out of scope here — flag for
  later; they're real product surface).
- v0's `capitated_*` UI carries per-procedure cap prices, baselines, tiers,
  compliance warnings — richer than tydei's current `capitated.ts` signature.
  Wiring will require widening the engine input.
- v0 `tie_in` carries `LeasedServiceItem` w/ `paymentSchedule[]` — same shape
  tydei's `tie-in-capital.ts` produces. Gap is just the UI consumer.

## Item 2 — `allocateRebatesToProcedures` (true-margin)

- **What v0 has:** `app/dashboard/case-costing/reports/page.tsx` aggregates
  `proc.totalRebate += c.rebateContribution` per procedure code (line 239),
  and the surgeon-performance UI computes `grossMargin = totalPayments -
  totalSpend + rebateContribution` (line 301). The selected-surgeon panel
  surfaces "Rebate Contribution" + "Net Margin" cards (lines 3014-3037).
  v0's allocation is naive (flat 4% applied to on-contract spend, line 1551 +
  `Math.round(s.totalSpend * 0.02)` on line 842) but the UI shape — per-case
  and per-procedure rebate contribution feeding margin — is exactly what
  `allocateRebatesToProcedures` produces.
- **Verdict: WIRE.** v0 ships this surface; tydei's helper is the real
  implementation v0 stubbed. Wire it into the existing case-costing
  reports/surgeon panel.

## Item 3 — Vendor /reports

- **What v0 has:** `app/vendor/reports/page.tsx` (387 lines) shows 4 report-type
  cards (Performance Summary, Rebate Statement, Spend Analysis, Compliance
  Report), a hardcoded `recentReports` table (5 fake entries), and a "Generate
  Report" dialog with a fake progress bar — NO real data flow, NO PDF/CSV
  output. Same shape tydei already has.
- **Verdict: DEMO ONLY.** Both apps stub it. Reasonable shape to ship: keep
  the 4 report-type cards, replace `defaultRecentReports` with real
  `ContractPeriod` + `Rebate` rollups for the signed-in vendor (one row per
  period × contract), and let "Download" emit a CSV (PDF can wait). The
  leakage card is the one real thing — keep it.

## Item 4 — PDF clause analyzer wiring

- **What v0 has:** `components/contracts/contract-pdf-upload.tsx` and
  `app/api/parse-contract-pdf/route.ts` do **field extraction** (vendor name,
  contract type, term types, rebate %, dates, capitated procedures) via
  AI Gateway + Zod schema — NOT clause-risk analysis. The
  `app/dashboard/analysis/prospective/page.tsx` page does upload a PDF and
  then surface a `risks: string[]` list, but those risks are derived from
  rule-based scoring on the EXTRACTED FIELDS (exclusivity flag, market-share
  commitment, term length, no price protection — lines 256-273), not from
  clause text. There is NO clause-by-clause LLM analyzer anywhere in v0.
- **Verdict: DEMO ONLY.** v0 has the upload-and-show-risks shape but not
  tydei's deeper clause-risk analyzer. Wiring sketch: hook
  `analyzeUploadedPDFCanonical` into the existing prospective-analysis upload
  flow so the risk list shown is the AI clause output (not just rule
  derivations from extracted fields), reusing the same dropzone +
  results-panel UI tydei/v0 already share.

## Recommendations summary

| Item | Verdict | Rationale |
|---|---|---|
| 1. Per-type engines (7) | WIRE all 7 | Every type appears in v0's create UI + PDF importer. Real product surface. |
| 2. `allocateRebatesToProcedures` | WIRE | v0 ships per-procedure + per-surgeon "rebate contribution" feeding margin; tydei has the real math, just no consumer. |
| 3. Vendor `/reports` | DEMO ONLY | v0 is also a stub; ship a thin demo (report-type cards + ContractPeriod-driven recent-reports table + CSV download). |
| 4. PDF clause analyzer | DEMO ONLY | v0 has upload + risks-list UI but no clause analyzer; wire `analyzeUploadedPDFCanonical` into the prospective-analysis dropzone as the demo backend. |
