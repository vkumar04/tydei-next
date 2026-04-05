# Business Logic Comparison: v0 Prototype vs Production

Generated: 2026-04-01

---

## 1. Contract Total Calculation

### v0 Logic
**File:** `lib/contract-data-store.ts` (lines 334-353)

`addContractWithCOGEnrichment()` calls `enrichPricingItemsFromCOG()` (lines 433-499) which:
1. Loads all COG records from IndexedDB via `getAllCogRecordsAsync()`
2. Builds a Map keyed by lowercase `vendorItemNo` (or `inventoryNumber`) from COG records
3. For each pricing item, matches by item number and enriches `category` and `description` from COG
4. Does NOT compute a contract total -- the `totalValue` on the contract is set by the caller (manual entry or from the form)
5. The contract's `totalValue` field is passed in as `contractData.totalValue` and defaults to `0` if not provided (line 293)

There is **no automated total-from-pricing computation** in the v0. The total is a user-supplied field.

### Production Logic
**File:** `lib/actions/cog-records.ts` (lines 252-298)

`computePricingVsCOG(vendorId, pricingItems)`:
1. Queries all COG records for the facility + vendor where `vendorItemNo` matches any pricing item's `vendorItemNo`
2. Sums historical `quantity` per `vendorItemNo` into a Map
3. For each pricing item: `projected spend = historical qty * proposed unitPrice`
4. If **zero** items match, falls back to the vendor's total COG `extendedPrice` sum
5. Returns the total projected spend number

This is called from `new-contract-client.tsx` (line 26 imports `computePricingVsCOG`) to set the contract's annual value based on pricing file data.

