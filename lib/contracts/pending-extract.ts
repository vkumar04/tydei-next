/**
 * Pure JSON extractors for PendingContract payloads — pricingData rows,
 * terms/tiers, and capital line items. Extracted VERBATIM from
 * lib/actions/pending-contracts.ts (2026-08-05 decomposition) so the
 * helpers are importable from vitest and non-action code.
 *
 * This module must NEVER carry the `"use server"` directive: these are
 * synchronous helpers, and every export in a "use server" file must be an
 * async function (guarded by use-server-async-export-scanner.test.ts) —
 * a directive here would also register each helper as a client-callable
 * Server Action.
 */
import type { Prisma } from "@/lib/generated/prisma/client"
import { normalizeScopedItemNumbers } from "@/lib/contracts/normalize-scoped-item-numbers"
import { isPercentRebateType } from "@/lib/contracts/rebate-value-normalize"
import { normalizeCadence } from "@/lib/contracts/capital-line-items"

/**
 * Loose pending-pricing-item shape. `pending.pricingData` is stored as
 * `Json?` with `z.any()` validation, so we accept arbitrary row shapes
 * but only port entries that look like a real pricing row (must have
 * vendorItemNo + numeric unitPrice).
 */
type PendingPricingItem = {
  vendorItemNo?: unknown
  description?: unknown
  category?: unknown
  unitPrice?: unknown
  listPrice?: unknown
  uom?: unknown
}

export function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,]/g, ""))
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function coerceString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim()
  return null
}

/**
 * Normalize pending.pricingData (Json?) into ContractPricing-shaped
 * input rows. Drops invalid entries silently; returns [] for anything
 * that isn't a non-empty array.
 */
export function extractPendingPricingItems(
  pricingData: unknown,
): Array<{
  vendorItemNo: string
  description: string | null
  category: string | null
  unitPrice: number
  listPrice: number | null
  uom: string
}> {
  // Charles audit pass-3 BLOCKER: vendor submission writes pricingData
  // as an OBJECT `{ fileName, itemCount, totalValue, categories,
  // items, uploadedAt }`. Earlier code only accepted Array shape and
  // silently dropped every vendor pricing file on approve, breaking
  // COG match. Accept either shape: array or `{items: [...]}`.
  let inputArray: unknown[]
  if (Array.isArray(pricingData)) {
    inputArray = pricingData
  } else if (
    pricingData !== null &&
    typeof pricingData === "object" &&
    Array.isArray((pricingData as { items?: unknown }).items)
  ) {
    inputArray = (pricingData as { items: unknown[] }).items
  } else {
    return []
  }
  const rows: Array<{
    vendorItemNo: string
    description: string | null
    category: string | null
    unitPrice: number
    listPrice: number | null
    uom: string
  }> = []
  // Charles audit pass-4 round-3 CONCERN: dedupe pricing rows by
  // normalized vendorItemNo (case-insensitive trim) so a vendor
  // pasting "ABC", "abc", "ABC " doesn't produce 3 ContractPricing
  // rows on approve. Round-4: LAST-WINS semantics. A vendor's CSV
  // with `ABC` at $10 followed by a corrected `ABC` at $12 is the
  // standard "I'm updating this row" pattern — first-wins would
  // silently drop the correction. Last-wins preserves it.
  const indexByVendorItemNo = new Map<string, number>()
  for (const raw of inputArray) {
    if (raw === null || typeof raw !== "object") continue
    const r = raw as PendingPricingItem
    const vendorItemNo = coerceString(r.vendorItemNo)
    const unitPrice = coerceNumber(r.unitPrice)
    if (!vendorItemNo || unitPrice === null) continue
    const normalized = vendorItemNo.trim().toUpperCase()
    const row = {
      vendorItemNo: vendorItemNo.trim(),
      description: coerceString(r.description),
      category: coerceString(r.category),
      unitPrice,
      listPrice: coerceNumber(r.listPrice),
      uom: coerceString(r.uom) ?? "EA",
    }
    const existingIdx = indexByVendorItemNo.get(normalized)
    if (existingIdx !== undefined) {
      rows[existingIdx] = row
    } else {
      indexByVendorItemNo.set(normalized, rows.length)
      rows.push(row)
    }
  }
  return rows
}

/**
 * Charles 2026-04-25 (vendor-mirror Phase 1): normalize pending.terms
 * (Json) into ContractTerm + ContractTier shapes. Defensive — drops
 * malformed entries silently rather than failing the whole approval.
 *
 * Expected shape (matches what the vendor submission UI persists):
 *   [{ termName, termType?, baselineType?, evaluationPeriod?,
 *      paymentTiming?, appliesTo?, rebateMethod?, effectiveStart?,
 *      effectiveEnd?, tiers: [{ tierNumber, spendMin, spendMax?,
 *      rebateValue, rebateType? }] }]
 *
 * Defaults mirror createTermSchema in lib/validators/contract-terms.ts.
 */
