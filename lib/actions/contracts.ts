"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { computeRebateFromPrismaTiers } from "@/lib/rebates/calculate"
import {
  contractFiltersSchema,
  createContractSchema,
  updateContractSchema,
  type ContractFilters,
  type CreateContractInput,
  type UpdateContractInput,
} from "@/lib/validators/contracts"
import type { Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import {
  contractOwnershipWhere,
  contractsOwnedByFacility,
} from "@/lib/actions/contracts-auth"

// ─── List Contracts ──────────────────────────────────────────────

export async function getContracts(input: ContractFilters) {
  const { facility } = await requireFacility()
  const filters = contractFiltersSchema.parse(input)

  const conditions: Prisma.ContractWhereInput[] = [
    contractsOwnedByFacility(facility.id),
  ]

  if (filters.status) conditions.push({ status: filters.status })
  if (filters.type) conditions.push({ contractType: filters.type })
  if (filters.search) {
    conditions.push({
      OR: [
        { name: { contains: filters.search, mode: "insensitive" } },
        { vendor: { name: { contains: filters.search, mode: "insensitive" } } },
        { contractNumber: { contains: filters.search, mode: "insensitive" } },
      ],
    })
  }

  const where: Prisma.ContractWhereInput = { AND: conditions }

  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true, logoUrl: true } },
        productCategory: { select: { id: true, name: true } },
        facility: { select: { id: true, name: true } },
        rebates: { select: { rebateEarned: true, rebateCollected: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: ((filters.page ?? 1) - 1) * (filters.pageSize ?? 20),
      take: filters.pageSize ?? 20,
    }),
    prisma.contract.count({ where }),
  ])

  // Derive aggregated rebateEarned / rebateCollected per contract so UI can
  // render the "Rebate Earned" column without an extra round-trip.
  const withDerived = contracts.map((c) => {
    const rebateEarned = (c.rebates ?? []).reduce(
      (sum, r) => sum + Number(r.rebateEarned ?? 0),
      0,
    )
    const rebateCollected = (c.rebates ?? []).reduce(
      (sum, r) => sum + Number(r.rebateCollected ?? 0),
      0,
    )
    return { ...c, rebateEarned, rebateCollected }
  })

  return serialize({ contracts: withDerived, total })
}

// ─── Merged List (system + vendor-submitted pending) ─────────────
//
// Returns both system Contract rows and vendor-submitted PendingContract
// rows in a single array with a typed `source` discriminator. Used by
// the facility contracts list page (contracts-list-closure §4.0).

export type MergedContract = {
  id: string // stable row id (prefixed to avoid collision across sources)
  contractId: string | null // real Contract.id when source=system, null for pending
  name: string
  source: "system" | "vendor"
  status:
    | "active"
    | "expired"
    | "expiring"
    | "pending"
    | "draft"
    | "rejected"
    | "revision_requested"
  vendor: { id: string; name: string }
  contractType: string
  facilityId: string | null
  facilities: string[]
  effectiveDate: Date | null
  expirationDate: Date | null
  totalValue: number
  score: number | null
}

/**
 * Translate a PendingContractStatus to the unified status enum
 * used by the merged list. `approved` is promoted to `active` because
 * once approved, a pending row has already become a real Contract and
 * wouldn't appear in this list anyway; we treat the edge case defensively.
 * `withdrawn` is filtered out upstream.
 */
function mapPendingStatus(
  status:
    | "draft"
    | "submitted"
    | "approved"
    | "rejected"
    | "revision_requested"
    | "withdrawn",
): MergedContract["status"] | null {
  switch (status) {
    case "submitted":
      return "pending"
    case "approved":
      return "active"
    case "rejected":
      return "rejected"
    case "revision_requested":
      return "revision_requested"
    case "draft":
      return "draft"
    case "withdrawn":
      return null // hide
  }
}

