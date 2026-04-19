# Contracts Full QA Sweep — Consolidated Report (2026-04-19)

Source plan: `docs/superpowers/plans/2026-04-19-contracts-qa-sweep.md`. 6 read-only subagents dispatched in parallel.

---

## Sub6 — Contract Score Page (AI + rule-based + benchmark)

**Verdict:** PAGE IS BROKEN — user flag confirmed. 1 P0, 2 P1, 2 P2.

### BUG-score-1 (P0): AI `dealScoreSchema` rejected by Anthropic → whole page errors

- **File:** `lib/ai/schemas.ts:187-210`
- **Symptom:** User opens `/dashboard/contracts/[id]/score`; client fires `POST /api/ai/score-deal`; endpoint returns 500 every time; client shows "Scoring Failed" error card that HIDES the rule-based radar + benchmark + margin + tabs.
- **Root cause:** `dealScoreSchema` uses Zod `.min(0).max(100)` on numeric fields. Vercel AI SDK's Anthropic adapter converts these to JSON-Schema `minimum`/`maximum`, which Anthropic's Messages API rejects:
  ```
  APICallError: output_config.format.schema: For 'number' type,
  properties maximum, minimum are not supported  (status 400)
  ```
- **Repro:** `curl -s -b /tmp/c.txt -X POST http://localhost:3000/api/ai/score-deal -H "Content-Type: application/json" -d '{...}'` → 500 `{"error":"Scoring failed"}`. Direct SDK repro also 400.
- **Fix sketch:** Drop `.min(0).max(100)` from numeric fields in `dealScoreSchema` (and grep for the same pattern elsewhere — any schema fed to Anthropic structured output). Move the 0-100 guidance into `.describe()` and clamp server-side with `Math.max(0, Math.min(100, ...))`.

### BUG-score-2 (P1): Rule-based radar hidden behind AI failure

- **File:** `components/facility/contracts/contract-score-client.tsx:404`
- **Symptom:** Even after BUG-score-1 is fixed, a transient Anthropic outage (rate limit, 5xx) hides all non-AI content — rule-based radar, benchmark overlay, margin card, KPI tabs.
- **Root cause:** Early return on `if (error || !aiScore || !dimensions)` blocks everything below the AI section.
- **Fix sketch:** Localize the "Scoring Failed" message to the AI-overall-score region only. Render `ruleBasedComponents` + `benchmark` unconditionally since they're server-computed props.

### BUG-score-3 (P1): Error message swallows debugging signal

- **File:** `app/api/ai/score-deal/route.ts:60-63`
- **Symptom:** `console.error(error)` logs the real `APICallError`, but response body is always `{"error":"Scoring failed"}`. Saves no time for the developer seeing 500s.
- **Fix sketch:** In non-production, include `error.message` in the response body. Guard by `process.env.NODE_ENV !== "production"`.

### BUG-score-4 (P2): `priceCompetitivenessScore` missing from radar

- **File:** `components/contracts/contract-score-radar.tsx:54-80`
- **Symptom:** Engine returns 6 components but the radar's internal `data` array only lists 5. The 6th dimension added in commit `0ea0165` was never wired into the radar.
- **Fix sketch:** Add `{dim: "Price Competitiveness", value: components.priceCompetitivenessScore}` to the data array.

### BUG-score-5 (P2): No test coverage on `/api/ai/score-deal`

- No `tests/**/*.spec.ts` exercises this route, schema, or client error path.
- **Fix sketch:** Contract test that builds the schema → Anthropic JSON-schema validator, catches the P0 at CI.

### Surfaces passing cleanly
- Server render 200, 0 digest, `requireFacility()` redirect works.
- `computeContractScoreLive(contractId)` returns all 6 components numeric.
- Hand-computed score matches engine: `overall=45.82, band=F` for the test contract.
- `priceCompetitivenessScore` defaults to 100 when no `InvoicePriceVariance` rows (verified — DB has 0).
- `getScoreBenchmark("usage")` returns full 6-key shape.
- Weights sum to 1.0 as stated.
- scoreBand thresholds match docs: ≥90 A / ≥80 B / ≥70 C / ≥60 D / else F.

---

## Sub1 — Contracts List

**Verdict:** 0 P0, 3 P1, 4 P2. Data-scoping bugs in metrics actions.