### Differences
- [ ] **v0 does not compute a contract total from pricing files** -- it relies on user-entered `totalValue`. Production computes projected spend from `historical quantity * proposed price`. This is an **intentional production enhancement**, not a gap.
- [ ] **Matching key:** Both match on `vendorItemNo`. v0 also falls back to `inventoryNumber`; production only uses `vendorItemNo`. Production should add `inventoryNumber` fallback if v0 behavior is desired.
- [ ] **Fallback:** Production falls back to total vendor COG spend when zero items match. v0 has no equivalent fallback for total calculation (since it doesn't compute one).

---

## 2. COG Data Processing

### v0 Logic
**File:** `lib/cog-data-store.ts` (lines 1-580+)

**Storage:** IndexedDB (`tydei_cog_database`) with in-memory cache. Two object stores: `cog_records` and `cog_files`.

**COGRecord interface** (lines 156-178): Has fields `poNumber`, `poDate`, `inventoryNumber`, `inventoryDescription`, `vendorItemNo`, `vendor`, `uom`, `quantity`, `unitCost`, `extendedPrice`, `hasContractPricing`, `contractPrice`, `savings`, `surgeonId`, `surgeonName`, `caseNumber`, `contractId`, `category`, `facility`, `sourceRowIndex`.

**Spend aggregation:**
- `calculateVendorSpendTrend(vendorName)` (lines 301-363): Groups by quarter from `poDate`, computes growth rate via half-split comparison, annualizes with `Math.pow(1 + rate, 4) - 1`, clamps to [-20%, +30%]. Projects annual spend as `avgQuarterlySpend * 4 * (1 + growthRate)`.
- `calculateCategorySpendTrend(categories)` (lines 366-425): Groups by month, same half-split growth, annualized with `Math.pow(1 + rate, 12) - 1`.

**Duplicate detection on import** (lines 522-539): Key = `${poNumber}-${poDate}-${inventoryNumber}-${vendor}-${quantity}-${unitCost}`. Uses Set for dedup.

**COG record has `hasContractPricing`, `contractPrice`, `savings` fields** -- these are enriched client-side by matching against contract pricing data stored in localStorage (`tydei_pricing_data`).

### Production Logic
**File:** `lib/actions/cog-records.ts` (lines 1-393)

**Storage:** PostgreSQL via Prisma (`cOGRecord` model). Fields: `facilityId`, `vendorId`, `vendorName`, `inventoryNumber`, `inventoryDescription`, `vendorItemNo`, `manufacturerNo`, `unitCost`, `extendedPrice`, `quantity`, `transactionDate`, `category`, `createdBy`.

**Spend aggregation:**
- `getVendorCOGSpend(vendorId)` (lines 236-243): Simple `aggregate _sum extendedPrice` for vendor.
- `getCOGStats(facilityId)` (lines 345-392): Aggregates totalItems, totalSpend, onContractCount (by non-null category), uniqueVendors.

**Duplicate detection on import** (lines 134-184): Key = `${inventoryNumber}|${transactionDate}|${vendorItemNo}`. Three strategies: `keep_both`, `skip`, `overwrite`. Uses batch lookup + Map.

**ExtendedPrice calculation** (line 114): `record.extendedPrice ?? (record.unitCost * (record.quantity ?? 1))` -- auto-calculates when not provided.

### Differences
- [ ] **v0 COGRecord has extra fields missing in production:** `poNumber`, `poDate` (production uses `transactionDate`), `uom`, `hasContractPricing`, `contractPrice`, `savings`, `surgeonId`, `surgeonName`, `caseNumber`, `contractId`, `facility`, `sourceRowIndex`. Production schema lacks these.
- [ ] **Spend trend computation:** v0 has `calculateVendorSpendTrend` (quarterly growth with half-split regression) and `calculateCategorySpendTrend` (monthly). Production has **no equivalent** -- it only does simple sum aggregation. The trend analysis is entirely missing from production server actions.
- [ ] **Projected spend with growth:** v0's `getProjectedSpend()` (lines 428-471) combines vendor + category trends and projects multi-year spend with compounding. Production has `getFinancialProjections` in `lib/actions/prospective.ts` which uses a simple linear growth model (`monthlySpend * (1 + growthRate * i)`).
- [ ] **Duplicate key:** v0 uses `poNumber-poDate-inventoryNumber-vendor-quantity-unitCost` (6-field composite). Production uses `inventoryNumber|transactionDate|vendorItemNo` (3-field composite). Different dedup granularity.
- [ ] **Contract pricing enrichment:** v0 enriches COG records with `contractPrice` and `savings` by matching against a global `tydei_pricing_data` localStorage store (synced from contracts). Production does **not** store contract price on COG records -- comparison happens at query time via `computePricingVsCOG`.

---

## 3. Case Costing / Reimbursement

### v0 Logic
**File:** `lib/case-data-store.ts` (lines 1-440+)

**Data model:** Complex multi-source linking:
- `CaseRecord` has `supplies: CaseSupply[]` (from clinical system, does NOT affect rebates), `purchaseData: CasePurchase[]` (from purchasing, DOES affect rebates), `payorMix: PayorMix[]`
- Margin = `reimbursement - totalPurchaseCost` (line 111)
- MarginPercent stored on record

**Reimbursement lookup** (`getEstimatedReimbursement`, lines 287-315):
- Takes `cptCode` AND `payorType` (medicare/medicaid/commercial/self-pay) AND optional `specificPayor`
- Medicare: returns `rates.medicare`
- Medicaid: `rates.medicare * 0.72`
- Commercial: looks up specific payor (united/cigna/aetna/bcbs) or returns `commercialAvg`
- Self-pay: `rates.medicare * 2.2`

**Reimbursement rates table** (lines 197-283): Has per-payor columns: `medicare`, `medicarePhysician`, `medicareASC`, `commercialAvg`, `united`, `cigna`, `aetna`, `bcbs`. 60+ CPT codes.

**Reimbursement breakdown** (`getReimbursementBreakdown`, lines 318-331): Splits into `physician` vs `facility` components using Medicare ratio.

**CPT descriptions** (lines 172-191): Separate `cptDescriptions` map.

**Compliance:** Stored as string on CaseRecord (`complianceStatus`), determined at import time.

### Production Logic
**File:** `lib/actions/cases.ts` (lines 1-633) + `lib/national-reimbursement-rates.ts` (lines 1-158)

**Data model:** Prisma `Case` model with `procedures[]` and `supplies[]` relations.
- Margin = `reimburse - spend` (line 267)
- ComplianceStatus stored as string

**Reimbursement lookup** (`estimateReimbursement`, lines 153-157 in `national-reimbursement-rates.ts`):
- Takes ONLY `cptCode` -- **no payor type parameter**
- Always returns `rates.commercialAvg` (or falls back to range-based estimate)
- Has `estimateByRange()` (lines 114-146) for CPT codes not in table

**Reimbursement rates table** (lines 11-108): Has only `medicare`, `commercialAvg`, `description`. Same CPT codes but **missing per-payor breakdown** (no united/cigna/aetna/bcbs) and **missing physician/ASC split**.

**No reimbursement breakdown** function exists.
**No CPT descriptions map** exists (only `description` field in rates table).

**Surgeon scorecards** (lines 330-418): Computes `marginPercent = totalMargin / totalReimbursement * 100`, trend = `marginPercent >= 25 ? "up" : "down"`. Same logic structure as what v0 would compute.

### Differences
- [ ] **CRITICAL: Production `estimateReimbursement` ignores payor type** -- always uses `commercialAvg`. v0 supports medicare/medicaid/commercial/self-pay with different multipliers. This means production overestimates reimbursement for Medicare (uses ~1.8x Medicare rate instead of Medicare) and underestimates for self-pay.
- [ ] **Missing per-payor rates:** Production rates table lacks `united`, `cigna`, `aetna`, `bcbs`, `medicarePhysician`, `medicareASC` columns. The v0 has all of these.
- [ ] **Missing Medicaid multiplier:** v0 uses `medicare * 0.72` for Medicaid. Production has no Medicaid support.
- [ ] **Missing self-pay multiplier:** v0 uses `medicare * 2.2` for self-pay. Production has no self-pay support.
- [ ] **Missing reimbursement breakdown:** v0's `getReimbursementBreakdown()` (physician vs facility split) has no equivalent in production.
- [ ] **Production has range-based fallback:** `estimateByRange()` (lines 114-146) provides estimates for CPT codes not in the lookup table. v0 returns `0` for unknown codes. This is a **production improvement**.
- [ ] **v0 distinguishes clinical supplies from purchasing data** for rebate purposes. Production `CaseSupply` has `isOnContract` but does not separate clinical vs purchasing sources.

---

## 4. Contract Scoring

### v0 Logic
**File:** `components/contracts/contract-score-badge.tsx` (lines 47-70, 234-267)

`calculateContractScore()` formula (6 dimensions, hardcoded weights):

```
potentialRebate = currentSpend * 0.12
rebateEfficiency = min(100, (rebatesEarned / potentialRebate) * 100)

tierAchievement = (currentTier / maxTier) * 70
tierProgress = tierAchievement + 30

marketShareDiff = currentMarketShare - marketShareCommitment
marketShareScore = min(100, max(0, 70 + (marketShareDiff * 3)))

collectionRate = rebatesEarned > 0 ? (rebatesCollected / rebatesEarned) * 100 : 0
pricePerformance = min(100, collectionRate * 0.8 + 20)

compositeScore =
  rebateEfficiency * 0.25 +
  tierProgress * 0.20 +
  marketShareScore * 0.15 +
  pricePerformance * 0.20 +
  complianceRate * 0.10 +
  75 * 0.10  // Default time value
```

**Dimensions:** rebateEfficiency (25%), tierProgress (20%), marketShareScore (15%), pricePerformance (20%), complianceRate (10%), timeValue=75 (10%)

### Production Logic
**File:** `components/facility/contracts/contract-score-client.tsx` (lines 58-194)

Production uses **AI-generated scores** via `DealScoreResult` type (from `lib/ai/schemas`).

The AI returns 5 dimensions: `pricingCompetitiveness`, `rebateEfficiency`, `financialValue`, `marketShareAlignment`, `complianceLikelihood`.

These are mapped to 6 **display** dimensions (line 183-194):
- `pricingCompetitiveness` = AI pricingCompetitiveness
- `rebateStructure` = AI rebateEfficiency
- `contractFlexibility` = avg(financialValue, complianceLikelihood)
- `volumeAlignment` = AI marketShareAlignment
- `marketComparison` = AI financialValue
- `riskAssessment` = AI complianceLikelihood

Recommendation: `>= 80` = strong_accept, `>= 65` = accept, `>= 40` = negotiate, `< 40` = reject

### Differences
- [ ] **CRITICAL: Completely different scoring mechanism.** v0 uses a **deterministic formula** with hardcoded weights and specific inputs (currentSpend, rebatesEarned, etc.). Production uses **AI-generated scores** (Gemini) with no deterministic formula.
- [ ] **Different dimensions:** v0 has rebateEfficiency/tierProgress/marketShare/pricePerformance/compliance/timeValue. Production AI has pricingCompetitiveness/rebateEfficiency/financialValue/marketShareAlignment/complianceLikelihood.
- [ ] **v0's `potentialRebate = currentSpend * 0.12` assumption** is hardcoded. Production has no such assumption -- AI evaluates the actual contract terms.
- [ ] **v0's time value is hardcoded to 75.** Production has no time dimension at all.
- [ ] **Recommendation thresholds differ:** v0 uses 90/80/70/60 for Excellent/Good/Above Avg/Average/Needs Work (display only). Production uses 80/65/40 for strong_accept/accept/negotiate/reject (actionable).
- [ ] **No fallback formula in production:** If AI scoring fails, there is no deterministic fallback. v0 always computes a score.

---

## 5. Pricing File Processing

### v0 Logic
**File:** `components/pricing/pricing-file-upload.tsx` (lines 1-350+)

**File types:** CSV, Excel (.xlsx/.xls), PDF (via valid types check, line 230-232)

**CSV parsing** (lines 276-289): Simple `line.split(',')` -- does NOT handle quoted fields with commas inside.

**Excel parsing** (lines 260-275): Uses `xlsx` library, `XLSX.utils.sheet_to_json` with `{ header: 1 }`.

**Column auto-mapping** (lines 296-332): Inline `if/else` chain matching `lowerHeader.includes(...)` patterns. Checks for `vendor item`, `manufacturer no`, `mfg no`, `description`, `list price`, `contract price`, `unit price`, `effective date`, `expir`, `uom`, `category`, `quantity`, `carve`, `facility`.

**Required fields** (lines 200-213): `vendor_item_no` (required), `product_description` (required), plus optional `manufacturer_no`, `list_price`, `contract_price`, `effective_date`, `expiration_date`, `uom`, `category`, `quantity`, `carve_out`, `facility`.

**Duplicate detection** (lines 102-153):
- Cross-reference: matches import vs existing on `vendor_item_no` AND/OR `manufacturer_no` (case-insensitive)
- Internal: groups by `vendor_item_no` within the file
- Three resolutions: `keep_existing`, `replace`, `keep_both`

**Multi-facility support:** `facility` column detection, `selectedFacility` state.

### Production Logic
**File:** `lib/utils/parse-pricing-file.ts` (lines 1-207)

**File types:** CSV, Excel (.xlsx/.xls) -- no PDF support.

**CSV parsing** (lines 111-143): Proper `parseCSVRow()` function that handles quoted fields, escaped quotes (`""`), etc.

**Excel parsing** (lines 165-178): POSTs to `/api/parse-file` server endpoint.

**Column auto-mapping** (`detectPricingColumnMapping`, lines 23-74): Uses `findHeader()` with exhaustive alias lists via `norm()` (strips all non-alphanumeric). Much more comprehensive alias matching including: `stockno`, `materialid`, `productid`, `vendorpart`, `vendorcatalog`, `referencenumber`, `negotiatedprice`, `agreementprice`, etc.

**Fields:** `vendorItemNo`, `description`, `unitPrice`, `listPrice`, `category`, `uom`. **No** `manufacturer_no`, `effective_date`, `expiration_date`, `quantity`, `carve_out`, `facility`.

**No duplicate detection** -- production parses and returns items without checking for duplicates against existing data.

**Needs-manual-mapping flag** (line 192): Returns `needsManualMapping: true` when `vendorItemNo` or `unitPrice` are not auto-detected.

### Differences
- [ ] **Missing fields in production:** `manufacturer_no`, `effective_date`, `expiration_date`, `quantity`, `carve_out`, `facility` are not parsed. v0 parses all of these.
- [ ] **No duplicate detection in production:** v0 detects duplicates against existing records (cross-reference by vendor_item_no/manufacturer_no) and within the file itself. Production has none.
- [ ] **No PDF support in production:** v0 accepts PDF pricing files. Production only supports CSV/Excel.
- [ ] **Better CSV parsing in production:** Production has a proper quoted-field CSV parser. v0 uses naive `split(',')`.
- [ ] **Better alias matching in production:** Production's `detectPricingColumnMapping` uses normalized string matching with ~30+ aliases per field. v0 uses simpler `includes()` checks.
- [ ] **No multi-facility pricing in production:** v0 supports a `facility` column for facility-specific pricing. Production does not.
- [ ] **No carve-out pricing in production:** v0 supports `carve_out` column. Production does not parse it.

---

## 6. Vendor Matching

### v0 Logic
**File 1:** `components/import/vendor-matcher.tsx` (lines 53-150)

15 hardcoded known vendors with aliases (Stryker, Arthrex, Smith & Nephew, DJO Surgical, Zimmer Biomet, Medtronic, Johnson & Johnson, Boston Scientific, Abbott, Nuvasive, Integra, Conformis, Wright Medical, Lima Corporate, Globus Medical).

**Algorithm** (`calculateSimilarity`, lines 106-124):
1. Exact match = 100
2. Substring containment = 90
3. Levenshtein distance-based: `((maxLen - distance) / maxLen) * 100`

**Matching** (`findBestMatch`, lines 127-150): Checks uploaded name against each vendor's `name` AND all `aliases`. Takes highest confidence score.

**File 2:** `components/cog/vendor-name-matcher.tsx` (lines 114-147)

Different `calculateSimilarity` implementation:
1. Exact match = 100
2. Substring containment = `(shorter / longer) * 100` (NOT fixed 90)
3. Levenshtein distance-based: same formula

Gets known vendors from both the vendor store AND contract system (dynamic, not hardcoded).

### Production Logic
**File:** `lib/vendor-aliases.ts` (lines 1-83)

7 canonical vendors: Stryker, J&J, Medtronic, Arthrex, Smith & Nephew, Zimmer Biomet, Medline.

**Algorithm** (`resolveVendorAlias`, lines 45-56):
1. Case-insensitive exact match against canonical name or any alias
2. Returns canonical name or `null`
3. **No fuzzy matching** -- exact match only

**`matchVendorByAlias`** (lines 62-82): Given vendors list + import name, resolves alias then finds vendor whose `name` or `displayName` matches any canonical or alias name.

### Differences
- [ ] **CRITICAL: Production has NO fuzzy matching** -- only exact alias lookup. v0 uses Levenshtein distance for fuzzy matching. Production will fail to match vendors with typos or variations not in the alias table.
- [ ] **Fewer vendors in production:** 7 canonical vendors vs 15 in v0. Missing: DJO Surgical, Boston Scientific, Abbott, Nuvasive, Integra, Conformis, Wright Medical, Lima Corporate, Globus Medical.
- [ ] **Fewer aliases in production:** e.g., Stryker has 4 aliases in production vs 3 in v0's vendor-matcher (but v0's cog matcher pulls dynamically from vendor store). Production has no `Stryker Spine`.
- [ ] **v0 has two different similarity algorithms:** vendor-matcher.tsx uses `containment = 90` (fixed); vendor-name-matcher.tsx uses `containment = shorter/longer * 100` (proportional). Production has neither.
- [ ] **No confidence scoring in production:** v0 returns a 0-100 confidence score for matches. Production is binary: match or null.
- [ ] **Production missing J&J alias `DePuy`** in separate entry: Production maps "DePuy Synthes" and "DePuy" under J&J. v0 has "DePuy Synthes" under J&J as well, but also has separate entries for DJO which is absent in production.

