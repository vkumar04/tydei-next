# Charles Feedback Round 5 — 18 items

> **Triage doc.** Investigate-and-fix rubric is the same as R3/R4.
> Items flagged BUG need ground-truth DB verification before fixing.

## All items (transcribed from the 5 screenshots)

### Bugs — data / display

1. **R5.1** — Contract detail Pricing tab rejects CSVs with unknown columns:
   > "Could not auto-detect columns. Please upload a file with vendor_item_no and contract_price columns, or use the New Contract flow for manual mapping."
   The detail-page upload has NO column mapper fallback; the New Contract flow does. Wire the same mapper here.

2. **R5.6** — Pricing-only contract shows rebates + transactions that were never entered at creation. Likely: seed data wrote Rebate rows against pricing-only contracts incorrectly, OR the transactions tab query doesn't filter by `contractType`.

3. **R5.7** — "Substantial rebate mis calculation." No specific number but Charles saw wrong math. Need the contract ID + a hand-compute. Could be R4.6 edge case or separate engine bug.

4. **R5.8** — "All items being used OFF contract, which is not possible as that is in the contract." All COG rows for a vendor/contract show `off_contract_item` despite the contract existing. Likely `matchCOGRecordToContract` cascade not finding the right contract (or `ContractPricing` rows missing for the items).

5. **R5.9** — "Total value and spend both not coming up." R4.2 fixed currentSpend on the detail card — this is a different surface (probably the reports page OR a newly-created contract with no periods yet).

6. **R5.10** — "Says no rebate earned." Despite R4.3 fixing the filter, Charles still sees $0 somewhere. Likely a different card / different page still sourcing from an unfiltered path.

7. **R5.11** — "Nothing on contract coming up." Unclear which surface. Contracts list? Contract detail's a sub-tab? Need screenshot disambiguation.

8. **R5.12** — "Spend by period and tier achievement not coming up either." Probably the contract performance chart / tier progress card.

9. **R5.13** — "Not letting it tie anything to capital — these contracts are together they are not separated contracts." Tie-in bundle linkage broken: two contracts Charles thinks are bundled together are appearing as separate.

### UX — tooltips / copy

10. **R5.2** — "What's pending?" status badge has no explanation. Add tooltip explaining the lifecycle: draft → pending → active → expired.

11. **R5.3** — "Not sure what 'score' is or how a 'D' was calculated." AI Score letter-grade needs inline tooltip/legend explaining the scale + what feeds the grade (the 6 rule-based axes).

12. **R5.4** — "Contract value is the total spend for the contract during the contract term." Charles is writing the definition he expects; the page should show this as tooltip.

13. **R5.5** — "What are the benchmarks and market average coming from?" Benchmark overlay on score radar chart has no source attribution. Tooltip pointing to the benchmark source.

### Features — net-new

14. **R5.14** — Export pricing items for a contract to CSV. Currently no export button on the Pricing tab.

15. **R5.15** — Export AI score recommendations as a shareable artifact (PDF or CSV).

16. **R5.16** — "Quantity needs to be added." Some field (likely on the pricing upload / contract terms) is missing a quantity column.

17. **R5.17** — "When I add a contract with a category, system needs to map it with others that are there to see if they are meant to be the same in the event that different contracts use different names and mean the same thing." Category fuzzy-matching / alias suggestion when a new category name is entered on a contract and a similar-named category already exists.

### Known gotcha

18. **R5.18** — `/dashboard/contracts/:id/score` throws a Prisma error (caught by R4 verify sweep; not caused by R4). Score page has a latent bug. Separate item; would be a simple fix if bundled with R5.3's tooltip work.

## Proposed wave breakdown

### Wave A — clear bugs (5 items)
- R5.1 (column mapper fallback)
- R5.8 (COG off-contract mis-match)
- R5.13 (tie-in linkage)
- R5.18 (score page 500)
- R5.6 (phantom rebates on pricing-only contract)