### BUG-list-1 (P1): `getContractStats` ignores 3-way facility scope

- **File:** `lib/actions/contracts.ts:346` + `hooks/use-contracts.ts:32-35`
- **Symptom:** Top summary cards (Total Contracts / Value / Rebates Earned) don't change when user switches scope Tabs.
- **Fix sketch:** Plumb `facilityScope` through `useContractStats` + `getContractStats`, reuse the `getContracts` facility-clause builder.

### BUG-list-2 (P1): `getContractMetricsBatch` rebate aggregation leaks across facilities

- **File:** `lib/actions/contracts.ts:484-500`
- **Symptom:** `prisma.rebate.groupBy` + `prisma.contractPeriod.groupBy` filter only `contractId`, not `facilityId`. For shared/multi-facility contracts, current facility's row would double-count partner rebates. Dormant in seed (partner has 0 rebates) but unsafe architecturally.
- **Fix sketch:** Add `facilityId: facility.id` to both `where` clauses (mirrors `getContractStats`).

### BUG-list-3 (P1): Spend fallback uses vendor-wide COG total

- **File:** `lib/actions/contracts.ts:521`
- **Symptom:** When a vendor has ≥2 contracts at the facility, all rows show the same inflated vendor-wide total. Load-bearing today (every COG row has `contractId=null` → every row hits the fallback chain).
- **Fix sketch:** Drop the vendor-wide fallback, or gate it on "vendor has exactly 1 contract for this facility." Prefer `"—"` when attribution is unknown.

### BUG-list-4 (P2): `ContractPeriod.totalSpend` fallback may double-count

- **File:** `lib/actions/contracts.ts:437-444`
- **Symptom:** Some contracts have 24 ContractPeriod rows (12 monthly + 12 billing-month). Sum is 2× the real spend.
- **Fix sketch:** Filter by a canonical period type, or fix the seed, or pick one cadence.

### BUG-list-5 (P2): Rebate column briefly shows `$0` during metrics batch load

- **File:** `components/contracts/contract-columns.tsx:275-286`
- **Symptom:** Initial load: Spend renders "—", but Rebate renders `$0` in green before snapping to the real value.
- **Fix sketch:** Render `"—"` when metricsBatch still loading AND no server-side `rebateEarned` aggregate exists.

### BUG-list-6 (P2): No category filter on the list page

- **File:** `components/contracts/contract-filters.tsx` — zero "categor" references
- **Fix sketch:** Add `<MultiCategoryFilter>`; extend `contractFiltersSchema` with `categoryIds[]`; extend `getContracts` where clause.

### BUG-list-7 (P2): CompareModal has no upper-bound guard

- Defensive only: modal renders any `contracts.length`, relies on caller to clamp to 5.
- **Fix sketch:** `contracts.slice(0, 5)` in `compare-modal.tsx`.

### Surfaces passing cleanly
- Per-row checkbox column, sticky Compare toolbar, 3-way scope URL binding, Download CSV, Scope column badges, Pending Contracts tab.
- Compare-row-builder unit tests pass.
- Render health: all three scope variants HTTP 200, 0 digest.

---

## Sub5 — Contracts Terms + Rebate Calc

**Verdict:** 2 P0, 3 P1, 2 P2. Major issues — Save flow blocked by Prisma validation errors, engine misuses per-unit tiers.

### BUG-terms-1 (P0): `updateContractTerm` spreads non-column fields into Prisma update

- **File:** `lib/actions/contract-terms.ts:80-101`
- **Symptom:** Save on any term with `appliesTo=specific_category` or `specific_items` throws `PrismaClientValidationError: Unknown argument 'scopedCategoryId'`. Term is not persisted.
- **Root cause:** Update destructures only `{ tiers, ...termData }` and passes `termData` straight into `prisma.contractTerm.update({ data })`. `ContractTerm` has no `scopedCategoryId` / `scopedCategoryIds` / `scopedItemNumbers` columns — scoped items live in `ContractTermProduct`, scoped categories in `categories: String[]`. Validator allows them through because `updateTermSchema = createTermSchema.partial()`.
- **Fix sketch:** Mirror `createContractTerm`'s destructure. After the Prisma update: `deleteMany` + `createMany` `ContractTermProduct` rows for `scopedItemNumbers`; merge `scopedCategoryIds` into the `categories` String[] column.