---

## 7. Deal Scoring / Prospective Analysis

### v0 Logic
**File:** `app/dashboard/analysis/prospective/page.tsx` (lines 152-218)

`calculateProposalScores()` -- 5 dimensions on 0-10 scale:

1. **Cost Savings** (weight 30%): `savingsPercent / 2`, clamped 0-10
2. **Price Competitiveness** (weight 20%): `5 + priceVsMarket / 4`, clamped 0-10
3. **Rebate Attainability** (weight 20%): `(currentSpend / minSpend) * 5`, clamped 0-10
4. **Lock-In Risk** (weight 15%): `10 - penalties` where penalties for: contractLength > 3 (+2), exclusivity (+3), marketShare > 70% (+2), minSpend > 80% totalValue (+2)
5. **Total Cost of Ownership** (weight 15%): Base 6, +2 for priceProtection, +1 for Net 60/90, +1 for volumeDiscount > 5%

**Overall:** weighted sum of all 5 scores (0-10 scale)

**Recommendation** (lines 277-283): `overall >= 7.5 && risks <= 1` = accept, `overall < 4 || risks >= 4` = decline, else negotiate

**COG integration:** Loads COG records client-side, matches pricing items against COG data to compute variance.

### Production Logic
**File:** `lib/actions/prospective.ts` (lines 150-183)

