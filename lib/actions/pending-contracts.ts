"use server"

import { prisma } from "@/lib/db"
import type { Prisma } from "@prisma/client"
import { requireVendor, requireFacility } from "@/lib/actions/auth"
import {
  createPendingContractSchema,
  updatePendingContractSchema,
  type CreatePendingContractInput,
  type UpdatePendingContractInput,
} from "@/lib/validators/pending-contracts"
import { serialize } from "@/lib/serialize"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { resolveCategoryIdsToNames } from "@/lib/contracts/resolve-category-names"
import {
  notifyFacilityOfPendingContract,
  notifyVendorOfPendingDecision,
} from "@/lib/actions/notifications"
import { revalidatePath } from "next/cache"

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

function coerceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,]/g, ""))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function coerceString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim()
  return null
}

/**
 * Normalize pending.pricingData (Json?) into ContractPricing-shaped
 * input rows. Drops invalid entries silently; returns [] for anything
 * that isn't a non-empty array.
 */
function extractPendingPricingItems(
  pricingData: unknown,
): Array<{
  vendorItemNo: string
  description: string | null
  category: string | null
  unitPrice: number
  listPrice: number | null
  uom: string
}> {
  if (!Array.isArray(pricingData)) return []
  const rows: Array<{
    vendorItemNo: string
    description: string | null
    category: string | null
    unitPrice: number
    listPrice: number | null
    uom: string
  }> = []
  for (const raw of pricingData) {
    if (raw === null || typeof raw !== "object") continue
    const r = raw as PendingPricingItem
    const vendorItemNo = coerceString(r.vendorItemNo)
    const unitPrice = coerceNumber(r.unitPrice)
    if (!vendorItemNo || unitPrice === null) continue
    rows.push({
      vendorItemNo,
      description: coerceString(r.description),
      category: coerceString(r.category),
      unitPrice,
      listPrice: coerceNumber(r.listPrice),
      uom: coerceString(r.uom) ?? "EA",
    })
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
function extractPendingTerms(termsJson: unknown): Array<{
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
  const EPOCH = new Date(Date.UTC(1970, 0, 1))
  const out: ReturnType<typeof extractPendingTerms> = []
  // Charles 2026-04-25 (audit Bug 4): termType-aware default for
  // rebateMethod. Mirrors the client-side helper in
  // vendor-contract-submission.tsx (defaultRebateMethodForTermType).
  // Pre-fix the server defaulted to "cumulative" for everything when
  // the JSON omitted rebateMethod (older drafts, ingest paths, AI
  // extracts that didn't set it). For volume_rebate / growth_rebate
  // the natural shape is a marginal $/unit (or $/% growth) ladder, so
  // cumulative would compound the top tier's rate over the entire
  // qualifying base and over-pay the rebate. Bias to "marginal" for
  // those two, leaving every other type at "cumulative".
  const defaultRebateMethodForTermType = (tt: string): string => {
    switch (tt) {
      case "volume_rebate":
      case "growth_rebate":
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
        const rebateValue = coerceNumber(tier.rebateValue) ?? 0

        // Charles 2026-04-25 (audit Bug 3): mirror dedicated column
        // values into the spendMin/spendMax columns the engine reads
        // for column-reuse term types, but ONLY when spendMin is
        // missing or 0 (so users who explicitly populated spendMin
        // win). Same pattern for market_share.
        let spendMin = rawSpendMin ?? 0
        let spendMax = rawSpendMax
        if (
          isVolumeColumnTermType(termType) &&
          (rawSpendMin === null || rawSpendMin === 0) &&
          rawVolumeMin !== null &&
          rawVolumeMin !== undefined
        ) {
          spendMin = rawVolumeMin
          if (
            (spendMax === null || spendMax === undefined) &&
            rawVolumeMax !== null &&
            rawVolumeMax !== undefined
          ) {
            spendMax = rawVolumeMax
          }
        } else if (
          isMarketShareColumnTermType(termType) &&
          (rawSpendMin === null || rawSpendMin === 0) &&
          rawMarketShareMin !== null &&
          rawMarketShareMin !== undefined
        ) {
          spendMin = rawMarketShareMin
          if (
            (spendMax === null || spendMax === undefined) &&
            rawMarketShareMax !== null &&
            rawMarketShareMax !== undefined
          ) {
            spendMax = rawMarketShareMax
          }
        }

        return {
          tierNumber:
            typeof tier.tierNumber === "number" ? tier.tierNumber : idx + 1,
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
          rebateType: coerceString(tier.rebateType) ?? "percent_of_spend",
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
    const scopedItemNumbers = Array.isArray(t.scopedItemNumbers)
      ? (t.scopedItemNumbers
          .map((c) => coerceString(c))
          .filter((c): c is string => c !== null) as string[])
      : []
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

function parseDateOr(value: unknown, fallback: Date): Date {
  if (value instanceof Date) return value
  if (typeof value === "string" && value.length > 0) {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return fallback
}

// ─── Vendor: List Pending ───────────────────────────────────────

export async function getVendorPendingContracts(_vendorId?: string) {
  const { vendor } = await requireVendor()

  const contracts = await prisma.pendingContract.findMany({
    where: { vendorId: vendor.id },
    include: { facility: { select: { id: true, name: true } } },
    orderBy: { submittedAt: "desc" },
  })
  return serialize(contracts)
}

// ─── Vendor: Get Single ────────────────────────────────────────

export async function getVendorPendingContract(id: string) {
  const { vendor } = await requireVendor()

  const contract = await prisma.pendingContract.findUniqueOrThrow({
    where: { id, vendorId: vendor.id },
    include: { facility: { select: { id: true, name: true } } },
  })
  return serialize(contract)
}

// ─── Vendor: Create ─────────────────────────────────────────────

export async function createPendingContract(input: CreatePendingContractInput) {
  await requireVendor()
  const data = createPendingContractSchema.parse(input)

  const contract = await prisma.pendingContract.create({
    data: {
      vendorId: data.vendorId,
      vendorName: data.vendorName,
      facilityId: data.facilityId,
      facilityName: data.facilityName,
      contractName: data.contractName,
      contractType: data.contractType,
      effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
      expirationDate: data.expirationDate ? new Date(data.expirationDate) : null,
      totalValue: data.totalValue,
      // Charles 2026-04-25 (vendor-mirror Phase 2): persist the
      // field-parity columns. Pre-Phase-2 these were dropped on the
      // floor at the server boundary even when the vendor UI sent
      // them.
      ...(data.contractNumber !== undefined && {
        contractNumber: data.contractNumber,
      }),
      ...(data.annualValue !== undefined && {
        annualValue: data.annualValue,
      }),
      ...(data.gpoAffiliation !== undefined && {
        gpoAffiliation: data.gpoAffiliation,
      }),
      ...(data.performancePeriod !== undefined && {
        performancePeriod: data.performancePeriod,
      }),
      ...(data.rebatePayPeriod !== undefined && {
        rebatePayPeriod: data.rebatePayPeriod,
      }),
      ...(data.autoRenewal !== undefined && {
        autoRenewal: data.autoRenewal,
      }),
      ...(data.terminationNoticeDays !== undefined && {
        terminationNoticeDays: data.terminationNoticeDays,
      }),
      ...(data.capitalCost !== undefined && { capitalCost: data.capitalCost }),
      ...(data.interestRate !== undefined && { interestRate: data.interestRate }),
      ...(data.termMonths !== undefined && { termMonths: data.termMonths }),
      ...(data.downPayment !== undefined && { downPayment: data.downPayment }),
      ...(data.paymentCadence !== undefined && {
        paymentCadence: data.paymentCadence,
      }),
      ...(data.amortizationShape !== undefined && {
        amortizationShape: data.amortizationShape,
      }),
      terms: data.terms ?? [],
      documents: data.documents ?? [],
      pricingData: data.pricingData,
      notes: data.notes,
      status: "submitted",
    },
  })
  // Charles 2026-04-25 (vendor-mirror Phase 1): notify the facility
  // so a human knows there's a submission to review. Best-effort; if
  // emails are unconfigured the submission still succeeds.
  if (data.facilityId) {
    void notifyFacilityOfPendingContract({
      facilityId: data.facilityId,
      contractName: data.contractName,
      vendorName: data.vendorName,
      facilityName: data.facilityName ?? null,
      pendingId: contract.id,
    })
  }
  return serialize(contract)
}

// ─── Vendor: Update ─────────────────────────────────────────────

export async function updatePendingContract(id: string, input: UpdatePendingContractInput) {
  const { vendor } = await requireVendor()
  const data = updatePendingContractSchema.parse(input)

  const contract = await prisma.pendingContract.update({
    where: { id, vendorId: vendor.id },
    data: {
      ...(data.contractName !== undefined && { contractName: data.contractName }),
      ...(data.contractType !== undefined && { contractType: data.contractType }),
      ...(data.effectiveDate !== undefined && { effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null }),
      ...(data.expirationDate !== undefined && { expirationDate: data.expirationDate ? new Date(data.expirationDate) : null }),
      ...(data.totalValue !== undefined && { totalValue: data.totalValue }),
      // Charles 2026-04-25 (vendor-mirror Phase 2): mirror the create
      // path's field-parity columns on update so vendor edits to the
      // pending submission preserve them through the revision loop.
      ...(data.contractNumber !== undefined && {
        contractNumber: data.contractNumber,
      }),
      ...(data.annualValue !== undefined && {
        annualValue: data.annualValue,
      }),
      ...(data.gpoAffiliation !== undefined && {
        gpoAffiliation: data.gpoAffiliation,
      }),
      ...(data.performancePeriod !== undefined && {
        performancePeriod: data.performancePeriod,
      }),
      ...(data.rebatePayPeriod !== undefined && {
        rebatePayPeriod: data.rebatePayPeriod,
      }),
      ...(data.autoRenewal !== undefined && {
        autoRenewal: data.autoRenewal,
      }),
      ...(data.terminationNoticeDays !== undefined && {
        terminationNoticeDays: data.terminationNoticeDays,
      }),
      ...(data.capitalCost !== undefined && { capitalCost: data.capitalCost }),
      ...(data.interestRate !== undefined && { interestRate: data.interestRate }),
      ...(data.termMonths !== undefined && { termMonths: data.termMonths }),
      ...(data.downPayment !== undefined && { downPayment: data.downPayment }),
      ...(data.paymentCadence !== undefined && {
        paymentCadence: data.paymentCadence,
      }),
      ...(data.amortizationShape !== undefined && {
        amortizationShape: data.amortizationShape,
      }),
      ...(data.terms !== undefined && { terms: data.terms }),
      ...(data.documents !== undefined && { documents: data.documents }),
      ...(data.pricingData !== undefined && { pricingData: data.pricingData }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
  })
  return serialize(contract)
}

// ─── Vendor: Withdraw ───────────────────────────────────────────

export async function withdrawPendingContract(id: string) {
  const { vendor } = await requireVendor()

  await prisma.pendingContract.update({
    where: { id, vendorId: vendor.id },
    data: { status: "withdrawn" },
  })
}

// ─── Facility: List Pending ─────────────────────────────────────

export async function getFacilityPendingContracts(_facilityId?: string) {
  const { facility } = await requireFacility()

  const contracts = await prisma.pendingContract.findMany({
    where: { facilityId: facility.id, status: "submitted" },
    include: { vendor: { select: { id: true, name: true, logoUrl: true } } },
    orderBy: { submittedAt: "desc" },
  })
  return serialize(contracts)
}

// ─── Facility: Approve ──────────────────────────────────────────

export async function approvePendingContract(id: string, reviewedBy: string) {
  const { facility } = await requireFacility()

  const pending = await prisma.pendingContract.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
  })

  // F3 — port pricingData JSON into ContractPricing rows. Defensively
  // extract only items that look real (vendorItemNo + numeric unitPrice).
  const pricingItems = extractPendingPricingItems(pending.pricingData)

  // Charles 2026-04-25 (vendor-mirror Phase 1): port the `terms` JSON
  // blob into real `ContractTerm` + `ContractTier` rows. Without this
  // every approved vendor submission silently lost its rebate
  // structure — the contract appeared as "active" but had no terms,
  // so accruals computed to $0 forever. The shape of the blob mirrors
  // what the vendor submission form persists; we extract defensively
  // so a malformed blob doesn't blow the approval.
  const pendingTerms = extractPendingTerms(pending.terms)

  // Charles 2026-04-25 (vendor-mirror Phase 3 follow-up — B5):
  // pre-resolve scoped category IDs → names per term, OUTSIDE the
  // create call. ContractTerm.categories is a String[] of NAMES (the
  // engine matches against COG row category names) but the vendor UI
  // sends category IDs. Mirrors the create-contract path in
  // lib/actions/contracts.ts.
  const resolvedCategoryNamesByTerm = new Map<number, string[]>()
  for (let i = 0; i < pendingTerms.length; i++) {
    const ids = pendingTerms[i].scopedCategoryIds
    if (ids.length > 0) {
      resolvedCategoryNamesByTerm.set(i, await resolveCategoryIdsToNames(ids))
    }
  }

  const contract = await prisma.contract.create({
    data: {
      name: pending.contractName,
      vendorId: pending.vendorId,
      facilityId: facility.id,
      contractType: pending.contractType,
      status: "active",
      effectiveDate: pending.effectiveDate ?? new Date(),
      // Evergreen sentinel (see lib/actions/contracts.ts:728). Previously
      // the fallback was now + 365d which silently created a contract
      // that "expired" exactly one year after approval with no user
      // action. For evergreen pending contracts, write the far-future
      // sentinel so the matcher + formatDate treat it correctly
      // ("Evergreen" in the UI, in-window for every future COG row).
      expirationDate:
        pending.expirationDate ?? new Date(Date.UTC(9999, 11, 31)),
      totalValue: pending.totalValue ?? 0,
      // Charles 2026-04-25 (vendor-mirror Phase 2): port the field-
      // parity columns onto the real contract on approve. Without
      // this the vendor's submitted values would still drop on the
      // floor at the approve boundary even though Phase 2 added the
      // columns to PendingContract.
      ...(pending.contractNumber != null && {
        contractNumber: pending.contractNumber,
      }),
      ...(pending.annualValue != null && {
        annualValue: pending.annualValue,
      }),
      ...(pending.gpoAffiliation != null && {
        gpoAffiliation: pending.gpoAffiliation,
      }),
      // performancePeriod / rebatePayPeriod are typed `String?` on
      // PendingContract (free-form vendor input) but enums on the
      // real Contract. Cast at the boundary; if the vendor sent a
      // value that doesn't match the enum the create will throw and
      // surface a helpful Prisma error to the reviewer.
      ...(pending.performancePeriod != null && {
        performancePeriod:
          pending.performancePeriod as Prisma.ContractCreateInput["performancePeriod"],
      }),
      ...(pending.rebatePayPeriod != null && {
        rebatePayPeriod:
          pending.rebatePayPeriod as Prisma.ContractCreateInput["rebatePayPeriod"],
      }),
      autoRenewal: pending.autoRenewal,
      ...(pending.terminationNoticeDays != null && {
        terminationNoticeDays: pending.terminationNoticeDays,
      }),
      // Capital tie-in fields — same name on both models so direct
      // copy. paymentCadence/amortizationShape are `String?` on
      // PendingContract but enums on Contract; cast at the boundary.
      ...(pending.capitalCost != null && { capitalCost: pending.capitalCost }),
      ...(pending.interestRate != null && {
        interestRate: pending.interestRate,
      }),
      ...(pending.termMonths != null && { termMonths: pending.termMonths }),
      ...(pending.downPayment != null && {
        downPayment: pending.downPayment,
      }),
      ...(pending.paymentCadence != null && {
        paymentCadence:
          pending.paymentCadence as Prisma.ContractCreateInput["paymentCadence"],
      }),
      ...(pending.amortizationShape != null && {
        amortizationShape:
          pending.amortizationShape as Prisma.ContractCreateInput["amortizationShape"],
      }),
      ...(pricingItems.length > 0 && {
        pricingItems: {
          create: pricingItems,
        },
      }),
      ...(pendingTerms.length > 0 && {
        terms: {
          // Prisma's nested-create requires enum-typed strings on the
          // term row. JSON-extracted values are bare strings, so we
          // cast at this single boundary. The validators in
          // `lib/validators/contract-terms.ts` would reject anything
          // unsafe upstream once Phase 2 plumbs validated terms
          // through the pending model.
          create: pendingTerms.map((t, idx) => {
            const resolvedCategoryNames = resolvedCategoryNamesByTerm.get(idx)
            return {
              termName: t.termName,
              termType:
                t.termType as Prisma.ContractTermCreateInput["termType"],
              baselineType:
                t.baselineType as Prisma.ContractTermCreateInput["baselineType"],
              evaluationPeriod: t.evaluationPeriod,
              paymentTiming: t.paymentTiming,
              appliesTo: t.appliesTo,
              rebateMethod:
                t.rebateMethod as Prisma.ContractTermCreateInput["rebateMethod"],
              effectiveStart: t.effectiveStart,
              effectiveEnd: t.effectiveEnd,
              // Charles 2026-04-25 (vendor-mirror Phase 3 follow-up — B5):
              // baseline + scope + procedure fields. Pre-fix these were
              // dropped at the approve boundary; the engine then
              // computed $0 forever against undefined baselines.
              ...(t.spendBaseline != null && {
                spendBaseline: t.spendBaseline,
              }),
              ...(t.growthBaselinePercent != null && {
                growthBaselinePercent: t.growthBaselinePercent,
              }),
              // volumeBaseline is Int on the schema (Math.round so a
              // string→number coercion of "5000.0" doesn't trip
              // Prisma). desiredMarketShare is a Decimal — straight
              // through.
              ...(t.volumeBaseline != null && {
                volumeBaseline: Math.round(t.volumeBaseline),
              }),
              ...(t.desiredMarketShare != null && {
                desiredMarketShare: t.desiredMarketShare,
              }),
              ...(t.volumeType != null && {
                volumeType:
                  t.volumeType as Prisma.ContractTermCreateInput["volumeType"],
              }),
              // ContractTerm.categories holds NAMES (resolved above).
              ...(resolvedCategoryNames &&
                resolvedCategoryNames.length > 0 && {
                  categories: resolvedCategoryNames,
                }),
              ...(t.cptCodes.length > 0 && { cptCodes: t.cptCodes }),
              // scopedItemNumbers → ContractTermProduct join rows.
              ...(t.scopedItemNumbers.length > 0 && {
                products: {
                  create: t.scopedItemNumbers.map((vendorItemNo) => ({
                    vendorItemNo,
                  })),
                },
              }),
              ...(t.tiers.length > 0 && {
                tiers: {
                  create: t.tiers.map((tier) => ({
                    tierNumber: tier.tierNumber,
                    spendMin: tier.spendMin,
                    ...(tier.spendMax != null && { spendMax: tier.spendMax }),
                    // volumeMin/Max are Int columns — round at the
                    // boundary in case of string→number coercion.
                    ...(tier.volumeMin != null && {
                      volumeMin: Math.round(tier.volumeMin),
                    }),
                    ...(tier.volumeMax != null && {
                      volumeMax: Math.round(tier.volumeMax),
                    }),
                    ...(tier.marketShareMin != null && {
                      marketShareMin: tier.marketShareMin,
                    }),
                    ...(tier.marketShareMax != null && {
                      marketShareMax: tier.marketShareMax,
                    }),
                    rebateValue: tier.rebateValue,
                    rebateType:
                      tier.rebateType as Prisma.ContractTierCreateInput["rebateType"],
                  })),
                },
              }),
            }
          }),
        },
      }),
    },
  })

  await prisma.pendingContract.update({
    where: { id },
    data: { status: "approved", reviewedAt: new Date(), reviewedBy },
  })

  // Charles 2026-04-25 (vendor-mirror Phase 1): close the loop with
  // the vendor — they need to know their submission landed as a real
  // contract.
  void notifyVendorOfPendingDecision({
    vendorId: pending.vendorId,
    contractName: pending.contractName,
    vendorName: pending.vendorName,
    facilityName: pending.facilityName,
    pendingId: pending.id,
    decision: "approved",
  })

  // F2 — recompute COG match-statuses so rows flip from
  // off_contract_item → on_contract / price_variance now that the
  // vendor has an active contract with pricing.
  await recomputeMatchStatusesForVendor(prisma, {
    vendorId: pending.vendorId,
    facilityId: facility.id,
  })
  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard/alerts")
  revalidatePath("/dashboard")

  return serialize(contract)
}

// ─── Facility: Reject ───────────────────────────────────────────

export async function rejectPendingContract(id: string, reviewedBy: string, notes: string) {
  const { facility } = await requireFacility()

  const pending = await prisma.pendingContract.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
  })

  await prisma.pendingContract.update({
    where: { id, facilityId: facility.id },
    data: {
      status: "rejected",
      reviewedAt: new Date(),
      reviewedBy,
      reviewNotes: notes,
    },
  })

  void notifyVendorOfPendingDecision({
    vendorId: pending.vendorId,
    contractName: pending.contractName,
    vendorName: pending.vendorName,
    facilityName: pending.facilityName,
    pendingId: pending.id,
    decision: "rejected",
    reviewNotes: notes,
  })
}

// ─── Facility: Request Revision ─────────────────────────────────

export async function requestRevision(id: string, reviewedBy: string, notes: string) {
  const { facility } = await requireFacility()

  const pending = await prisma.pendingContract.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
  })

  await prisma.pendingContract.update({
    where: { id, facilityId: facility.id },
    data: {
      status: "revision_requested",
      reviewedAt: new Date(),
      reviewedBy,
      reviewNotes: notes,
    },
  })

  void notifyVendorOfPendingDecision({
    vendorId: pending.vendorId,
    contractName: pending.contractName,
    vendorName: pending.vendorName,
    facilityName: pending.facilityName,
    pendingId: pending.id,
    decision: "revision_requested",
    reviewNotes: notes,
  })
}