export async function getMergedContracts(options?: {
  /**
   * Optional 3-way facility filter (canonical doc §7). When set:
   * - System contracts match `facilityId == filter` OR any
   *   ContractFacility row has `facilityId == filter`.
   * - Vendor-submitted pending contracts match on `facilityId == filter`
   *   only (PendingContract has no multi-facility join yet).
   */
  facilityFilter?: string | null
}) {
  const { facility } = await requireFacility()
  const facilityFilter = options?.facilityFilter ?? null

  // Build the system-contracts where clause — base ownership + optional
  // 3-way filter narrowing.
  const systemWhere: Prisma.ContractWhereInput = {
    AND: [
      contractsOwnedByFacility(facility.id),
      ...(facilityFilter
        ? [
            {
              OR: [
                { facilityId: facilityFilter },
                { contractFacilities: { some: { facilityId: facilityFilter } } },
              ],
            },
          ]
        : []),
    ],
  }

  const pendingWhere: Prisma.PendingContractWhereInput = {
    facilityId: facilityFilter ?? facility.id,
    status: { in: ["submitted", "revision_requested", "rejected", "draft"] },
  }

  const [systemContracts, pendingContracts] = await Promise.all([
    prisma.contract.findMany({
      where: systemWhere,
      include: {
        vendor: { select: { id: true, name: true } },
        contractFacilities: { select: { facilityId: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.pendingContract.findMany({
      where: pendingWhere,
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { submittedAt: "desc" },
    }),
  ])

  const systemRows: MergedContract[] = systemContracts.map((c) => ({
    id: `system:${c.id}`,
    contractId: c.id,
    name: c.name,
    source: "system",
    status: c.status,
    vendor: { id: c.vendor.id, name: c.vendor.name },
    contractType: c.contractType,
    facilityId: c.facilityId,
    facilities: Array.from(
      new Set([
        ...(c.facilityId ? [c.facilityId] : []),
        ...c.contractFacilities.map((cf) => cf.facilityId),
      ]),
    ),
    effectiveDate: c.effectiveDate,
    expirationDate: c.expirationDate,
    totalValue: Number(c.totalValue),
    // Contract.score doesn't exist on the current schema; reserved for
    // future contracts-rewrite scoring subsystem. Always null for now.
    score: null,
  }))

  const vendorRows: MergedContract[] = pendingContracts
    .map((p): MergedContract | null => {
      const mapped = mapPendingStatus(p.status)
      if (mapped === null) return null
      return {
        id: `vendor:${p.id}`,
        contractId: null,
        name: p.contractName,
        source: "vendor",
        status: mapped,
        vendor: { id: p.vendor.id, name: p.vendor.name },
        contractType: p.contractType,
        facilityId: p.facilityId,
        facilities: p.facilityId ? [p.facilityId] : [],
        effectiveDate: p.effectiveDate,
        expirationDate: p.expirationDate,
        totalValue: Number(p.totalValue ?? 0),
        score: null,
      }
    })
    .filter((x): x is MergedContract => x !== null)

  return serialize([...systemRows, ...vendorRows])
}

// ─── Single Contract ─────────────────────────────────────────────

export async function getContract(id: string) {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(id, facility.id),
    include: {
      vendor: { select: { id: true, name: true, logoUrl: true, contactName: true, contactEmail: true } },
      productCategory: { select: { id: true, name: true } },
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      documents: { orderBy: { uploadDate: "desc" } },
      contractFacilities: {
        include: { facility: { select: { id: true, name: true } } },
      },
      contractCategories: {
        select: {
          productCategoryId: true,
          productCategory: { select: { id: true, name: true } },
        },
      },
      rebates: {
        select: { id: true, rebateEarned: true, rebateCollected: true },
      },
      createdBy: { select: { id: true, name: true } },
    },
  })

  // Derive aggregates from the rebates relation
  let rebateEarned = contract.rebates.reduce(
    (sum, r) => sum + Number(r.rebateEarned ?? 0),
    0
  )
  let rebateCollected = contract.rebates.reduce(
    (sum, r) => sum + Number(r.rebateCollected ?? 0),
    0
  )

  // Always aggregate current COG spend against this contract's vendor —
  // we need it for tier-progress surfaces even when persisted rebate
  // rows already exist. When persisted rebate rows are zero but there's
  // matching spend, we also recompute earned/collected from the tiers
  // below.
  const cogAgg = await prisma.cOGRecord.aggregate({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
    },
    _sum: { extendedPrice: true },
  })
  const currentSpend = Number(cogAgg._sum.extendedPrice ?? 0)

  // Dynamic fallback: if no persisted rebate rows exist but the contract
  // has tiers and matching COG spend, compute rebates from live data
  // using the shared rebate calculator.
  if (rebateEarned === 0 && contract.terms.length > 0) {
    const firstTerm = contract.terms[0]
    const tiers = firstTerm?.tiers ?? []
    if (tiers.length > 0 && currentSpend > 0) {
      const result = computeRebateFromPrismaTiers(currentSpend, tiers, {
        method: firstTerm?.rebateMethod ?? "cumulative",
      })
      rebateEarned = result.rebateEarned
      rebateCollected = result.rebateCollected
    }
  }

  return serialize({ ...contract, rebateEarned, rebateCollected, currentSpend })
}

// ─── Contract Stats ──────────────────────────────────────────────

export async function getContractStats() {
  const { facility } = await requireFacility()

  const where = contractsOwnedByFacility(facility.id)

  const [totalContracts, aggregates] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.aggregate({
      where,
      _sum: { totalValue: true, annualValue: true },
    }),
  ])

  const rebateResult = await prisma.rebate.aggregate({
    where: { facilityId: facility.id },
    _sum: { rebateEarned: true },
  })

  return serialize({
    totalContracts,
    totalValue: Number(aggregates._sum.totalValue ?? 0),
    totalRebates: Number(rebateResult._sum?.rebateEarned ?? 0),
  })
}

