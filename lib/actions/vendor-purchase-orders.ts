"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { serialize } from "@/lib/serialize"
import {
  createVendorPOSchema,
  type CreateVendorPOInput,
} from "@/lib/validators/purchase-orders"
import type { POStatus, Prisma } from "@/lib/generated/prisma/client"
import { contractsOwnedByVendor } from "@/lib/actions/contracts-vendor-auth"

export type { CreateVendorPOInput } from "@/lib/validators/purchase-orders"

// M11 (2026-06-09 audit): group-vendor drift — a contract can belong to a
// vendor group via `additionalVendorIds`, so every vendor-relationship check
// must use the canonical ownership predicate, never bare `vendorId` equality.
// Routed through `contractsOwnedByVendor` (invariants table) so this surface
// can't drift from the one definition of "owned by this vendor".
const vendorContractScope = (vendorId: string): Prisma.ContractWhereInput =>
  contractsOwnedByVendor(vendorId)

export interface VendorPORow {
  id: string
  poNumber: string
  facilityId: string
  facilityName: string
  orderDate: string
  totalCost: number
  status: string
  poType: string
  itemCount: number
  /**
   * L16: only set for completed POs. There is no real fulfilment
   * timestamp on the model — this is the row's `updatedAt` at the time
   * it reached `completed`, surfaced under a "Completed" column.
   */
  receivedDate: string | null
}

export interface VendorPOListResult {
  orders: VendorPORow[]
  /** Total PO count across ALL pages (drives pagination + hero). */
  total: number
  /** Lifetime sum of totalCost across ALL pages. */
  totalValue: number
  /** Per-status counts across ALL pages (drives hero + tab counts). */
  statusCounts: Record<POStatus, number>
}

export async function getVendorPurchaseOrders(input?: {
  page?: number
  pageSize?: number
}): Promise<VendorPOListResult> {
  const { vendor } = await requireVendor()

  // H3 (2026-06-09 audit): was a bare `take: 50` with client-side reduces
  // over the truncated rows. Now a real paginated list with server-side
  // count / _sum / status groupBy aggregates.
  const page = Math.max(1, input?.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 50))
  const where: Prisma.PurchaseOrderWhereInput = { vendorId: vendor.id }

  const [pos, total, sumAgg, statusGroups] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      // PHI exclusion (2026-06-10): PurchaseOrder now carries patient
      // context (patientMrn, patientInitials, procedureDate) for the
      // facility's bill-only workflow. Vendors must NEVER see those —
      // explicit select instead of full-row include so new columns are
      // opt-in here. Guarded by vendor-po-phi-exclusion.test.ts.
      select: {
        id: true,
        poNumber: true,
        facilityId: true,
        orderDate: true,
        totalCost: true,
        status: true,
        isOffContract: true,
        updatedAt: true,
        facility: { select: { name: true } },
        _count: { select: { lineItems: true } },
      },
      orderBy: { orderDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.aggregate({ where, _sum: { totalCost: true } }),
    prisma.purchaseOrder.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
    }),
  ])

  const statusCounts: Record<POStatus, number> = {
    draft: 0,
    pending: 0,
    approved: 0,
    sent: 0,
    completed: 0,
    cancelled: 0,
  }
  for (const g of statusGroups) statusCounts[g.status] = g._count._all

  return serialize({
    orders: pos.map((p) => ({
      id: p.id,
      poNumber: p.poNumber,
      facilityId: p.facilityId,
      facilityName: p.facility.name,
      orderDate: p.orderDate.toISOString(),
      totalCost: Number(p.totalCost ?? 0),
      status: p.status,
      // M9: header isOffContract is now reliably set at create time on
      // both paths (contractId == null), so the Type column shows real
      // values instead of a perpetual "Standard".
      poType: p.isOffContract ? "Off-Contract" : "Standard",
      itemCount: p._count.lineItems,
      receivedDate:
        p.status === "completed" ? p.updatedAt.toISOString() : null,
    })),
    total,
    totalValue: Number(sumAgg._sum.totalCost ?? 0),
    statusCounts,
  })
}

// ─── Vendor Facilities (facilities with contracts for this vendor) ──