`computeDealScore()` -- 5 dimensions on 0-100 scale:

1. **Financial Value** (weight 30%)
2. **Rebate Efficiency** (weight 15%)
3. **Pricing Competitiveness** (weight 25%)
4. **Market Share Alignment** (weight 15%)
5. **Compliance Likelihood** (weight 15%)

**Overall:** weighted sum (0-100 scale)

**Recommendation** (lines 173-177): `>= 80` = strong_accept, `>= 65` = accept, `< 40` = reject, else negotiate

**In `analyzeProposal()`** (lines 118-125): Auto-generates scores from pricing comparison: `pricingComp = min(100, max(0, savingsPercent * 10 + 50))`. Uses this for both `financialValue` and `pricingCompetitiveness`. Hardcodes `rebateEfficiency: 50`, `marketShareAlignment: 60`, `complianceLikelihood: 70`.

### Differences
- [ ] **Different scale:** v0 uses 0-10, production uses 0-100. Not functionally different but affects display.
- [ ] **Different dimensions:** v0 has costSavings/priceCompetitiveness/rebateAttainability/lockInRisk/TCO. Production has financialValue/rebateEfficiency/pricingCompetitiveness/marketShareAlignment/complianceLikelihood.
- [ ] **v0 has Lock-In Risk scoring** -- considers contract length, exclusivity, market share commitments. Production has **no lock-in risk evaluation**.
- [ ] **v0 has TCO scoring** -- considers price protection, payment terms, volume discount. Production has **no TCO evaluation**.
- [ ] **v0 has Rebate Attainability** based on historical spend vs minimum commitment. Production hardcodes `rebateEfficiency: 50`.
- [ ] **Production hardcodes most scores** in `analyzeProposal`: rebateEfficiency=50, marketShareAlignment=60, complianceLikelihood=70. v0 computes all from actual proposal data.
- [ ] **v0 generates negotiation points and risk warnings** based on score thresholds. Production's `analyzeProposal` does not generate textual recommendations.
- [ ] **Different recommendation thresholds:** v0: accept >= 7.5/10 with <= 1 risk. Production: strong_accept >= 80/100, accept >= 65/100.

