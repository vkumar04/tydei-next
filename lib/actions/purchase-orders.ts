"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import {
  createPOSchema,
  poFiltersSchema,
  type CreatePOInput,
  type POFilters,
} from "@/lib/validators/purchase-orders"
import { canTransitionPOStatus } from "@/lib/purchase-orders/status-flow"
import type { POStatus, Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"

// ─── List Purchase Orders ───────────────────────────────────────

export async function getPurchaseOrders(input: POFilters) {
  const { facility } = await requireFacility()
  const filters = poFiltersSchema.parse(input)

  const conditions: Prisma.PurchaseOrderWhereInput[] = [{ facilityId: facility.id }]

  if (filters.vendorId) conditions.push({ vendorId: filters.vendorId })
  if (filters.status) conditions.push({ status: filters.status })

  const where: Prisma.PurchaseOrderWhereInput = { AND: conditions }
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20

  const [orders, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true } },
        contract: { select: { id: true, name: true } },
        _count: { select: { lineItems: true } },
      },
      orderBy: { orderDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.purchaseOrder.count({ where }),
  ])

  return serialize({ orders, total })
}

// ─── PO Stats ──────────────────────────────────────────────────

export async function getPOStats(_facilityId?: string) {
  const { facility } = await requireFacility()

  const facilityWhere: Prisma.PurchaseOrderWhereInput = { facilityId: facility.id }

  // H2 (2026-06-09 audit): the list page used to reduce hero KPIs and tab
  // counts over the fetched page rows, silently truncating once a facility
  // had more than one page of POs. All aggregates are now server-side:
  // on/off-contract spend + counts (on-contract = contractId != null) and
  // per-status counts.
  const [onAgg, offAgg, statusGroups, totalItemsAgg] = await Promise.all([
    prisma.purchaseOrder.aggregate({
      where: { ...facilityWhere, contractId: { not: null } },
      _sum: { totalCost: true },
      _count: { _all: true },
    }),
    prisma.purchaseOrder.aggregate({
      where: { ...facilityWhere, contractId: null },
      _sum: { totalCost: true },
      _count: { _all: true },
    }),
    prisma.purchaseOrder.groupBy({
      by: ["status"],
      where: facilityWhere,
      _count: { _all: true },
    }),
    prisma.pOLineItem.aggregate({
      where: { purchaseOrder: facilityWhere },
      _sum: { quantity: true },
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

  const onContractSpend = Number(onAgg._sum.totalCost ?? 0)
  const offContractSpend = Number(offAgg._sum.totalCost ?? 0)

  return serialize({
    totalPOs: onAgg._count._all + offAgg._count._all,
    pendingApproval: statusCounts.pending,
    totalValue: onContractSpend + offContractSpend,
    totalItems: Number(totalItemsAgg._sum.quantity ?? 0),
    onContractSpend,
    offContractSpend,
    onContractCount: onAgg._count._all,
    offContractCount: offAgg._count._all,
    statusCounts,
  })
}

// ─── Facility Vendors (for filter dropdown) ────────────────────

export async function getFacilityVendors(_facilityId?: string) {
  const { facility } = await requireFacility()

  // Include both primary-facility contracts (Contract.facilityId) AND
  // multi-facility contracts shared via the ContractFacility join. Prior
  // version only checked the primary, so vendors attached only via the
  // join were missing from the dropdown (Charles 2026-04-26).
  const vendors = await prisma.vendor.findMany({
    where: {
      contracts: { some: contractsOwnedByFacility(facility.id) },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return serialize(vendors)
}

// ─── Get Single PO ──────────────────────────────────────────────

export async function getPurchaseOrder(id: string) {
  const { facility } = await requireFacility()

  const po = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
    include: {
      vendor: { select: { id: true, name: true } },
      contract: { select: { id: true, name: true } },
      lineItems: { orderBy: { createdAt: "asc" } },
    },
  })
  return serialize(po)
}

// ─── Create PO ──────────────────────────────────────────────────

export async function createPurchaseOrder(input: CreatePOInput) {
  // Charles audit round-9 CONCERN: validate any client-supplied
  // contractId (header + per-line) belongs to this facility.
  // Pre-fix a facility could tag its PO/line items with another
  // facility's contract id, polluting joined views and savings math.
  const { facility } = await requireFacility()
  const data = createPOSchema.parse(input)
  const contractIds = new Set<string>()
  if (data.contractId) contractIds.add(data.contractId)
  for (const item of data.lineItems) {
    if (item.contractId) contractIds.add(item.contractId)
  }
  if (contractIds.size > 0) {
    // M12 (2026-06-09 audit): use the canonical ownership helper so
    // multi-facility contracts shared via the ContractFacility join are
    // accepted, not just primary-facility contracts.
    const owned = await prisma.contract.count({
      where: {
        id: { in: Array.from(contractIds) },
        ...contractsOwnedByFacility(facility.id),
      },
    })
    if (owned !== contractIds.size) {
      throw new Error(
        "One or more referenced contracts are not owned by this facility",
      )
    }
  }

  // 2026-06-09 audit BLOCKER: validate the client-supplied vendorId. The
  // symmetric vendor-side hole was fixed in V1-M2 (vendor-purchase-orders
  // verifies the facility relationship) but this side never got the
  // guard — a facility could create POs against an arbitrary vendorId,
  // injecting rows into that vendor's PO list, hero totals, and
  // fulfillment rate. Require an actual relationship: a contract with
  // the vendor (incl. grouped membership) or prior COG history.
  const [vendorContractCount, vendorCogCount] = await Promise.all([
    prisma.contract.count({
      // AND composition — contractsOwnedByFacility returns an OR clause
      // itself; spreading it next to another OR key silently overwrote
      // the facility scoping.
      where: {
        AND: [
          contractsOwnedByFacility(facility.id),
          {
            OR: [
              { vendorId: data.vendorId },
              { additionalVendorIds: { has: data.vendorId } },
            ],
          },
        ],
      },
    }),
    prisma.cOGRecord.count({
      where: { facilityId: facility.id, vendorId: data.vendorId },
    }),
  ])
  if (vendorContractCount === 0 && vendorCogCount === 0) {
    throw new Error(
      "Vendor is not associated with this facility — no contract or purchase history found",
    )
  }

  const totalCost = data.lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  )

  // M7 (2026-06-09 audit): poNumber is unique per facility
  // (facilityId_poNumber). Numbering is count-based, so concurrent
  // creates (or legacy per-vendor numbering gaps) can collide — catch
  // P2002, recount with an attempt offset, retry up to 3 attempts.
  const createOnce = async (attempt: number) => {
    const count = await prisma.purchaseOrder.count({
      where: { facilityId: facility.id },
    })
    const poNumber = `PO-${String(count + 1 + attempt).padStart(5, "0")}`
    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        facilityId: facility.id,
        vendorId: data.vendorId,
        contractId: data.contractId,
        orderDate: new Date(data.orderDate),
        totalCost,
        // H5: the form's Submit button sends the PO directly to the
        // vendor; Save as Draft keeps it editable.
        status: data.submit ? "sent" : "draft",
        // M9: ONE off-contract definition — a PO is off-contract iff it
        // has no header contract. Mirrors the vendor create path and the
        // facility list's `po.contract == null` classification.
        isOffContract: !data.contractId,
        lineItems: {
          create: data.lineItems.map((item) => ({
            sku: item.sku,
            inventoryDescription: item.inventoryDescription,
            vendorItemNo: item.vendorItemNo,
            manufacturerNo: item.manufacturerNo,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            extendedPrice: item.quantity * item.unitPrice,
            uom: item.uom,
            isOffContract: item.isOffContract,
            contractId: item.contractId,
          })),
        },
      },
      include: { lineItems: true },
    })
    return { po, poNumber }
  }

  let created: Awaited<ReturnType<typeof createOnce>> | undefined
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    try {
      created = await createOnce(attempt)
    } catch (err) {
      const isUniqueCollision =
        err !== null &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: unknown }).code === "P2002"
      if (!isUniqueCollision || attempt >= 2) throw err
    }
  }
  if (!created) throw new Error("Failed to allocate a PO number")
  const { po, poNumber } = created

  await logAudit({
    userId: facility.id,
    action: "purchaseOrder.created",
    entityType: "purchaseOrder",
    entityId: po.id,
    metadata: { poNumber, lineItemCount: data.lineItems.length, totalCost },
  })

  revalidatePath("/dashboard/purchase-orders")

  return serialize(po)
}