/**
 * Charles audit suggestion #4 (v0-port): drain pending capital into
 * one or more ContractCapitalLineItem nested-create payloads. JSON
 * multi-item shape wins; single-block legacy capital is the fallback.
 */
export function buildCapitalLineItemsFromPending(pending: {
  contractName: string
  capitalLineItems?: Prisma.JsonValue | null
  capitalCost: Prisma.Decimal | null
  downPayment: Prisma.Decimal | null
  interestRate: Prisma.Decimal | null
  termMonths: number | null
  paymentCadence: string | null
  amortizationShape: string | null
}): Array<{
  description: string
  itemNumber?: string | null
  serialNumber?: string | null
  contractTotal: Prisma.Decimal | number
  initialSales: Prisma.Decimal | number
  interestRate: Prisma.Decimal | number
  termMonths: number
  paymentType: string
  paymentCadence: string
}> {
  // (a) JSON multi-item path.
  const raw = pending.capitalLineItems
  if (Array.isArray(raw) && raw.length > 0) {
    const items: Array<Record<string, unknown>> = []
    for (const r of raw) {
      if (r === null || typeof r !== "object" || Array.isArray(r)) continue
      items.push(r as Record<string, unknown>)
    }
    return items.map((r) => {
      const cadence = r.paymentCadence as string | null | undefined
      return {
        description:
          typeof r.description === "string" && r.description.trim().length > 0
            ? r.description
            : pending.contractName,
        itemNumber:
          typeof r.itemNumber === "string" ? r.itemNumber : null,
        serialNumber:
          typeof r.serialNumber === "string" ? r.serialNumber : null,
        contractTotal: Number(r.contractTotal ?? 0),
        initialSales: Number(r.initialSales ?? 0),
        interestRate: Number(r.interestRate ?? 0),
        termMonths: Number(r.termMonths ?? 60),
        paymentType:
          r.paymentType === "variable" ? "variable" : "fixed",
        // 2026-06-08: vendor-approval path dropped `semi_annual` (downgraded
        // to monthly on approve). Route through canonical normalizeCadence.
        paymentCadence: normalizeCadence(cadence),
      }
    })
  }
  // (b) Single-block fallback.
  if (pending.capitalCost == null) return []
  return [
    {
      description: pending.contractName,
      contractTotal: pending.capitalCost,
      initialSales: pending.downPayment ?? 0,
      interestRate: pending.interestRate ?? 0,
      termMonths: pending.termMonths ?? 60,
      paymentType:
        pending.amortizationShape === "custom" ? "variable" : "fixed",
      // 2026-06-09 audit: route through normalizeCadence like the JSON
      // line-item path above — a raw legacy value here bypassed the
      // semi_annual-preserving allow-list (the recurring cadence-drop class).
      paymentCadence: normalizeCadence(pending.paymentCadence),
    },
  ]
}