---

## 8. Forecasting

### v0 Logic
**File:** `lib/forecasting.ts` (lines 1-265)

**Algorithm:** Linear regression with optional seasonal decomposition.

**`linearRegression(data)`** (lines 29-57): Standard OLS on `{x, y}` pairs. Returns slope, intercept, R-squared.

**`calculateSeasonalFactors(data)`** (lines 62-93): Computes average value per month, divides by overall average to get seasonal factor (ratio).

**`generateForecast(historicalData, forecastMonths, useSeasonality)`** (lines 98-197):
1. Sort by date, convert to months-from-start as x-values
2. Fit linear regression
3. If >= 12 data points and useSeasonality=true, compute seasonal factors
4. For each forecast month: `predicted = slope * x + intercept`, multiply by seasonal factor
5. Confidence interval: `stdError = sqrt(1 - r2) * predicted * (1 + i * 0.05)`, bounds = `+/- 1.96 * stdError`
6. Growth rate: `(slope / avgHistorical) * 100 * 12` (annualized)
7. Trend: > 5% = increasing, < -5% = decreasing, else stable

**`forecastRebates(spendForecast, rebateTiers)`** (lines 202-227): Applies rebate tiers to each forecast point based on spend level.

### Production Logic
**File:** `lib/actions/forecasting.ts` (lines 1-122) + `lib/analysis/forecasting.ts` (lines 1-67)