// ─── Per-row Metrics Batch (contracts-list-closure §4.1) ─────────
//
// Returns { [contractId]: { spend, rebate, totalValue } } for a batch
// of contracts, letting the list page render per-row metrics without
// N round-trips. Resolution chain per contract:
//   1. Aggregate COGRecord.extendedPrice WHERE contractId = X (fastest
//      once COG enrichment has populated the contractId FK)
//   2. Fall back to ContractPeriod.totalSpend sum
//   3. Final fallback: contract-level stored `totalValue` (passthrough)
//
// Rebate is always computed live from `firstTerm.tiers` using the
// shared rebate calculator (ensures alignment with the detail page).

export async function getContractMetricsBatch(contractIds: string[]): Promise<
  Record<
    string,
    {
      spend: number
      rebate: number
      totalValue: number
    }
  >
> {
  const { facility } = await requireFacility()
  if (contractIds.length === 0) return {}

  // Load contract shells with terms (for rebate computation) + totalValue.
  const contracts = await prisma.contract.findMany({
    where: {
      id: { in: contractIds },
      ...contractsOwnedByFacility(facility.id),
    },
    select: {
      id: true,
      vendorId: true,
      totalValue: true,
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  })

  // Pass 1 — aggregate COG spend by contractId (fast: one query).
  const cogByContract = await prisma.cOGRecord.groupBy({
    by: ["contractId"],
    where: {
      facilityId: facility.id,
      contractId: { in: contractIds },
    },
    _sum: { extendedPrice: true },
  })
  const spendFromCog = new Map<string, number>()
  for (const row of cogByContract) {
    if (row.contractId) {
      spendFromCog.set(row.contractId, Number(row._sum.extendedPrice ?? 0))
    }
  }

  // Pass 2 — ContractPeriod fallback for rows where COG pass yielded zero.
  const periodByContract = await prisma.contractPeriod.groupBy({
    by: ["contractId"],
    where: { contractId: { in: contractIds } },
    _sum: { totalSpend: true },
  })
  const spendFromPeriods = new Map<string, number>()
  for (const row of periodByContract) {
    spendFromPeriods.set(row.contractId, Number(row._sum.totalSpend ?? 0))
  }

  // Pass 3 — cross-vendor COG spend as final fallback (for vendors
  // whose COG rows haven't been enriched with contractId yet).
  const vendorIdToContractIds = new Map<string, string[]>()
  for (const c of contracts) {
    const existing = vendorIdToContractIds.get(c.vendorId) ?? []
    existing.push(c.id)
    vendorIdToContractIds.set(c.vendorId, existing)
  }
  const vendorIds = Array.from(vendorIdToContractIds.keys())
  const vendorSpendAgg =
    vendorIds.length > 0
      ? await prisma.cOGRecord.groupBy({
          by: ["vendorId"],
          where: {
            facilityId: facility.id,
            vendorId: { in: vendorIds },
          },
          _sum: { extendedPrice: true },
        })
      : []
  const spendFromVendor = new Map<string, number>()
  for (const row of vendorSpendAgg) {
    if (row.vendorId) {
      spendFromVendor.set(row.vendorId, Number(row._sum.extendedPrice ?? 0))
    }
  }

  // Combine into per-contract result.
  const result: Record<
    string,
    { spend: number; rebate: number; totalValue: number }
  > = {}
  for (const c of contracts) {
    const cogSpend = spendFromCog.get(c.id) ?? 0
    const periodSpend = spendFromPeriods.get(c.id) ?? 0
    const vendorSpend = spendFromVendor.get(c.vendorId) ?? 0

    // Precedence: COG (enrichment) → ContractPeriod → Vendor-level COG.
    const spend = cogSpend > 0 ? cogSpend : periodSpend > 0 ? periodSpend : vendorSpend

    let rebate = 0
    const firstTerm = c.terms[0]
    if (firstTerm && firstTerm.tiers.length > 0 && spend > 0) {
      const result = computeRebateFromPrismaTiers(spend, firstTerm.tiers, {
        method: firstTerm.rebateMethod ?? "cumulative",
      })
      rebate = result.rebateEarned
    }

    result[c.id] = {
      spend,
      rebate,
      totalValue: Number(c.totalValue),
    }
  }

  return result
}

// ─── Create Contract ─────────────────────────────────────────────

export async function createContract(input: CreateContractInput) {
  const session = await requireFacility()
  const data = createContractSchema.parse(input)

  const contract = await prisma.contract.create({
    data: {
      name: data.name,
      contractNumber: data.contractNumber,
      vendorId: data.vendorId,
      facilityId: session.facility.id,
      productCategoryId: data.productCategoryId,
      contractType: data.contractType,
      status: data.status,
      effectiveDate: new Date(data.effectiveDate),
      expirationDate: new Date(data.expirationDate),
      autoRenewal: data.autoRenewal,
      terminationNoticeDays: data.terminationNoticeDays,
      totalValue: data.totalValue,
      annualValue: data.annualValue,
      description: data.description,
      notes: data.notes,
      gpoAffiliation: data.gpoAffiliation,
      performancePeriod: data.performancePeriod,
      rebatePayPeriod: data.rebatePayPeriod,
      isMultiFacility: data.isMultiFacility,
      createdById: session.user.id,
      ...(data.facilityIds.length > 0 && {
        isMultiFacility: true,
        contractFacilities: {
          create: data.facilityIds.map((fId) => ({ facilityId: fId })),
        },
      }),
      ...(data.categoryIds.length > 0 && {
        contractCategories: {
          create: data.categoryIds.map((cId) => ({ productCategoryId: cId })),
        },
      }),
    },
  })

  await logAudit({
    userId: session.user.id,
    action: "contract.created",
    entityType: "contract",
    entityId: contract.id,
    metadata: { name: data.name, vendorId: data.vendorId },
  })

  // Recompute COG match-statuses for this vendor so rows flip to
  // on_contract / price_variance / out_of_scope as appropriate.
  // Scope tight: only the affected vendor at this facility.
  await recomputeMatchStatusesForVendor(prisma, {
    vendorId: data.vendorId,
    facilityId: session.facility.id,
  })
  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard")

  return serialize(contract)
}

// ─── Update Contract ─────────────────────────────────────────────

export async function updateContract(id: string, input: UpdateContractInput) {
  const session = await requireFacility()
  const { facility } = session
  const data = updateContractSchema.parse(input)

  // Verify ownership before updating
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(id, facility.id),
    select: { id: true },
  })

  const updateData: Prisma.ContractUpdateInput = {}

  if (data.name !== undefined) updateData.name = data.name
  if (data.contractNumber !== undefined) updateData.contractNumber = data.contractNumber
  if (data.vendorId !== undefined) updateData.vendor = { connect: { id: data.vendorId } }
  if (data.productCategoryId !== undefined) updateData.productCategory = { connect: { id: data.productCategoryId } }
  if (data.contractType !== undefined) updateData.contractType = data.contractType
  if (data.status !== undefined) updateData.status = data.status
  if (data.effectiveDate !== undefined) updateData.effectiveDate = new Date(data.effectiveDate)
  if (data.expirationDate !== undefined) updateData.expirationDate = new Date(data.expirationDate)
  if (data.autoRenewal !== undefined) updateData.autoRenewal = data.autoRenewal
  if (data.terminationNoticeDays !== undefined) updateData.terminationNoticeDays = data.terminationNoticeDays
  if (data.totalValue !== undefined) updateData.totalValue = data.totalValue
  if (data.annualValue !== undefined) updateData.annualValue = data.annualValue
  if (data.description !== undefined) updateData.description = data.description
  if (data.notes !== undefined) updateData.notes = data.notes
  if (data.gpoAffiliation !== undefined) updateData.gpoAffiliation = data.gpoAffiliation
  if (data.performancePeriod !== undefined) updateData.performancePeriod = data.performancePeriod
  if (data.rebatePayPeriod !== undefined) updateData.rebatePayPeriod = data.rebatePayPeriod
  if (data.isMultiFacility !== undefined) updateData.isMultiFacility = data.isMultiFacility

  if (data.facilityIds !== undefined) {
    await prisma.contractFacility.deleteMany({ where: { contractId: id } })
    if (data.facilityIds.length > 0) {
      updateData.isMultiFacility = true
      await prisma.contractFacility.createMany({
        data: data.facilityIds.map((fId) => ({ contractId: id, facilityId: fId })),
      })
    }
  }

  if (data.categoryIds !== undefined) {
    await prisma.contractProductCategory.deleteMany({ where: { contractId: id } })
    if (data.categoryIds.length > 0) {
      updateData.productCategory = { connect: { id: data.categoryIds[0] } }
      await prisma.contractProductCategory.createMany({
        data: data.categoryIds.map((cId) => ({ contractId: id, productCategoryId: cId })),
      })
    }
  }

  const contract = await prisma.contract.update({
    where: { id },
    data: updateData,
  })

  await logAudit({
    userId: session.user.id,
    action: "contract.updated",
    entityType: "contract",
    entityId: id,
    metadata: { updatedFields: Object.keys(updateData) },
  })

  // Recompute COG match-statuses for this contract's vendor. If the vendor
  // changed, recompute for both the old and new vendor so COG rows flip
  // off the old contract and onto (or off of) the new one.
  const vendorsToRecompute = new Set<string>()
  vendorsToRecompute.add(contract.vendorId)
  if (data.vendorId !== undefined && data.vendorId !== contract.vendorId) {
    vendorsToRecompute.add(data.vendorId)
  }
  for (const vendorId of vendorsToRecompute) {
    await recomputeMatchStatusesForVendor(prisma, {
      vendorId,
      facilityId: facility.id,
    })
  }
  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath(`/dashboard/contracts/${id}`)
  revalidatePath("/dashboard")

  return serialize(contract)
}