export function extractPendingTerms(termsJson: unknown, contractEffectiveDate?: Date | null): Array<{
  termName: string
  termType: string
  baselineType: string
  evaluationPeriod: string
  paymentTiming: string
  appliesTo: string
  rebateMethod: string
  effectiveStart: Date
  effectiveEnd: Date
  // Charles 2026-04-25 (vendor-mirror Phase 3 follow-up — B5):
  // baseline + scope + procedure fields. Without these growth /
  // volume / market_share / CPT / category-scoped contracts compute
  // against undefined baselines on the real engine after approval and
  // silently produce $0.
  spendBaseline: number | null
  growthBaselinePercent: number | null
  volumeBaseline: number | null
  desiredMarketShare: number | null
  volumeType: string | null
  // ContractTerm.categories is a String[] of NAMES (the engine joins
  // against COG row category names). The vendor UI sends IDs; we
  // resolve to names downstream in approvePendingContract.
  scopedCategoryIds: string[]
  // scopedItemNumbers persist as ContractTermProduct rows — mirrors
  // the create-contract path in lib/actions/contracts.ts.
  scopedItemNumbers: string[]
  cptCodes: string[]
  tiers: Array<{
    tierNumber: number
    tierName: string | null
    spendMin: number
    spendMax: number | null
    volumeMin: number | null
    volumeMax: number | null
    marketShareMin: number | null
    marketShareMax: number | null
    rebateValue: number
    rebateType: string
  }>
}> {
  if (!Array.isArray(termsJson)) return []
  const EVERGREEN = new Date(Date.UTC(9999, 11, 31))
  // Charles audit pass-3 N1: fall back to the parent contract's
  // effective date when a vendor omits term-level dates, instead of
  // the UTC epoch (1970). Reads showing "Effective Jan 1, 1970"
  // looked broken — the contract date is the right anchor.
  const EPOCH = contractEffectiveDate ?? new Date(Date.UTC(1970, 0, 1))
  const out: ReturnType<typeof extractPendingTerms> = []
  // Charles 2026-04-25 (audit Bug 4): termType-aware default for
  // rebateMethod. Mirrors the client-side helper in
  // vendor-contract-submission.tsx (defaultRebateMethodForTermType).
  // Pre-fix the server defaulted to "cumulative" for everything when
  // the JSON omitted rebateMethod (older drafts, ingest paths, AI
  // extracts that didn't set it). For volume_rebate the natural shape
  // is a marginal $/unit ladder, so cumulative would compound the top
  // tier's rate over the entire qualifying base and over-pay the
  // rebate. Bias to "marginal" for volume_rebate, leaving every other
  // type at "cumulative". (Growth is now a property — growthOnly —
  // rather than its own term type; growth-on-spend contracts default
  // to cumulative like other spend_rebate rows.)
  const defaultRebateMethodForTermType = (tt: string): string => {
    switch (tt) {
      case "volume_rebate":
        return "marginal"
      default:
        return "cumulative"
    }
  }
  // Charles 2026-04-25 (audit Bug 3): tier-engine column-reuse —
  // `lib/actions/contracts/recompute-volume-accrual.ts` (and the
  // peer market-share writer) read tier.spendMin / tier.spendMax as
  // the OCCURRENCE / SHARE-PERCENT thresholds for non-spend term
  // types. The vendor UI populates dedicated `volumeMin` /
  // `marketShareMin` columns instead. Without mirroring at this
  // boundary, every volume/market-share tier lands with spendMin = 0
  // → engine sees every tier starting at 0 → highest tier always wins
  // → tier ladder collapses. Mirror at extract so the engine + the
  // UI agree without changing the engines (smaller blast radius).
  const isVolumeColumnTermType = (tt: string): boolean =>
    tt === "volume_rebate" ||
    tt === "rebate_per_use" ||
    tt === "capitated_pricing_rebate" ||
    tt === "po_rebate" ||
    tt === "payment_rebate"
  const isMarketShareColumnTermType = (tt: string): boolean =>
    tt === "compliance_rebate" || tt === "market_share"

  for (const raw of termsJson) {
    if (!raw || typeof raw !== "object") continue
    const t = raw as Record<string, unknown>
    const termName = coerceString(t.termName)
    if (!termName) continue
    const termType = coerceString(t.termType) ?? "spend_rebate"
    const tiersRaw = Array.isArray(t.tiers) ? t.tiers : []
    const tiers = tiersRaw
      .map((rawTier, idx) => {
        if (!rawTier || typeof rawTier !== "object") return null
        const tier = rawTier as Record<string, unknown>
        const rawSpendMin = coerceNumber(tier.spendMin)
        const rawSpendMax =
          tier.spendMax === null || tier.spendMax === undefined
            ? null
            : coerceNumber(tier.spendMax)
        const rawVolumeMin =
          tier.volumeMin === null || tier.volumeMin === undefined
            ? null
            : coerceNumber(tier.volumeMin)
        const rawVolumeMax =
          tier.volumeMax === null || tier.volumeMax === undefined
            ? null
            : coerceNumber(tier.volumeMax)
        const rawMarketShareMin =
          tier.marketShareMin === null || tier.marketShareMin === undefined
            ? null
            : coerceNumber(tier.marketShareMin)
        const rawMarketShareMax =
          tier.marketShareMax === null || tier.marketShareMax === undefined
            ? null
            : coerceNumber(tier.marketShareMax)
        const rebateType = coerceString(tier.rebateType) ?? "percent_of_spend"
        let rebateValue = coerceNumber(tier.rebateValue) ?? 0
        // 2026-06-09 audit: percent-type tiers store FRACTIONS (0.2 = 20%),
        // but legacy/AI pending payloads (pre the 2026-04-26 form
        // normalization) carry percent-points — three live prod rows have
        // rebateValue 20/5/3, which would approve into 2000%/500%/300%
        // tiers. The facility validator rejects stored >1 for percent
        // types; mirror that here by normalizing points → fraction. A
        // value still >1 after one division is garbage — warn loudly.
        if (isPercentRebateType(rebateType) && rebateValue > 1) {
          rebateValue = rebateValue / 100
          if (rebateValue > 1) {
            console.warn(
              `[extractPendingTerms] tier rebateValue ${rebateValue * 100} still >100% after percent-point normalization — check the submission payload`,
            )
          }
        }

        // Charles 2026-04-25 (audit Bug 3): mirror dedicated column
        // values into the spendMin/spendMax columns the engine reads
        // for column-reuse term types. Charles audit pass-3: prefer
        // the dedicated column UNCONDITIONALLY for column-reuse term
        // types — the dedicated column is the user's intent for those
        // termTypes, and any spendMin in the payload was either left
        // at its default (0) or accidentally populated. This makes the
        // engine match exactly what the reviewer's pending-review
        // dialog renders (which prefers volumeMin/marketShareMin via
        // ?? spendMin) — eliminates silent dialog-vs-engine drift.
        let spendMin = rawSpendMin ?? 0
        let spendMax = rawSpendMax
        if (
          isVolumeColumnTermType(termType) &&
          rawVolumeMin !== null &&
          rawVolumeMin !== undefined
        ) {
          spendMin = rawVolumeMin
          if (rawVolumeMax !== null && rawVolumeMax !== undefined) {
            spendMax = rawVolumeMax
          }
        } else if (
          isMarketShareColumnTermType(termType) &&
          rawMarketShareMin !== null &&
          rawMarketShareMin !== undefined
        ) {
          spendMin = rawMarketShareMin
          if (
            rawMarketShareMax !== null &&
            rawMarketShareMax !== undefined
          ) {
            spendMax = rawMarketShareMax
          }
        }

        return {
          tierNumber:
            typeof tier.tierNumber === "number" ? tier.tierNumber : idx + 1,
          // Charles audit round-2 vendor BLOCKER 1: tierName must
          // round-trip through approve too. Hydrate fix + tierInputSchema
          // alone weren't enough — the server-side approve mapping
          // dropped it.
          tierName: coerceString(tier.tierName),
          spendMin,
          spendMax,
          // Charles 2026-04-25 (vendor-mirror Phase 3 follow-up — B5):
          // per-tier volume + market-share thresholds. Same
          // null/numeric discipline as spendMin/spendMax — the engine
          // reads these columns directly to find the matching tier.
          volumeMin: rawVolumeMin,
          volumeMax: rawVolumeMax,
          marketShareMin: rawMarketShareMin,
          marketShareMax: rawMarketShareMax,
          rebateValue,
          rebateType,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    const cptCodes = Array.isArray(t.cptCodes)
      ? (t.cptCodes
          .map((c) => coerceString(c))
          .filter((c): c is string => c !== null) as string[])
      : []
    const scopedCategoryIds = Array.isArray(t.scopedCategoryIds)
      ? (t.scopedCategoryIds
          .map((c) => coerceString(c))
          .filter((c): c is string => c !== null) as string[])
      : []
    // Charles audit pass-2: dedupe + trim via canonical helper so a
    // vendor pasting "ABC, , ABC " can't trip the unique constraint
    // at approve time.
    const scopedItemNumbers = normalizeScopedItemNumbers(
      Array.isArray(t.scopedItemNumbers)
        ? (t.scopedItemNumbers
            .map((c) => coerceString(c))
            .filter((c): c is string => c !== null) as string[])
        : [],
    )
    out.push({
      termName,
      termType,
      baselineType: coerceString(t.baselineType) ?? "spend_based",
      evaluationPeriod: coerceString(t.evaluationPeriod) ?? "annual",
      paymentTiming: coerceString(t.paymentTiming) ?? "quarterly",
      appliesTo: coerceString(t.appliesTo) ?? "all_products",
      rebateMethod:
        coerceString(t.rebateMethod) ?? defaultRebateMethodForTermType(termType),
      effectiveStart: parseDateOr(t.effectiveStart, EPOCH),
      effectiveEnd: parseDateOr(t.effectiveEnd, EVERGREEN),
      spendBaseline: coerceNumber(t.spendBaseline),
      growthBaselinePercent: coerceNumber(t.growthBaselinePercent),
      volumeBaseline: coerceNumber(t.volumeBaseline),
      desiredMarketShare: coerceNumber(t.desiredMarketShare),
      volumeType: coerceString(t.volumeType),
      scopedCategoryIds,
      scopedItemNumbers,
      cptCodes,
      tiers,
    })
  }
  return out
}

export function parseDateOr(value: unknown, fallback: Date): Date {
  if (value instanceof Date) return value
  if (typeof value === "string" && value.length > 0) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return fallback
}
