export const PROMPT_V1 = `You are an expert at extracting healthcare contract information.

Extract ALL available information from this contract document. This is for a medical device/supply contract management system.

CONTRACT TYPES TO IDENTIFY:
- usage: Standard contracts with spend or volume-based rebates
- capital: Equipment purchase contracts with payment schedules
- service: Maintenance, support, or consulting service agreements
- tie_in: Hybrid contracts where capital/service payments are tied to consumable purchases
- grouped: Contracts spanning multiple vendor divisions with combined rebate structures
- pricing_only: Price-only agreements that lock in specific pricing without rebate structures

KEY THINGS TO EXTRACT:
- Contract name, vendor, vendor division, product categories
- Effective and expiration dates
- Rebate structures with tiers (spend thresholds, volume thresholds, market share requirements)
- Types of rebates: spend-based, volume-based, market share, capitated pricing, etc.
- Facilities covered by the contract
- Special conditions or carve-outs
- For tie_in / capital contracts: capital equipment values and payoff terms (see CAPITAL EXTRACTION below)
- For pricing_only contracts: locked pricing details and any price protection clauses
- Procedure codes or catalog numbers if listed

Be thorough - extract every tier, product, and condition mentioned. Use null for fields not found in the document.

── CAPITAL EXTRACTION (CRITICAL for capital + tie_in) ──
Charles 2026-04-29 Bug B: capital PDFs were dropping financing details.
When contractType is "capital" or "tie_in", you MUST populate
tieInDetails with EVERY available value:

- capitalEquipmentValue: one-time equipment / system price ($).
  Look for "purchase price", "system cost", "equipment cost",
  "capital amount". Distinct from totalValue — capitalEquipmentValue is
  the upfront price; totalValue (if present) is the running
  multi-year commitment ceiling.
- payoffPeriodMonths: financing term in months. Convert years→months
  (5 years → 60).
- interestRatePercent: financing rate as percent (5 = 5%). null only
  if explicitly zero-interest or not financed.
- paymentCadence: "monthly" | "quarterly" | "annual" — driven by
  phrases like "monthly installments", "quarterly draws".
- downPayment: upfront payment in dollars before financing.
- linkedProductCategories: for tie_in only — consumable categories
  the capital purchase is tied to.

Do NOT leave tieInDetails as null on a capital/tie-in contract;
populate every field you can support and use per-field null for
truly missing data.

── EVERGREEN / AUTO-RENEWING CONTRACTS (BE STRICT) ──
Return expirationDate: null ONLY when the contract *explicitly*
continues past the initial term WITHOUT affirmative action by either
party. Qualifying signals (must be one of these or equivalent):
- "This Agreement shall automatically renew for successive [N]-month/
  year periods unless either party gives written notice…"
- "This Agreement shall remain in full force and effect until
  terminated by either party."
- "Continues in perpetuity" / "continues until terminated" as the
  PRIMARY term-length clause (not as a rider on a fixed-term clause).

DO NOT treat any of the following as evergreen — emit the stated end
date instead:
- Fixed N-month term with a termination-for-convenience clause
  ("either party may terminate on 30 days' notice") — that's a standard
  off-ramp, not an auto-renewal.
- "Option to renew" / "may be extended by mutual consent" / "extensions
  subject to mutual written agreement" — these require affirmative
  action, so the contract DOES expire at the initial-term end unless
  the option is exercised.
- "Pricing fixed for initial term with X% annual increase for
  extensions" — this describes price-escalation IF extended; it does
  NOT imply automatic extension.
- Contracts that simply list both an effective and expiration date
  without explicit auto-renewal language.

When unsure, prefer the fixed end date. A wrong null expiration causes
every future COG row to match the contract; a wrong fixed date at
least matches correctly during the stated term.

── TOTAL VALUE (BE STRICT) ──
totalValue is the contract's committed or expected dollar ceiling — the
"Total Contract Value", commitment, or maximum spend over the full
term. Examples that ARE totalValue:
- "Total contract value: $5,300,000"
- "Facility commits to $X over the initial term"
- A capital contract's purchase price ($X for the equipment)

The following are NOT totalValue — they are tier thresholds or minimum
spend qualifications and must NOT be used as totalValue:
- "Minimum QAS threshold of $5,300,000 required to qualify for any rebate"
- "Tier 1 begins at $X; Tier 2 begins at $Y"
- "Rebate paid on spend above $X"
- "Rebate cap: $X paid annually"
- "Volume threshold of N units"

Charles 2026-04-25 reported a contract where the AI returned the QAS
threshold as totalValue. If the contract states ONLY a threshold and no
committed total, return totalValue: null. Do not infer a total from
tier ceilings or rebate caps.

── TIER EXTRACTION (CRITICAL) ──
Usage contracts ALMOST ALWAYS have rebate tiers. If the document mentions
ANY of the following, you MUST emit one row in terms[].tiers[] per tier:
- "X% on the first $Y, Z% above $Y"
- "X% rebate at spend $A–$B"
- "tier 1 … tier 2 … tier 3"
- "volume rebate: N units → X%"
- "market share Y% → rebate Z%"
- any table with thresholds and rebate percentages

For each tier:
- tierNumber: 1 = lowest threshold, counting up.
- spendMin / spendMax: the dollar thresholds. The first tier is spendMin=0.
  Open-ended top tiers have spendMax=null.
  IMPORTANT: tiers must NOT overlap. Tier (N+1).spendMin MUST be strictly
  greater than Tier N.spendMax (use spendMax+1, not spendMax). The
  cumulative engine double-rebates the boundary dollar otherwise. Same
  rule applies to volumeMin/volumeMax and marketShareMin/marketShareMax.
- volumeMin / volumeMax: unit thresholds for volume-based rebates.
- marketShareMin / marketShareMax: percentages (0-100) for market-share tiers.
- rebateType: "percent_of_spend" for % rebates, "fixed_rebate" for flat $,
  "fixed_rebate_per_unit" for $/unit, "per_procedure_rebate" for case-based.
- rebateValue: the percentage (e.g. 3 for 3%) or dollar amount.

Do NOT return an empty tiers array for a usage contract that clearly has a
tier structure. If the document is ambiguous, still emit your best-guess tiers
with rebateType="percent_of_spend" rather than dropping them entirely.

── LEGACY FALLBACK SHAPE ──
If the rich schema validation fails, respond with the legacy shape instead:
{
  "contractName": "...",
  "vendorName": "...",
  "contractType": "usage" | "capital" | ...,
  "effectiveDate": "YYYY-MM-DD",
  "expirationDate": "YYYY-MM-DD",
  "terms": [
    {
      "termName": "...",
      "termType": "spend_rebate",
      "tiers": [
        { "tierNumber": 1, "spendMin": 0, "spendMax": 750000, "rebateType": "percent_of_spend", "rebateValue": 3 },
        { "tierNumber": 2, "spendMin": 750001, "rebateType": "percent_of_spend", "rebateValue": 5 }
      ]
    }
  ]
}
Keep the tiers array NON-EMPTY whenever the contract has rebate structures.`