// ─── Create Contract Document ───────────────────────────────────

export async function createContractDocument(input: {
  contractId: string
  name: string
  type?: string
  url?: string
}) {
  await requireFacility()
  return prisma.contractDocument.create({
    data: {
      contractId: input.contractId,
      name: input.name,
      type: (input.type as any) ?? "main",
      url: input.url,
    },
  })
}

// ─── Delete Contract Document ───────────────────────────────────

export async function deleteContractDocument(id: string) {
  const session = await requireFacility()
  const { facility } = session

  // Verify the document belongs to a contract owned by this facility
  const doc = await prisma.contractDocument.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      contractId: true,
      contract: {
        select: {
          facilityId: true,
          contractFacilities: { select: { facilityId: true } },
        },
      },
    },
  })
  const owned =
    doc.contract.facilityId === facility.id ||
    doc.contract.contractFacilities.some((cf) => cf.facilityId === facility.id)
  if (!owned) {
    throw new Error("Not authorized to delete this document")
  }

  await prisma.contractDocument.delete({ where: { id } })

  await logAudit({
    userId: session.user.id,
    action: "contract_document.deleted",
    entityType: "contractDocument",
    entityId: id,
    metadata: { contractId: doc.contractId },
  })
}

// ─── Delete Contract ─────────────────────────────────────────────

