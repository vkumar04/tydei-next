# Oracle: rebate-forecast — PASS

**Run:** 2026-04-27T01:54:30.540Z
**Duration:** 1ms
**Checks:** 18/18 passed

## Results

- ✅ **[spend_rebate only (baseline)] forecast has 12 monthly points**
  - got 12
- ✅ **[spend_rebate only (baseline)] history points are flagged isForecast=false**
  - 0 of 18 wrongly flagged forecast
- ✅ **[spend_rebate only (baseline)] forecast points are flagged isForecast=true**
  - 0 of 12 wrongly flagged history
- ✅ **[spend_rebate only (baseline)] forecast spend ≥ 50% of trailing extrapolation**
  - app=$938893 oracle-min=$364413 (trailing-avg=$60735/mo)
- ✅ **[spend_rebate only (baseline)] forecast rebate sum is non-zero (PR #82 silent-zero detector)**
  - app rebate sum=$30679.92 (spend sum=$938893)
- ✅ **[spend_rebate only (baseline)] cumulativeYtdSpend resets across year boundaries**
  - cumulative YTD spend should reset at Jan and never decrease within a year
- ✅ **[volume_rebate first + spend_rebate second (PR #82 regression)] forecast has 12 monthly points**
  - got 12
- ✅ **[volume_rebate first + spend_rebate second (PR #82 regression)] history points are flagged isForecast=false**
  - 0 of 18 wrongly flagged forecast
- ✅ **[volume_rebate first + spend_rebate second (PR #82 regression)] forecast points are flagged isForecast=true**
  - 0 of 12 wrongly flagged history
- ✅ **[volume_rebate first + spend_rebate second (PR #82 regression)] forecast spend ≥ 50% of trailing extrapolation**
  - app=$938893 oracle-min=$364413 (trailing-avg=$60735/mo)
- ✅ **[volume_rebate first + spend_rebate second (PR #82 regression)] forecast rebate sum is non-zero (PR #82 silent-zero detector)**
  - app rebate sum=$30679.92 (spend sum=$938893)
- ✅ **[volume_rebate first + spend_rebate second (PR #82 regression)] cumulativeYtdSpend resets across year boundaries**
  - cumulative YTD spend should reset at Jan and never decrease within a year
- ✅ **[no spend_rebate term (engine falls back to first w/ tiers)] forecast has 12 monthly points**
  - got 12
- ✅ **[no spend_rebate term (engine falls back to first w/ tiers)] history points are flagged isForecast=false**
  - 0 of 18 wrongly flagged forecast
- ✅ **[no spend_rebate term (engine falls back to first w/ tiers)] forecast points are flagged isForecast=true**
  - 0 of 12 wrongly flagged history
- ✅ **[no spend_rebate term (engine falls back to first w/ tiers)] forecast spend ≥ 50% of trailing extrapolation**
  - app=$938893 oracle-min=$364413 (trailing-avg=$60735/mo)
- ✅ **[no spend_rebate term (engine falls back to first w/ tiers)] cumulativeYtdSpend resets across year boundaries**
  - cumulative YTD spend should reset at Jan and never decrease within a year
- ✅ **[<3 months history (engine returns empty)] short-history returns empty forecast**
  - forecast.length=0 history.length=0
