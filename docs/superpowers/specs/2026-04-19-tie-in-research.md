# Tie-In Contract Research & Gap Audit

Date: 2026-04-19
Author: research subagent
Status: research / gap-analysis, no code changes

---

## 1. Industry context — how tie-in contracts actually work

In medical-device procurement, a "tie-in" is a paired pair of contracts — one
for **capital equipment** (robot, imaging system, capital infusion pump) and a
second for **usage-driven consumables** (single-use instruments, disposables,
proprietary implants) whose volume amortizes or rebates against the capital
obligation. Vendors use it to lock in recurring high-margin consumable revenue;
hospitals use it to avoid a 6- or 7-figure capex line and convert it to opex.

**Canonical structure (industry reality):**

- **Capital contract:** purchase, lease, or placement of the asset. Typical
  terms 36–60 months, 10–20% down payment is standard when financed, with the
  residual financed at a stated APR [Symplr / CME / SpecialtyCare].
- **Usage / consumables contract:** the hospital commits to buying the vendor's
  proprietary disposables at a negotiated price schedule, often with a
  minimum-purchase commitment per year or per procedure ("disposables in
  exchange for the capital"). [Outpatient Surgery Magazine, Symplr.]
- **Tie-in / pay-down mechanic:** a portion of consumable spend — typically
  3–8% rebate, or a per-procedure credit — is **applied against the capital
  balance** rather than paid in cash. When the facility hits its
  consumable-volume tiers, the capital paydown accelerates. If the facility
  misses the minimum, the vendor bills the shortfall or carries it forward.
- **Placement variant:** vendor "places" the capital at $0 (Stryker Mako-style
  and Intuitive da Vinci-style deals) with zero or negligible down payment, and
  the entire capital value is amortized through consumable spend. The implant /
  disposable price is set above market to fund the paydown.

**Concrete example (illustrative, consistent with Stryker Mako commentary in
MatrixBCG / PortersFiveForce writeups):** a $1.25M Mako install bundled with a
5-year enterprise commitment. Hospital projects 600 joint-replacement
procedures per year at ~$2,200 implant pull-through = $1.32M/yr consumable
spend. A 4% tie-in rebate credits $52,800/yr against the capital balance.
Combined with a 10% down payment, the capital is paid off inside year 4; years
4–5 produce true cash rebates.

**Fields a real tie-in contract captures:**

1. Capital cost, interest rate, term (months), payment cadence
   (monthly/quarterly/annual), down payment
2. Consumable/implant price schedule + minimum-purchase commitment
3. Rebate tiers on consumable spend (volume or % of spend)
4. Shortfall policy: bill immediately vs. carry forward
5. Buyout clause, renewal / evergreen language, exclusivity scope
6. Bundle-compliance rules when multiple product lines are tied together

**Typical facility reporting needs:**
- Current capital balance remaining
- Rebate-to-date applied against capital (paydown so far)
- Projected payoff date given run-rate consumable volume
- Amortization schedule with per-period opening/interest/principal/closing
- Shortfall alerts when consumable run-rate lags the min commitment
- Compliance dashboard across all bundled contracts

*Sources:* Symplr capital-equipment overview; CME Corp blog on buying capital
equipment; Outpatient Surgery Magazine "Make Your Capital Spending Count";
SpecialtyCare perfusion lease structures; MatrixBCG/PortersFiveForce
commentary on Stryker Mako monetization; Incentive Insights on DME rebate
programs. Primary vendor agreements (Stryker, Intuitive, Medtronic) are behind
NDA — industry commentary corroborates the structure but specific rebate
percentages vary per deal.

---

## 2. v0 prototype implementation

v0 treats tie-in as its own `contractType` and ships a single-page editor, but
with a **placement / lease** framing rather than a true pay-down.

**Inventory:**
- `app/dashboard/contracts/new/page.tsx:60` — imports
  `TieInContractDetails`; lines 1383–1387 render the editor when
  `contractType === 'tie_in'`.
- `components/contracts/tie-in-contract-details.tsx` (full module) — defines:
  - `LeasedServiceItem` with `contractTotal`, `initialSales`, `interestRate`,
    `paymentType: fixed|variable`, `paymentPeriod: monthly|quarterly|
    semi_annual|annual`, and a generated `paymentSchedule: PaymentPeriod[]`
    (lines 57–75).
  - `TieInRebateTerm` with `rebateCategory: volume|po|spend`, baseline types,
    and tiered rebates per category (lines 82–113).
  - `TieInContractConfig` wraps `{capitalDetails, rebateTerms: {volumeRebate,
    poRebate, spendRebate}}` (line 115).
- `docs/contract-calculations.md:276-400` — spec of the three compliance
  modes: all-or-nothing, proportional, plus an "accelerator" (1.2× /
  1.5× minimum exceedance tiers).
- `lib/types.ts:103` — persists `tie_in_capital_contract_id` (single link,
  not a bundle table).

**What v0 got right:**
- Captures `capitalCost` (contractTotal), `interestRate`, and payment cadence
  per item.
- Auto-generates a payment schedule in the UI from start/end + cadence.
- Splits rebate terms by category (volume / PO / spend) which mirrors how GPO
  agreements actually slice rebates.
- Documents three compliance modes with explicit math.

**What v0 got wrong:**
- Data model is localStorage-only, no FK integrity, no per-period persistence.
- The "paymentSchedule" is a cosmetic array with `amountOwed` set to 0 for
  fixed payments (line 192) — no real PMT math, no interest accrual.
- No link from consumable rebate → capital paydown. The rebate section and the
  capital section are side-by-side but never interact; a rebate dollar never
  reduces the capital balance.
- No shortfall policy, no true-up, no payoff projection.
- `tie_in_capital_contract_id` is a single FK; can't model multi-member bundles
  despite the doc describing bundle compliance.

---

## 3. tydei-next current state

tydei has **two parallel tie-in systems** — a **bundle** system (compliance
across linked contracts) and a **capital amortization** engine — that do not
yet talk to each other in the UI.

**Schema (`prisma/schema.prisma`):**
- `Contract.contractType: tie_in` enum value (line 36).
- `Contract.tieInCapitalContractId: String?` (line 578) — single-link FK to
  the paired capital contract.
- `ContractTerm.capitalCost`, `interestRate`, `termMonths` (lines 672–674) —
  the capital-payoff inputs live on the term, gated by contractType.
- `ContractAmortizationSchedule` table (lines 720–737) with
  `openingBalance`, `interestCharge`, `principalDue`, `amortizationDue`,
  `closingBalance`, keyed `(termId, periodNumber)`.
- `TieInBundle` (lines 904–916): `primaryContractId`, `complianceMode`
  (`all_or_nothing | proportional`, enum line 234), `bonusMultiplier`.
- `TieInBundleMember` (lines 918–931): `weightPercent`, `minimumSpend`.

**Math / engines:**
- `lib/contracts/tie-in.ts:64-148` — `evaluateAllOrNothing`,
  `evaluateProportional`, `evaluateCrossVendor` bundle-compliance functions.
- `lib/rebates/engine/amortization.ts:76-117` — `buildTieInAmortizationSchedule`
  with proper PMT formula including r=0 fallback.
- `lib/rebates/engine/tie-in-capital.ts:81-154` — `calculateTieInCapital`
  per-period evaluation with `trueUpAdjustment`, `shortfallHandling`
  (`BILL_IMMEDIATELY | CARRY_FORWARD`), nested spend/volume/carve-out engines.
- `lib/actions/contracts/tie-in.ts:20-119` — server action
  `getContractTieInBundle` returning evaluated bundle data.

**UI:**
- `components/contracts/tie-in-capital-picker.tsx:31-85` — dropdown to link a
  contract to its capital counterpart (shipped R5.13; broadened to all non-
  tie-in contracts).
- `components/contracts/contract-terms-entry.tsx:501-513` — renders
  `capitalCost` input when `contractType === "tie_in"`.
- `components/contracts/contract-tie-in-card.tsx:1-168` — bundle compliance
  card on the detail page (members, weight, min, spend, rebate, status badge).
- `components/contracts/contract-detail-client.tsx:41,467,593-631` — wires the
  tie-in card and a minimal capital-cost readout for tie-in contracts.

**Shipped waves:**
- R3.8 — amortization schedule engine (non-UI).
- R5.13 — tie-in capital picker unrestricted.
- R5.29 — sum rebate across all terms inside bundle evaluation.

---

## 4. Gap matrix

| Feature | v0 state | tydei state | Verdict |
|---|---|---|---|
| Schema: capital fields | `contractTotal`, `interestRate` on leased item (localStorage) | `capitalCost`, `interestRate`, `termMonths` on `ContractTerm` + `ContractAmortizationSchedule` table | **BETTER-IN-TYDEI** |
| Schema: bundle membership | Single FK `tie_in_capital_contract_id` | `TieInBundle` + `TieInBundleMember` with weights & minimums | **BETTER-IN-TYDEI** |
| New-contract flow: capital inputs | Full editor with leased-service array and auto-schedule preview | Single capital block inside contract-terms-entry, no schedule preview | **MISSING-IN-TYDEI** (schedule preview) |
| New-contract flow: payment cadence | `monthly / quarterly / semi_annual / annual` selectable | Engine supports `monthly / quarterly / annual`, but no UI input; `semi_annual` not supported | **NEEDS-REDESIGN** |
| New-contract flow: down payment / initial sales | `initialSales` field on item | No field | **MISSING-IN-TYDEI** |
| Detail page: amortization table | None (only a cosmetic array) | Engine produces entries; **no UI reads them** | **MISSING-IN-TYDEI** |
| Detail page: capital balance remaining | None | None | **MISSING-IN-TYDEI** |
| Detail page: rebate-to-capital mapping | None (rebates and capital are separate sections) | Engine supports `trueUpAdjustment` and shortfall handling, **no UI** | **MISSING-IN-TYDEI** |
| Detail page: payoff projection | None | None | **MISSING-IN-TYDEI** |
| Detail page: bundle compliance | Not rendered (localStorage stub) | `ContractTieInCard` with members, weight, min, spend, rebate, status | **BETTER-IN-TYDEI** |
| Shortfall handling | None | `BILL_IMMEDIATELY` / `CARRY_FORWARD` in engine; no UI surface | **MISSING-IN-TYDEI** (UI) |
| Reports / analytics | Reports page filters for tie-in | No tie-in-specific report | **MATCH (both thin)** |
| Compliance modes | All-or-nothing / proportional / accelerator (1.2× / 1.5×) | All-or-nothing / proportional / cross-vendor (flat bonus multiplier) | **NEEDS-REDESIGN** (accelerator missing) |
| Persisted amortization rows | N/A | Table exists; no writer path invoked | **MISSING-IN-TYDEI** |

---

## 5. Recommendations — what to ship next

### Wave A — finish tie-in capital UX (the elephant in the room)

- **A1. Amortization schedule card on contract detail** — severity **high**,
  scope `app/dashboard/contracts/[id]` + new `components/contracts/contract-amortization-card.tsx`,
  effort **medium**. Call `buildTieInAmortizationSchedule` on the server,
  render a table (period / opening / interest / principal / amortization due /
  closing). Industry practice: every capital lease has a schedule; it's the
  primary artifact finance teams ask for [Symplr, Outpatient Surgery].
- **A2. Capital balance + payoff projection strip** — severity **high**,
  effort **small**. Three tiles above the schedule: Remaining Balance, Paid
  To Date, Projected Payoff Date (linear interp from run-rate rebate).
- **A3. Tie the bundle rebate to the capital balance** — severity **high**,
  effort **medium**. When a contract with `tieInCapitalContractId` produces an
  earned rebate, display "Applied toward capital: $X / Cash rebate: $Y" split,
  using `calculateTieInCapital.trueUpAdjustment` semantics. This is the
  user-visible manifestation of the pay-down — today the two systems don't
  talk in the UI.

### Wave B — capture the missing contract fields

- **B1. Down payment / initial sale field** — severity **medium**, scope
  `contract-terms-entry.tsx`, effort **small**. Add `downPayment Decimal?` to
  `ContractTerm` (schema migration) and pass through to schedule builder as a
  starting balance reduction.
- **B2. Payment cadence picker** — severity **medium**, effort **small**.
  Expose a `paymentCadence` select (`monthly / quarterly / annual`) on the
  term form; engine already accepts it. Decide explicitly whether to add
  `semi_annual` or document its absence.
- **B3. Minimum purchase commitment on the usage contract** — severity
  **medium**, effort **small**. v0 and real GPO contracts both capture this;
  today `TieInBundleMember.minimumSpend` partially handles it but is scoped to
  bundle compliance, not to the capital contract itself.

### Wave C — shortfall & projections

- **C1. Surface `shortfallHandling` policy on the term** — severity **medium**,
  effort **small**. Add enum field, show banner "Shortfall: bill immediately"
  vs. "Shortfall: carry forward" on the detail page.
- **C2. Run-rate projection card** — severity **low**, effort **medium**.
  Project end-of-term capital balance given trailing-90-day rebate velocity.
  Industry parallel: vendor reps review this quarterly with the hospital [CME
  Corp, Medigroup].

### Wave D — accelerator compliance mode (optional)

- **D1.** v0 has a 1.2× / 1.5× accelerator tier above base compliance
  (`contract-calculations.md:345-357`). Current tydei cross-vendor mode uses a
  flat bonus percent. Severity **low** unless a customer asks for it;
  effort **medium** (schema + engine + UI).

> **Schema migration callout:** Waves B1 and C1 add columns
> (`ContractTerm.downPayment Decimal?`, `ContractTerm.shortfallHandling Enum?`)
> and a new enum `ShortfallHandling { bill_immediately, carry_forward }`.
> Additive only — no data backfill needed since existing rows are non-tie-in
> or already tolerate NULL. Wave D1 would require a breaking change to
> `TieInBundle` (extra columns for accelerator thresholds) — defer until
> justified by demand.

---

## 6. Citations

- [Symplr — Capital Equipment: An Overview & Strategies](https://www.symplr.com/blog/capital-equipment-overview-strategies-effective-purchases) — structure and hidden costs of capital purchases; notes consumable-dictated capital cost.
- [Outpatient Surgery Magazine — Make Your Capital Spending Count](https://www.aorn.org/outpatient-surgery/article/make-your-capital-spending-count) — explicit mention of trading consumable commitments for $40–50K capital equipment.
- [CME Corp — Buying Capital Medical Equipment](https://blog.cmecorp.com/buying-capital-medical-equipment-key-considerations) — vendor bundling of equipment pricing with consumable contracts.
- [SpecialtyCare — Perfusion Capital Purchase and Lease](https://specialtycareus.com/perfusion-capital-purchase-and-lease/) — lease vs purchase structures and payment cadences.
- [SurgiShop — GPO Contracts 2025](https://surgishop.com/regulatory-compliance/gpo-contracts/) — GPO contract structure, 10–20% below market, bundled products.
- [Definitive Healthcare — Top 10 GPOs](https://www.definitivehc.com/blog/top-10-gpos-by-staffed-beds) — market context (Vizient / Premier / HealthTrust dominance).
- [MatrixBCG — How Stryker Works](https://matrixbcg.com/blogs/how-it-works/stryker) — Mako capital + implant pull-through monetization.
- [PortersFiveForce — Stryker](https://portersfiveforce.com/blogs/how-it-works/stryker) — tiered capital pricing + service bundles with IDNs and ASCs.
- [Incentive Insights — Rebate Management for DME Manufacturers](https://incentiveinsights.com/rebate-management-for-medical-device-manufacturers/) — tiered rebates, loyalty bonuses, volume incentives on consumable rebates.
- [Medigroup — Capital Equipment Budget Planning Guide](https://www.medigroup.com/blog/medical-capital-equipment-budget-planning-guide/) — life-cycle planning and replacement cadence.
- [Hospital Medical Director — Financing Medical Equipment](https://hospitalmedicaldirector.com/financing-medical-equipment-purchase-vs-pay-per-use/) — pay-per-use as an alternative to capital purchase.
- Internal reference: `docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md` §4.8 — `TIE_IN_CAPITAL` engine spec.
- Internal reference: v0 prototype `docs/contract-calculations.md:276-400` — three compliance modes with accelerator tiers.