### BUG-terms-2 (P0): `createContractTerm` spreads `scopedCategoryId`/`scopedCategoryIds` into Prisma create

- **File:** `lib/actions/contract-terms.ts:39`
- **Symptom:** Add-new-term → pick Specific Category → Save throws `Unknown argument 'scopedCategoryId'`.
- **Root cause:** Destructures `{ tiers, scopedItemNumbers, ...termData }` but leaves both category-scope fields in `termData`.
- **Fix sketch:** `const { tiers, scopedItemNumbers, scopedCategoryId, scopedCategoryIds, ...termData } = data`; if `scopedCategoryIds?.length` → include `categories: scopedCategoryIds` in the term data.

### BUG-terms-3 (P1): `contract-terms-page-client.tsx` doesn't pass `availableItems`

- **File:** `components/facility/contracts/contract-terms-page-client.tsx:194-199`
- **Symptom:** Specific Items picker shows empty-state "Add a pricing file..." even when the contract has pricing rows.
- **Fix sketch:** Query `ContractPricing` for this contract, map to `VendorItem[]`, pass as `availableItems`.

### BUG-terms-4 (P1): `startEditing` drops tie-in + scoped fields when entering edit mode

- **File:** `components/facility/contracts/contract-terms-page-client.tsx:81-105` + `lib/actions/contract-terms.ts` (`getContractTerms` doesn't `include: { products: true }`)
- **Symptom:** Any previously-saved `scopedItemNumbers`, `capitalCost`, `interestRate`, `termMonths` vanish when the user hits Edit — form opens blank, Save would clobber them.
- **Fix sketch:** Extend `getContractTerms` include to `{ tiers, products }`; extend `startEditing` map to copy tie-in + scope fields; `scopedItemNumbers: t.products.map(p => p.vendorItemNo)`, `scopedCategoryIds: t.categories ?? []`.

### BUG-terms-5 (P1): `computeRebateFromPrismaTiers` scales non-percent tiers as percentages

- **File:** `lib/rebates/calculate.ts:111-119` + `lib/contracts/rebate-method.ts:67`
- **Symptom:** Medtronic Spine tier 3 (`rebateValue=100, rebateType=fixed_rebate_per_unit`) with spend=$750K returns `rebateEarned=$750,000` — engine does `(750000 * 100) / 100 = 750000`, treating a per-unit fee as if it were a rate. Nonsensically inflated.
- **Root cause:** Scaling branch only handles `percent_of_spend`; all other rebateTypes fall through unchanged, but the math engine unconditionally does `(spend * rebateValue) / 100`.
- **Fix sketch:** In `computeRebateFromPrismaTiers`, early-return for non-percent rebateType (0 for unknown types, direct value for `fixed_rebate`, require unit count for `fixed_rebate_per_unit`). OR document the facade as percent-only and route non-percent tiers through `computeRebateFromPrismaTerm` bridge instead. Audit call sites: `dashboard.ts`, `contracts/tie-in.ts`, `contracts/margin.ts`, `contract-periods.ts`.

### BUG-terms-6 (P2): Cumulative-method tier selection when every tier has `spendMin=0`

- **File:** `lib/contracts/rebate-method.ts:60-64`
- **Symptom:** Demo seed has Medtronic Spine + Integra Dural + Smith & Nephew with 3 tiers all at `spendMin=0` / `spendMax=null`. Cumulative engine selects the LAST tier regardless of spend. $0 spend reports tier 3.
- **Fix sketch:** Validate tier configs (reject duplicate `spendMin` like the marginal-method guard does). Separately, fix seed data to have monotonic thresholds.

### BUG-terms-7 (P2): Rebate Value input lacks unit hint for `percent_of_spend`

- **File:** `components/contracts/contract-tier-row.tsx:90-99`
- **Symptom:** User enters "2" thinking 2%, the DB convention stores it as `2` = 200%. No `%` suffix or "0.02 = 2%" helper text.
- **Fix sketch:** Add `%` suffix + helper text keyed to `tier.rebateType`. Either divide by 100 on save, or clarify the input expects a fraction.

### Surfaces passing cleanly
- All 15 TermType enum values render in dropdown (verified against `prisma/schema.prisma:49-65`)
- Plain-English rebate method labels
- Term-type tooltip via `TERM_TYPE_DEFINITIONS`
- Specific-Category multi-select checkbox list
- Tie-in capital fields render conditionally on `contractType === "tie_in"`
- Tier add/remove preserves `tierNumber` renumbering
- Engine percent-scaling unit tests pass (3/3 from commit `97a6554`)
- Cumulative/marginal spec examples verified: `$750K @ 4% = $30K` ✓, `$500K × 2% + $250K × 4% = $20K` ✓
- Tier sort order preserved through save

---

## Sub2 — Contract Create (`/new`)

**Verdict:** 1 P0, 1 P1, 2 P2. PDF upload entirely broken; `isGrouped` silently dropped.

### BUG-new-1 (P0): PDF contract upload via `/api/ai/extract-contract` 100% broken

- **File:** `app/api/ai/extract-contract/route.ts:185-209` + `lib/ai/schemas.ts` (richContractExtractSchema)
- **Symptom:** Every PDF upload → HTTP 502 `"AI extraction unavailable"` + raw SDK error leaked to UI: `"Schemas contains too many parameters with union types (47 parameters with type arrays or anyOf)... limit: 16 parameters with unions."`
- **Root cause:** `richContractExtractSchema` has ~70 `nullable/optional/union` leaf fields. Anthropic rejects tool-input schemas with >16 union-typed parameters. The route uses `Output.object({schema: richContractExtractSchema})` for PDF path; text-path uses the simpler `extractedContractSchema` (and works fine).
- **Fix sketch:** Reduce nullables in `richContractExtractSchema` (make optional fields non-nullable and omit-by-default, or split into narrower sub-schemas). Alternatively route PDF extraction through `extractedContractSchema`.
- **Repro:** Generate stub PDF → `curl -X POST /api/ai/extract-contract -F "file=@/tmp/test.pdf"` → 502.

### BUG-new-2 (P1): `createContract` silently drops `isGrouped`

- **File:** `lib/actions/contracts.ts:541-580`
- **Symptom:** `isGrouped=true` submitted from form → row created with `isGrouped=false` (schema default).
- **Root cause:** Action maps every other field onto `create.data` but omits `isGrouped`. Validator allows it; Prisma column exists. Pure oversight.
- **Fix sketch:** Add `isGrouped: data.isGrouped ?? false` to the `data` block. Check `updateContract` too (related to edit-10 in Sub4).

### BUG-new-3 (P2): `deriveContractTotalFromCOG` sets `totalValue === annualValue`

- **File:** `lib/actions/contracts/derive-from-cog.ts:28-31`
- **Symptom:** Code comment says "last 12 months IS annual" — action returns the SAME number for both `totalValue` and `annualValue`. For a 3-year contract, `totalValue` should be ~3× `annualValue`. Whichever the user meant, the other is wrong.
- **Fix sketch:** Accept `effectiveDate`/`expirationDate` optionally; compute `totalValue = annualValue * termYears`. If dates absent, only fill `annualValue`.

### BUG-new-4 (P2): AI extract error surface leaks raw SDK stack

- **File:** `app/api/ai/extract-contract/route.ts:221-232` + `components/contracts/ai-extract-dialog.tsx:133,143`
- **Symptom:** End user sees `"Schemas contains too many parameters with union types..."` verbatim in the dialog.
- **Fix sketch:** Return a curated user-facing error; log the technical details server-side only. (Self-resolves when BUG-new-1 fixed.)

### Surfaces passing cleanly
- Page HTTP 200, 0 digest, PDF tab is default active
- Text-based AI extract via JSON body works (~1s against real key)
- No demo-mode fallback (commit `a1ec9d2` verified)
- `ExtractedReviewCard` wired in both ai + pdf tabs
- `FacilityMultiSelect`, `GroupedVendorPicker`, `TieInCapitalPicker` all render correctly
- `matchOrCreateVendorId` helper works
- Pricing-file CSV upload flow + category merge
- `createContract` persists tieInCapitalContractId, contractFacilities, contractCategories, additionalFacilityIds correctly
- Suggest-from-COG math correct: Medtronic 12-mo = $689,670 ✓

---

## Sub4 — Contracts Edit

**Verdict:** 0 P0, 5 P1, 8 P2. Save flow silently drops many fields.

### BUG-edit-1 (P1): Existing term field edits never persist — only tiers save

- **File:** `components/contracts/edit-contract-client.tsx:122-124`
- **Symptom:** User edits `termName`, `termType`, dates, `rebateMethod`, etc. on an existing term → Save succeeds → but on refresh, only tier changes persisted; term-level fields reverted.
- **Root cause:** Save loop calls `upsertContractTiers(term.id, term.tiers)` but never calls `updateContractTerm(term.id, ...)` even though the action exists.
- **Fix sketch:** Call `updateContractTerm` for existing terms before/alongside `upsertContractTiers`.

### BUG-edit-2 (P1): `facilityIds = []` leaves `isMultiFacility = true`

- **File:** `lib/actions/contracts.ts:660-668`
- **Symptom:** Clear multi-facility list → join rows deleted but `isMultiFacility` flag stays true. Anywhere reading the flag now mis-labels.
- **Fix sketch:** Move the `isMultiFacility` toggle outside the `length > 0` guard; when empty, set `false`.

### BUG-edit-3 (P1): Empty `categoryIds` leaves stale `productCategoryId`

- **File:** `lib/actions/contracts.ts:670-678`
- **Symptom:** Clear all categories → `ContractProductCategory` rows deleted but legacy `productCategoryId` column still points at old primary. Silent divergence between detail page (shows 0 categories) and productCategory relation (shows old).
- **Fix sketch:** Add `else updateData.productCategory = { disconnect: true }`.

### BUG-edit-4 (P1): Silently materializes empty `ContractProductCategory` on save

- **File:** `components/contracts/edit-contract-client.tsx:61`
- **Symptom:** Opening edit for a legacy contract with `productCategoryId` but empty join → pre-fills `categoryIds` from `[productCategoryId]` fallback → Save writes it. Read-only view produces writes.
- **Fix sketch:** Only derive `categoryIds` from the real join list; don't auto-heal on save.

### BUG-edit-5 (P1): `annualValue` never recomputes in edit mode

- **File:** `components/contracts/contract-form.tsx:249-260`
- **Symptom:** User doubles totalValue → annualValue stays stale.
- **Root cause:** Auto-derive effect early-returns when `current && current !== 0`.
- **Fix sketch:** Track `userTouchedAnnualValue`; recompute when untouched + totalValue/dates change.

### BUG-edit-6 (P2): `null → ""` drift on every save

- **File:** `components/contracts/edit-contract-client.tsx:42,54,55,56` + `lib/actions/contracts.ts:642`
- **Symptom:** `contractNumber`, `description`, `notes`, `gpoAffiliation` coerced `?? ""` on pre-fill; action writes non-undefined → null becomes "".
- **Fix sketch:** Map `""` → `null` in handler before sending.

### BUG-edit-7 (P2): Edit cannot set/change/clear tie-in capital link
- Only the Create flow renders `<TieInCapitalPicker>`. Edit never pre-fills or exposes it; `updateContract` ignores the field.

### BUG-edit-8 (P2): `facilityId` advertised in updateContractSchema but never wired to mutation
- Validator allows; action skips. No-op but misleading.

### BUG-edit-9 (P2): `tieInCapitalValue`/`tieInPayoffMonths` UI fields have no DB home
- Form registers these; validator allows; Prisma `Contract` has neither column; create/update silently drop.

### BUG-edit-10 (P2): `isGrouped` missing from edit pre-fill + update copy-through
- Create sets it (BUG-new-2); edit can't change it.

### BUG-edit-11 (P2): Adding a NEW term during edit may create it with duplicate or missing tiers
- `createContractTerm({...term, contractId})` passes `tiers` but behavior depends on schema validation. Likely inconsistent.

### BUG-edit-12 (P2): Multi-step save non-atomic, success toast fires before all steps complete

- **Fix sketch:** Wrap in a single `saveContractEdit` action using `prisma.$transaction`.

### BUG-edit-13 (P2): No pricing-file replace/append on edit
- Plan spec calls for it; not implemented. Document as deferred or add tab.

### Surfaces passing cleanly
- HTTP 200, 0 digest; `requireFacility` gate works
- Scalar field pre-fill + merge semantics correct (omitted fields preserved)
- `ContractFacility`/`ContractProductCategory` replacement works for non-empty lists
- Score recompute hook runs after update
- `revalidatePath` hits all relevant routes
- COG match-status recompute fires for old + new vendor on vendor change
- Audit log row written with `updatedFields` metadata
- Term deletion works
- `useContract` query invalidation refreshes detail page

---

## Sub3 — Contract Detail + Documents + Amendment

**Verdict:** 1 P0, 6 P1, 6 P2. Document upload UI entirely missing on facility side; client math re-derives values incorrectly.

### BUG-detail-3 (P0): Facility Documents tab has no upload UI

- **File:** `components/contracts/contract-detail-client.tsx:620`
- **Symptom:** Documents tab shows "No documents uploaded yet" with no Upload button. Vendor portal DOES pass `onUpload`; facility portal doesn't. `DocumentUpload` component exists and works — just never imported/rendered here.
- **Fix sketch:** Import `DocumentUpload` in facility detail, wire an `onUpload` callback, add a `createContractDocument` server action (doesn't exist — grep returns nothing).

### BUG-detail-1 (P1): Client re-computes rebateEarned/Collected without temporal gates

- **File:** `components/contracts/contract-detail-client.tsx:89-102`
- **Symptom:** Client computes `rebateModelEarned = sum(contract.rebates[].rebateEarned)` without the `payPeriodEnd ≤ today` filter; `rebateModelCollected` without the `collectionDate != null` gate. Then `Math.max(periodSum, rebateSum)` — double-counts future periods and un-collected rebates.
- **Root cause:** Server action `getContract` already returns correctly-filtered `contract.rebateEarned` + `contract.rebateCollected` (commit `38a2c05`); client ignores the precomputed values and re-derives incorrectly.
- **Expected (Integra Dural Repair):** earned=$99,999.96, collected=$0
- **Actual:** earned=$104,020.20, collected=$82,970.23
- **Fix sketch:** `const rebateEarned = Number(contract.rebateEarned ?? 0); const rebateCollected = Number(contract.rebateCollected ?? 0)`. Drop the period-sum fallback + `Math.max` layer.

### BUG-detail-2 (P1): "Current Spend" uses `periodSpend` not COG-aggregate

- **File:** `components/contracts/contract-detail-client.tsx:76-79,100`
- **Symptom:** Contract with live COG spend but no `ContractPeriod` rollups shows $0. Others undercount.
- **Root cause:** Client does `totalSpend = periodSpend` but `getContract` already returns `currentSpend` from COG aggregate. Client ignores it.
- **Fix sketch:** `const totalSpend = Number(contract.currentSpend ?? 0)`.

### BUG-detail-4 (P1): Amendment 4-stage flow skips "pricing" stage

- **File:** `components/contracts/amendment-extractor.tsx:75-86,322-326`
- **Symptom:** Breadcrumb advertises 4 steps (Upload→Review→Pricing→Confirm). Actual flow: upload → extracting → review → applying → done. `setStage("pricing")` never called; `pricing` stage has no JSX.
- **Fix sketch:** Either implement the pricing stage (split review into fields + line items from `pricingChanges[]`) OR drop "Pricing" from breadcrumb + `Stage` union.

### BUG-detail-5 (P1): Amendment apply silently corrupts totalValue on non-numeric AI output

- **File:** `components/contracts/amendment-extractor.tsx:252-257`
- **Symptom:** AI returns `"$350,000"` → `parseFloat("$350,000") || 0` → `NaN || 0 = 0`; `parseFloat("350,000") = 350`. Contract silently written with corrupted values.
- **Fix sketch:** `const cleaned = change.newValue.replace(/[^\d.-]/g, ""); if (Number.isNaN(parseFloat(cleaned))) throw new Error(...)`.

### BUG-detail-7 (P1): Tie-In Capital card hidden when `terms=[]`

- **File:** `components/contracts/contract-detail-client.tsx:475`
- **Symptom:** Guard requires `contract.terms[0]` to exist; the one seeded tie-in contract has no terms → card never renders. Also on different facility.
- **Fix sketch:** Add empty-state when `contractType=tie_in && !terms[0]` prompting user to add terms.

### BUG-detail-9 (P1): Spend + off-contract filter by `vendorId` only — cross-contract contamination

- **Files:** `lib/actions/contracts.ts:332-338` + `lib/actions/contracts/performance-history.ts:21-28` + `lib/actions/contracts/off-contract-spend.ts:26-54`
- **Symptom:** Facility with 3 Stryker contracts → all 3 detail pages show identical spend/charts.
- **Root cause:** COGRecord filtered by `facilityId+vendorId` only. No `contractId` filter.
- **Fix sketch:** If COGRecord has contractId FK, use it. Otherwise narrow by `productCategoryId`/`contractCategories`. (Cross-reference BUG-list-3.)

### BUG-detail-6 (P2): Amendment apply creates no ContractDocument or audit trail

- Apply only mutates contract fields; doesn't upload the PDF or record the change log.
- **Fix sketch:** After successful `updateContract`, create `ContractDocument` with `type: "amendment"` + `effectiveDate`.

### BUG-detail-8 (P2): Performance chart window uses `effectiveDate` floor, no `expirationDate` ceiling

### BUG-detail-11 (P2): Re-index sends PDF blob as UTF-8 text

- **File:** `components/contracts/contract-documents-list.tsx:47-55`
- **Symptom:** `new TextDecoder("utf-8", {fatal:false}).decode(buf)` on a binary PDF produces gibberish; `ContractDocumentPage` rows are unsearchable.
- **Fix sketch:** Route through a server-side text extractor before indexing.

### BUG-detail-12 (P2): `ContractPerformanceCharts` has no empty state

### BUG-detail-10 (P2): Division-by-zero guard on `totalValue` is good but NaN case not handled

### BUG-detail-13 (P2): `formatDate` needs Decimal/Date verification through `serialize()`

### Seed data gaps (not bugs, but blocks runtime verification)
- 0 `ContractDocument` rows in DB
- 0 contracts with `complianceRate != null`
- 0 contracts with both `marketShareCommitment` + `currentMarketShare`
- 1 tie_in contract but on a different facility + has `terms=[]`
- 0 pending `ContractChangeProposal` rows

### Surfaces passing cleanly
- Contract Details card categories dedup/sort correct
- Off-Contract Spend action math correct (subject to BUG-detail-9)
- Market Share / Compliance card conditionals + thresholds match spec
- Pending Change Proposals render-guard correct
- Tie-In Bundle mode branches (all_or_nothing vs proportional)
- Period selector (renders only when `periods.length >= 2`)
- Tie-In Capital display math: `interestRate * 100` with 2-decimal %, `termMonths` label

---

## Consolidated Triage Matrix

| Severity | Count | Bugs |
|---|---|---|
| **P0** | 3 | new-1 (PDF upload broken), detail-3 (no facility doc upload), score-1 (AI schema rejected) + 2 more in score spec (terms-1/2 both P0) |
| **P1** | 16 | list-1/2/3, new-2, edit-1/2/3/4/5, detail-1/2/4/5/7/9, score-2/3, terms-3/4/5 |
| **P2** | 19 | list-4/5/6/7, new-3/4, edit-6..13, detail-6/8/10/11/12/13, score-4/5, terms-6/7 |
| Also | 2 | score-terms: terms-1 (P0), terms-2 (P0) |

**Total surfaced: ~40 issues across 6 sub-surfaces.**

## Top ship candidates (fix-first priority)

1. **score-1** (P0) — unblocks the entire score page: drop `.min/.max` from `dealScoreSchema`.
2. **terms-1 + terms-2** (P0) — unblocks ALL term Saves: destructure `scopedCategoryId/Ids` + `scopedItemNumbers` out of Prisma create/update payloads.
3. **new-1** (P0) — unblocks PDF upload: reduce nullables in `richContractExtractSchema` or route PDF through `extractedContractSchema`.
4. **detail-3** (P0) — wire `<DocumentUpload>` + create `createContractDocument` action.
5. **detail-1 + detail-2** (P1) — use server-computed `currentSpend/rebateEarned/rebateCollected` directly, stop re-deriving on client.
6. **score-2** (P1) — render rule-based radar + benchmark even when AI fails.
7. **edit-1** (P1) — call `updateContractTerm` in Save loop so term-level edits persist.
8. **list-1** (P1) — plumb `facilityScope` through `getContractStats`.
9. **new-2 + edit-10** (P1) — persist `isGrouped` on create/update.
10. **list-2** (P1) — add `facilityId` to `rebate.groupBy` + `contractPeriod.groupBy` in `getContractMetricsBatch`.