export interface VendorFacilityRow {
  id: string
  name: string
  contractId: string | null
  contractName: string | null
}

export async function getVendorFacilities(_vendorId?: string): Promise<VendorFacilityRow[]> {
  const { vendor } = await requireVendor()

  // M11: include contracts where this vendor is a grouped member
  // (additionalVendorIds), not just the primary vendor.
  // M12: include facilities attached via the ContractFacility join, not
  // just the contract's primary facility.
  const contracts = await prisma.contract.findMany({
    where: { ...vendorContractScope(vendor.id), status: "active" },
    include: {
      facility: { select: { id: true, name: true } },
      contractFacilities: {
        include: { facility: { select: { id: true, name: true } } },
      },
    },
    orderBy: { facility: { name: "asc" } },
  })

  // Deduplicate facilities, keep first contract per facility
  const seen = new Set<string>()
  const results: VendorFacilityRow[] = []
  for (const c of contracts) {
    const members: { id: string; name: string }[] = []
    if (c.facilityId && c.facility) {
      members.push({ id: c.facilityId, name: c.facility.name })
    }
    for (const cf of c.contractFacilities) {
      members.push({ id: cf.facilityId, name: cf.facility.name })
    }
    for (const m of members) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      results.push({
        id: m.id,
        name: m.name,
        contractId: c.id,
        contractName: c.name,
      })
    }
  }
  results.sort((a, b) => a.name.localeCompare(b.name))
  return serialize(results)
}

// ─── Search Vendor Products (from pricing file) ────────────────────

export interface VendorProductRow {
  id: string
  vendorItemNo: string
  description: string
  contractPrice: number | null
  listPrice: number | null
  uom: string
  category: string | null
}

export async function searchVendorProducts(input: {
  vendorId?: string
  facilityId?: string
  query: string
}): Promise<VendorProductRow[]> {
  const { vendor } = await requireVendor()
  const vendorId = vendor.id
  const { facilityId, query } = input

  if (!query || query.length < 2) return []

  const conditions: Prisma.PricingFileWhereInput[] = [
    { vendorId },
    {
      OR: [
        { productDescription: { contains: query, mode: "insensitive" } },
        { vendorItemNo: { contains: query, mode: "insensitive" } },
      ],
    },
  ]
  if (facilityId) conditions.push({ facilityId })

  const results = await prisma.pricingFile.findMany({
    where: { AND: conditions },
    take: 30,
    orderBy: { productDescription: "asc" },
  })

  return serialize(
    results.map((r) => ({
      id: r.id,
      vendorItemNo: r.vendorItemNo,
      description: r.productDescription,
      contractPrice: r.contractPrice ? Number(r.contractPrice) : null,
      listPrice: r.listPrice ? Number(r.listPrice) : null,
      uom: r.uom,
      category: r.category,
    }))
  )
}

// ─── Get Facility Products (load all for a facility+vendor) ────────

export async function getVendorFacilityProducts(input: {
  vendorId?: string
  facilityId: string
}): Promise<VendorProductRow[]> {
  const { vendor } = await requireVendor()
  const vendorId = vendor.id
  const { facilityId } = input

  const results = await prisma.pricingFile.findMany({
    where: { vendorId, facilityId },
    take: 200,
    orderBy: { productDescription: "asc" },
  })

  return serialize(
    results.map((r) => ({
      id: r.id,
      vendorItemNo: r.vendorItemNo,
      description: r.productDescription,
      contractPrice: r.contractPrice ? Number(r.contractPrice) : null,
      listPrice: r.listPrice ? Number(r.listPrice) : null,
      uom: r.uom,
      category: r.category,
    }))
  )
}

// ─── Create PO (vendor-side) ───────────────────────────────────────

