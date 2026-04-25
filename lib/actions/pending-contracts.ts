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
  tiers: Array<{
    tierNumber: number
    spendMin: number
    spendMax: number | null
    rebateValue: number
    rebateType: string
  }>
}> {
  if (!Array.isArray(termsJson)) return []
  const EVERGREEN = new Date(Date.UTC(9999, 11, 31))
  const EPOCH = new Date(Date.UTC(1970, 0, 1))
  const out: ReturnType<typeof extractPendingTerms> = []
  for (const raw of termsJson) {
    if (!raw || typeof raw !== "object") continue
    const t = raw as Record<string, unknown>
    const termName = coerceString(t.termName)
    if (!termName) continue
    const tiersRaw = Array.isArray(t.tiers) ? t.tiers : []
    const tiers = tiersRaw
      .map((rawTier, idx) => {
        if (!rawTier || typeof rawTier !== "object") return null
        const tier = rawTier as Record<string, unknown>
        const spendMin = coerceNumber(tier.spendMin) ?? 0
        const rebateValue = coerceNumber(tier.rebateValue) ?? 0
        return {
          tierNumber:
            typeof tier.tierNumber === "number" ? tier.tierNumber : idx + 1,
          spendMin,
          spendMax:
            tier.spendMax === null || tier.spendMax === undefined
              ? null
              : coerceNumber(tier.spendMax),
          rebateValue,
          rebateType: coerceString(tier.rebateType) ?? "percent_of_spend",
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
    out.push({
      termName,
      termType: coerceString(t.termType) ?? "spend_rebate",
      baselineType: coerceString(t.baselineType) ?? "spend_based",
      evaluationPeriod: coerceString(t.evaluationPeriod) ?? "annual",
      paymentTiming: coerceString(t.paymentTiming) ?? "quarterly",
      appliesTo: coerceString(t.appliesTo) ?? "all_products",
      rebateMethod: coerceString(t.rebateMethod) ?? "cumulative",
      effectiveStart: parseDateOr(t.effectiveStart, EPOCH),
      effectiveEnd: parseDateOr(t.effectiveEnd, EVERGREEN),
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
          create: pendingTerms.map((t) => ({
            termName: t.termName,
            termType: t.termType as Prisma.ContractTermCreateInput["termType"],
            baselineType:
              t.baselineType as Prisma.ContractTermCreateInput["baselineType"],
            evaluationPeriod: t.evaluationPeriod,
            paymentTiming: t.paymentTiming,
            appliesTo: t.appliesTo,
            rebateMethod:
              t.rebateMethod as Prisma.ContractTermCreateInput["rebateMethod"],
            effectiveStart: t.effectiveStart,
            effectiveEnd: t.effectiveEnd,
            ...(t.tiers.length > 0 && {
              tiers: {
                create: t.tiers.map((tier) => ({
                  tierNumber: tier.tierNumber,
                  spendMin: tier.spendMin,
                  spendMax: tier.spendMax,
                  rebateValue: tier.rebateValue,
                  rebateType:
                    tier.rebateType as Prisma.ContractTierCreateInput["rebateType"],
                })),
              },
            }),
          })),
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