// ─── Update PO Status ───────────────────────────────────────────

export async function updatePOStatus(id: string, status: POStatus) {
  const { facility } = await requireFacility()

  // H4 (2026-06-09 audit): validate the transition server-side against the
  // canonical PO_STATUS_FLOW map. Previously any status jump (including
  // resurrecting completed/cancelled POs) was accepted.
  const current = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
    select: { status: true },
  })
  if (!canTransitionPOStatus(current.status, status)) {
    throw new Error(
      `Invalid status transition: ${current.status} → ${status}`,
    )
  }

  await prisma.purchaseOrder.update({
    where: { id, facilityId: facility.id },
    data: { status },
  })

  await logAudit({
    userId: facility.id,
    action: `purchaseOrder.${status}`,
    entityType: "purchaseOrder",
    entityId: id,
  })

  revalidatePath("/dashboard/purchase-orders")
  revalidatePath(`/dashboard/purchase-orders/${id}`)
}

// ─── Search Products ────────────────────────────────────────────

export async function searchProducts(input: {
  facilityId?: string
  query: string
  vendorId?: string
}) {
  const { facility } = await requireFacility()
  const facilityId = facility.id
  const { query, vendorId } = input

  if (!query || query.length < 2) return []

  const conditions: Prisma.PricingFileWhereInput[] = [
    { facilityId },
    {
      OR: [
        { productDescription: { contains: query, mode: "insensitive" } },
        { vendorItemNo: { contains: query, mode: "insensitive" } },
      ],
    },
  ]
  if (vendorId) conditions.push({ vendorId })

  const results = await prisma.pricingFile.findMany({
    where: { AND: conditions },
    select: {
      id: true,
      vendorItemNo: true,
      productDescription: true,
      contractPrice: true,
      listPrice: true,
      uom: true,
      vendorId: true,
    },
    take: 20,
  })

  return serialize(results.map((r) => ({
    id: r.id,
    vendorItemNo: r.vendorItemNo,
    description: r.productDescription,
    contractPrice: r.contractPrice ? Number(r.contractPrice) : null,
    listPrice: r.listPrice ? Number(r.listPrice) : null,
    uom: r.uom,
    vendorId: r.vendorId,
  })))
}