export async function deleteContract(id: string) {
  const session = await requireFacility()
  const { facility } = session

  // Verify ownership + capture vendorId before deleting so we can
  // recompute COG match-statuses after.
  const existing = await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(id, facility.id),
    select: { id: true, vendorId: true },
  })

  await prisma.contract.delete({ where: { id } })

  await logAudit({
    userId: session.user.id,
    action: "contract.deleted",
    entityType: "contract",
    entityId: id,
  })

  // Recompute: rows that were on this contract flip to
  // off_contract_item / out_of_scope depending on remaining contracts.
  await recomputeMatchStatusesForVendor(prisma, {
    vendorId: existing.vendorId,
    facilityId: facility.id,
  })
  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard")
}

// ─── Compute-heavy actions (split to lib/actions/contracts/*) ───────
//
// These are split into per-action files during subsystem F5 tech debt.
// Next.js disallows non-async-function re-exports from "use server"
// modules, so callers must import them directly from the sub-file:
//   import { getContractInsights } from "@/lib/actions/contracts/insights"
//   import { getAccrualTimeline } from "@/lib/actions/contracts/accrual"
//   import { getContractMarginAnalysis } from "@/lib/actions/contracts/margin"
//   import { getContractTieInBundle } from "@/lib/actions/contracts/tie-in"