### Wave B — data source audits (4 items, likely shared root)
- R5.7 (rebate miscalc)
- R5.9 (total + spend surface)
- R5.10 (rebate earned surface)
- R5.12 (spend by period / tier chart)

### Wave C — UX tooltips (4 items)
- R5.2 (pending badge tooltip)
- R5.3 (score letter-grade tooltip)
- R5.4 (contract value definition tooltip)
- R5.5 (benchmark source tooltip)

### Wave D — features (4 items)
- R5.14 (export pricing CSV)
- R5.15 (export AI score recommendations)
- R5.16 (add quantity field)
- R5.17 (category fuzzy match suggestion)

### Needs screenshot to disambiguate
- R5.11 ("Nothing on contract coming up" — which surface?)

### Bugs surfaced by the second batch (possible R4 follow-ups)

19. **R5.19** — Charles still sees raw Y-axis numbers (`160000`, `120000`) instead of `$160K` on the Monthly Spend chart — R4.5 (`bb32802`) should have fixed this. Either (a) his browser has stale JS chunks, (b) there's a second "Monthly Spend" chart we didn't touch, or (c) the `formatAxisCurrency` helper's threshold skips values below $1M. Verify via `grep -n "formatAxisCurrency\|Monthly Spend" components/**/*.tsx` and visually confirm.

20. **R5.20** — "I entered a rebate collect but it is not showing up" — repeat of R4.4. Either Charles tested before the commit landed, or his rebate entry path is NOT going through `createTransaction(type="rebate")` that we rewired. Check if there's a separate "Add Rebate" dialog that still writes to the wrong table.

21. **R5.21** — **Accrual recompute trigger missing.** R4.6/R4.7 (`3438352`) fixed the ENGINE but when Charles flips `evaluationPeriod` to monthly, no Rebate / ContractPeriod rows are regenerated from the new cadence. The $0 on the card is correct given no Rebate rows exist — but the UX should auto-regenerate (or show a "Recompute rebates" button) after a term save. Find where term saves happen (`lib/actions/contract-terms.ts`) and call the accrual recompute action.

22. **R5.22** — Tier display shows **"Current: Tier 1 - 300.0%"** on a $5.5M tier-1 ceiling with only $4.7M spend. 300% is nonsensical for a progress indicator (should be ~86%) and is a plausible rate value if `rebateValue=3` was misread as a percent instead of as "3 points". Likely a unit-conversion bug on the tier-progress card — either the rate label (misusing `rebateValue` as a percent directly) or the progress denominator.

## Revised wave breakdown

### Wave A — production-blocking data bugs (6 items)
- R5.1 (column mapper fallback)
- R5.6 (phantom rebates on pricing-only contract)
- R5.8 (COG off-contract mis-match)
- R5.13 (tie-in linkage)
- R5.18 (score page 500)
- R5.21 (accrual recompute trigger after term save — unblocks R4.6/R4.7)

### Wave B — data display audits (5 items)
- R5.7 (rebate miscalc — likely resolved by R5.21 + hand-verify)
- R5.9 (total + spend surface)
- R5.10 (rebate earned surface)
- R5.12 (spend by period / tier chart)
- R5.22 (tier 300% display bug)

### Wave C — UX tooltips (4 items)
- R5.2 / R5.3 / R5.4 / R5.5

### Wave D — features (4 items)
- R5.14 / R5.15 / R5.16 / R5.17

### Wave E — Stale-chunk / repeat check (2 items)
- R5.19 (chart clipping repeat — confirm fix is live)
- R5.20 (manual rebate repeat — confirm fix is live)

## Recommended order

**Wave A first** (production-blocking bugs — Charles can't trust the numbers while R5.8 and R5.6 are live). Then **Wave B** (more bugs but trickier scope). Then **Wave C** (tooltips — fast, high ROI for Charles's confusion). **Wave D** last (net-new features).
