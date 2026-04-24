"use server"

import { prisma } from "@/lib/db"
import { requireVendor, requireFacility } from "@/lib/actions/auth"
import {
  createPendingContractSchema,
  updatePendingContractSchema,
  type CreatePendingContractInput,
  type UpdatePendingContractInput,
} from "@/lib/validators/pending-contracts"
import { serialize } from "@/lib/serialize"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
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
    },
  })

  await prisma.pendingContract.update({
    where: { id },
    data: { status: "approved", reviewedAt: new Date(), reviewedBy },
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

  await prisma.pendingContract.update({
    where: { id, facilityId: facility.id },
    data: {
      status: "rejected",
      reviewedAt: new Date(),
      reviewedBy,
      reviewNotes: notes,
    },
  })
}

// ─── Facility: Request Revision ─────────────────────────────────

export async function requestRevision(id: string, reviewedBy: string, notes: string) {
  const { facility } = await requireFacility()

  await prisma.pendingContract.update({
    where: { id, facilityId: facility.id },
    data: {
      status: "revision_requested",
      reviewedAt: new Date(),
      reviewedBy,
      reviewNotes: notes,
    },
  })
}