export async function createVendorPurchaseOrder(rawInput: CreateVendorPOInput) {
  const { vendor } = await requireVendor()
  await requireCanMutate()

  // M8 (2026-06-09 audit): validate with zod, mirroring the facility
  // path. Previously quantity 0, negative prices, empty descriptions and
  // unparseable dates flowed straight into Prisma. The silently-discarded
  // `notes` / `vendorId` inputs were dropped from the input type.
  const input = createVendorPOSchema.parse(rawInput)

  // Charles audit round-7 CONCERN: verify the contract (if provided)
  // belongs to this vendor, AND that this vendor has a relationship
  // with the facility. Pre-fix the vendor could write a PO against
  // ANY facility/contractId combination.
  if (input.contractId) {
    // M11: vendor scope includes grouped membership (additionalVendorIds).
    const contract = await prisma.contract.findFirst({
      where: { id: input.contractId, ...vendorContractScope(vendor.id) },
      select: {
        facilityId: true,
        contractFacilities: { select: { facilityId: true } },
      },
    })
    if (!contract) {
      throw new Error("Contract not found or not owned by this vendor.")
    }
    // M12: a ContractFacility join member is a legitimate facility for
    // this contract, not just the primary facilityId.
    const facilityOnContract =
      contract.facilityId === input.facilityId ||
      contract.contractFacilities.some(
        (cf) => cf.facilityId === input.facilityId,
      )
    if (!facilityOnContract) {
      throw new Error("Contract belongs to a different facility.")
    }
  } else {
    // 2026-04-26 (V1-M2): off-contract path was unguarded — vendors
    // could POST a PO at any facilityId without a contract relationship.
    // Require evidence of a relationship: an existing contract OR a
    // prior PO at the same facility. If neither exists, reject.
    const hasRelationship =
      (await prisma.contract.count({
        where: {
          ...vendorContractScope(vendor.id),
          AND: [
            {
              OR: [
                { facilityId: input.facilityId },
                {
                  contractFacilities: {
                    some: { facilityId: input.facilityId },
                  },
                },
              ],
            },
          ],
        },
      })) > 0 ||
      (await prisma.purchaseOrder.count({
        where: { vendorId: vendor.id, facilityId: input.facilityId },
      })) > 0
    if (!hasRelationship) {
      throw new Error(
        "No relationship with this facility — off-contract POs are only allowed at facilities you already serve.",
      )
    }
  }

  const totalCost = input.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  )

  // M7 (2026-06-09 audit): poNumber is unique per FACILITY
  // (facilityId_poNumber) — was previously numbered per vendor, which
  // collides across vendors at the same facility. Count-based numbering
  // can still race, so catch P2002, recount with an attempt offset and
  // retry up to 3 attempts.
  const createOnce = async (attempt: number) => {
    const count = await prisma.purchaseOrder.count({
      where: { facilityId: input.facilityId },
    })
    const poNumber = `PO-${String(count + 1 + attempt).padStart(5, "0")}`
    return prisma.purchaseOrder.create({
      data: {
        poNumber,
        facilityId: input.facilityId,
        vendorId: vendor.id,
        contractId: input.contractId ?? null,
        orderDate: new Date(input.orderDate),
        totalCost,
        status: "pending",
        // M9: ONE off-contract definition — no header contract ⇒
        // off-contract. Mirrors the facility create path.
        isOffContract: !input.contractId,
        lineItems: {
          create: input.lineItems.map((item) => ({
            sku: item.sku,
            inventoryDescription: item.inventoryDescription,
            vendorItemNo: item.vendorItemNo,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            extendedPrice: item.quantity * item.unitPrice,
            uom: item.uom,
            isOffContract: item.isOffContract,
          })),
        },
      },
      include: { lineItems: true, facility: { select: { name: true } } },
    })
  }

  let po: Awaited<ReturnType<typeof createOnce>> | undefined
  for (let attempt = 0; attempt < 3 && !po; attempt++) {
    try {
      po = await createOnce(attempt)
    } catch (err) {
      const isUniqueCollision =
        err !== null &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: unknown }).code === "P2002"
      if (!isUniqueCollision || attempt >= 2) throw err
    }
  }
  if (!po) throw new Error("Failed to allocate a PO number")

  return serialize({
    id: po.id,
    poNumber: po.poNumber,
    facilityName: po.facility.name,
    orderDate: po.orderDate.toISOString(),
    totalCost: Number(po.totalCost ?? 0),
    status: po.status,
  })
}