**`linearRegression(values)`** (analysis/forecasting.ts lines 3-39): Takes `number[]` only (no x,y pairs -- uses array index as x). Same OLS formula. Returns slope, intercept, R-squared.

**`seasonalDecompose(values, seasonLength=12)`** (analysis/forecasting.ts lines 44-66): De-trends data first (`v - (slope * i + intercept)`), then averages residuals by season index. Returns additive seasonal component (NOT multiplicative ratio like v0).

**`buildForecast(labels, values, forecastPeriods)`** (actions/forecasting.ts lines 74-121):
1. Requires >= 3 values (vs v0's >= 1)
2. Linear regression on values
3. Seasonal decomposition
4. Forecast: `baseValue = slope * idx + intercept + seasonalFactor` (additive)
5. Confidence interval: fixed `+/- 10%` of forecast value
6. Returns trend (slope), R-squared

**Data source:** Reads from `contractPeriod` table (totalSpend, rebateEarned).

### Differences
- [ ] **Seasonal model is different:** v0 uses **multiplicative** seasonality (factor is a ratio, applied by multiplication). Production uses **additive** seasonality (factor is a residual, applied by addition). This can produce significantly different forecasts when values have high variance.
- [ ] **Confidence intervals differ:** v0 widens confidence as forecast extends into future (`1 + i * 0.05` per month) and uses `1.96 * stdError`. Production uses fixed `+/- 10%` of forecast value regardless of forecast horizon. Production's intervals are less statistically rigorous.
- [ ] **Minimum data requirement:** v0 works with any amount of data. Production requires >= 3 data points.
- [ ] **Rebate forecasting:** v0 has `forecastRebates()` which applies tier-based rebate percentages to spend forecasts. Production has a separate `getRebateForecast()` that reads historical rebate data from DB and forecasts that directly (no tier application).
- [ ] **Growth rate reporting:** v0 reports annualized growth rate (`(slope/avg)*100*12`). Production reports raw slope only.
- [ ] **Trend classification:** v0 classifies trend as increasing/decreasing/stable (> 5%/< -5%). Production does not classify trend.

---

## 9. Alert Generation

### v0 Logic
**File:** `lib/alert-store.ts` (lines 1-211)

**Alert types:** `off_contract`, `expiring_contract`, `tier_threshold`, `rebate_due`, `pricing_error`, `contract_expiry`, `compliance`, `rebate`

**Storage:** Client-side localStorage. Initial alerts array is **empty** (line 41) -- alerts are generated dynamically from system events.

**No trigger logic exists in this file.** The v0 alert store is purely a client-side state management layer (useAlerts hook). Alert generation happens in other components when they detect conditions (not centralized).

**State management:** useAlerts hook with hydration from localStorage, cross-tab sync via StorageEvent, same-tab sync via CustomEvent, resolve/dismiss persistence.

### Production Logic
**File:** `lib/alerts/generate-alerts.ts` (lines 1-239)

**Alert types used:** `expiring_contract`, `tier_threshold`, `off_contract`, `rebate_due`

**Four centralized generation functions:**

1. **`generateExpiringContractAlerts(facilityId)`** (lines 19-70): Checks 30/60/90-day windows. Queries active contracts with expiration in window. Severity: 30d=high, 60d=medium, 90d=low. De-dupes against existing alerts.

2. **`generateTierThresholdAlerts(facilityId)`** (lines 74-130): Queries contracts with terms+tiers. Compares currentSpend from latest period against tier thresholds. Alerts when within 10% of next tier (`pctOfThreshold <= 0.1`). Severity: medium.

3. **`generateOffContractAlerts(facilityId)`** (lines 134-188): Queries PurchaseOrders where `isOffContract=true` in last 30 days. Groups by vendor. Severity: >$50k=high, >$10k=medium, else low.

4. **`generateRebateDueAlerts(facilityId)`** (lines 192-238): Queries contractPeriods where `rebateEarned > 0` and `rebateCollected = 0` and period ending within 30 days. Severity: medium.

**Storage:** PostgreSQL `alert` table. De-duplication by checking existing alerts with matching type/entity/status.

### Differences
- [ ] **v0 has no centralized alert generation logic.** The alert store is just a state container. Production has 4 server-side generators with real DB queries.
- [ ] **Missing alert types in production:** v0 defines `pricing_error`, `contract_expiry` (separate from `expiring_contract`), `compliance`, `rebate` (generic). Production only implements `expiring_contract`, `tier_threshold`, `off_contract`, `rebate_due`.
- [ ] **Production alerts are server-generated and de-duplicated** against existing DB alerts. v0 alerts are ephemeral client-side state.
- [ ] **Off-contract detection:** Production queries `PurchaseOrder.isOffContract`. v0 would need COG data matching to detect off-contract purchases -- no such logic exists in the alert store.
- [ ] **Tier threshold proximity:** Production uses 10% proximity threshold. v0 has no equivalent centralized tier proximity check.

---

## 10. Contract Term Type Handling

### v0 Logic
**File:** `components/contracts/contract-terms-entry.tsx` (lines 57-67, 76-100, 180-249)

**Term types** (10 types):
`spend_rebate`, `volume_rebate`, `price_reduction`, `market_share`, `market_share_price_reduction`, `capitated_price_reduction`, `capitated_pricing_rebate`, `po_rebate`, `carve_out`, `payment_rebate`

**Rebate types** (5 types):
`percent_of_spend`, `fixed_rebate`, `fixed_rebate_per_unit`, `per_procedure_rebate`, `rebate_per_use`

**Tier structure** (`ContractTermTier`, lines 80-92):
`tierNumber`, `spendMin?`, `spendMax?`, `volumeMin?`, `volumeMax?`, `marketShareMin?`, `marketShareMax?`, `growthPercent?`, `rebateType`, `rebateValue`, `priceReductionPercent?`

**ContractTerm interface** (lines 185-249) has extensive fields:
- Baseline: `baselineType`, `spendBaseline`, `spendBaselineIncludedInCalc`, `spendBaselineRolling`, `growthBaselineIncludedInCalc`, `growthBaselineRolling`
- Market share: `marketShareCalcType`, `marketShareCategory`, `desiredRebatePercent`, `currentMarketShare`, `spendToHitTarget`
- PO rebate: `poSubmissionDeadline`, `poOnTimeThreshold`, `poRebateType`, `poRebateValue`
- Carve out: `carveOutProducts[]`, `carveOutCapital[]`, `carveOutContractTotal`, etc.
- Payment rebate: `paymentTermDays`, `earlyPaymentTiers[]`
- Capitated: `capitatedProcedures[]` with compliance warnings

### Production Logic
**File:** `lib/generated/zod/index.ts` (line 204) + `lib/validators/contract-terms.ts` + `components/contracts/contract-terms-entry.tsx`

**Term types** (14 types from Prisma enum):
`spend_rebate`, `volume_rebate`, `price_reduction`, `market_share`, `market_share_price_reduction`, `capitated_price_reduction`, `capitated_pricing_rebate`, `po_rebate`, `carve_out`, `payment_rebate`, `growth_rebate`, `compliance_rebate`, `fixed_fee`, `locked_pricing`

**Rebate types** (4 types from Prisma enum):
`percent_of_spend`, `fixed_rebate`, `fixed_rebate_per_unit`, `per_procedure_rebate`

**Tier structure** (`TierInput` from contract-terms.ts, lines 11-22):
`tierNumber`, `spendMin`, `spendMax?`, `volumeMin?`, `volumeMax?`, `marketShareMin?`, `marketShareMax?`, `rebateType`, `rebateValue`

**Term form schema** (`TermFormValues` from contract-terms.ts, lines 56-74):
`termName`, `termType`, `baselineType`, `evaluationPeriod`, `paymentTiming`, `appliesTo`, `effectiveStart`, `effectiveEnd`, `volumeType?`, `spendBaseline?`, `volumeBaseline?`, `growthBaselinePercent?`, `desiredMarketShare?`, `tiers[]`

### Differences
- [ ] **Production has 4 extra term types** not in v0: `growth_rebate`, `compliance_rebate`, `fixed_fee`, `locked_pricing`. These are production improvements.
- [ ] **v0 has `rebate_per_use` rebate type** -- production does not have this. Production only has 4 rebate types vs v0's 5.
- [ ] **Missing tier field in production:** v0's `ContractTermTier` has `growthPercent` and `priceReductionPercent`. Production's `TierInput` does not have these.
- [ ] **Missing baseline configuration in production:** v0 has `spendBaselineIncludedInCalc`, `spendBaselineRolling`, `growthBaselineIncludedInCalc`, `growthBaselineRolling` for controlling whether baseline is subtracted or included, and whether it rolls forward. Production has none of these.
- [ ] **Missing PO rebate fields in production:** v0 has `poSubmissionDeadline`, `poOnTimeThreshold`, `poRebateType`, `poRebateValue`. Production term form does not expose these.
- [ ] **Missing carve-out tracking in production:** v0 has `CarveOutProduct[]` with per-product carve-out percentages, `CarveOutCapital[]` for capital paydown tracking, contribution tracking, estimated completion dates. Production has no carve-out-specific fields in the term form.
- [ ] **Missing payment rebate fields in production:** v0 has `paymentTermDays` and `earlyPaymentTiers[]` (pay-within-X-days for Y% discount). Production has no equivalent.
- [ ] **Missing capitated procedure tracking in production:** v0 has `capitatedProcedures[]` with compliance warnings, SMS/email notifications, surgeon tracking. Production has no equivalent beyond the term type existing.
- [ ] **Missing market share calculation fields in production:** v0 has `marketShareCalcType`, `marketShareCategory`, `currentMarketShare`, `spendToHitTarget`. Production form only has `desiredMarketShare`.

---

## Summary of Critical Gaps (Production Missing from v0)

| # | Gap | Severity |
|---|-----|----------|
| 1 | Reimbursement ignores payor type (always uses commercialAvg) | HIGH |
| 2 | No fuzzy vendor matching (only exact alias lookup) | HIGH |
| 3 | Contract scoring is AI-only with no deterministic fallback | MEDIUM |
| 4 | Missing per-payor reimbursement rates (united/cigna/aetna/bcbs) | MEDIUM |
| 5 | Forecasting uses additive vs multiplicative seasonality | MEDIUM |
| 6 | Confidence intervals are fixed 10% vs statistically widening | MEDIUM |
| 7 | Deal scoring hardcodes most dimension scores | MEDIUM |
| 8 | No lock-in risk or TCO scoring in prospective analysis | MEDIUM |
| 9 | No duplicate detection in pricing file import | MEDIUM |
| 10 | Missing pricing file fields (manufacturer_no, carve_out, facility, dates) | MEDIUM |
| 11 | COG spend trend analysis entirely missing | MEDIUM |
| 12 | Missing baseline rolling/inclusion config for contract terms | MEDIUM |
| 13 | Missing carve-out capital tracking | MEDIUM |
| 14 | Missing PO rebate, payment rebate, capitated procedure fields | MEDIUM |
| 15 | Vendor alias table has 7 vendors vs 15 | LOW |
| 16 | Missing `rebate_per_use` rebate type | LOW |
| 17 | COG duplicate key uses different fields (3 vs 6 fields) | LOW |

## Production Improvements Over v0

| # | Improvement |
|---|------------|
| 1 | Range-based CPT fallback for unknown codes (`estimateByRange`) |
| 2 | Proper quoted-field CSV parser |
| 3 | Broader header alias matching for pricing files |
| 4 | Server-side alert generation with de-duplication |
| 5 | 4 additional contract term types (growth_rebate, compliance_rebate, fixed_fee, locked_pricing) |
| 6 | Auto-compute contract total from pricing vs COG |
| 7 | Batch import with configurable duplicate strategy (keep_both/skip/overwrite) |
