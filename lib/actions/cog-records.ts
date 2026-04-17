"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  cogFiltersSchema,
  createCOGRecordSchema,
  bulkImportSchema,
  type COGFilters,
  type CreateCOGRecordInput,
  type BulkImportInput,
} from "@/lib/validators/cog-records"
import type { Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { resolveVendorIdsBulk } from "@/lib/vendors/resolve"

// ─── List COG Records ───────────────────────────────────────────

export async function getCOGRecords(input: COGFilters) {
  const { facility } = await requireFacility()
  const filters = cogFiltersSchema.parse(input)

  const conditions: Prisma.COGRecordWhereInput[] = [
    { facilityId: facility.id },
  ]

  if (filters.search) {
    conditions.push({
      OR: [
        { inventoryDescription: { contains: filters.search, mode: "insensitive" } },
        { inventoryNumber: { contains: filters.search, mode: "insensitive" } },
        { vendorItemNo: { contains: filters.search, mode: "insensitive" } },
      ],
    })
  }
  if (filters.vendorId) conditions.push({ vendorId: filters.vendorId })
  if (filters.dateFrom) {
    conditions.push({ transactionDate: { gte: new Date(filters.dateFrom) } })
  }
  if (filters.dateTo) {
    conditions.push({ transactionDate: { lte: new Date(filters.dateTo) } })
  }

  const where: Prisma.COGRecordWhereInput = { AND: conditions }
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20

  const orderBy = filters.sortBy
    ? { [filters.sortBy]: filters.sortOrder ?? "desc" }
    : { transactionDate: "desc" as const }

  const [records, total] = await Promise.all([
    prisma.cOGRecord.findMany({
      where,
      include: {
        vendor: {
          select: {
            id: true,
            name: true,
            // Every active/expiring contract the vendor has at this
            // facility. If there's at least one, the row is on-contract.
            // Capped at 1 so the payload stays small — we only need
            // existence.
            contracts: {
              where: {
                status: { in: ["active", "expiring"] },
                OR: [
                  { facilityId: facility.id },
                  { contractFacilities: { some: { facilityId: facility.id } } },
                ],
              },
              select: { id: true },
              take: 1,
            },
          },
        },
      },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.cOGRecord.count({ where }),
  ])

  // Attach a computed _onContract flag per row so the table renderer
  // doesn't need its own join or fall back to "does category have a
  // non-empty string" (which was the previous bug: rows imported without
  // categories were labelled Off Contract even when the vendor had an
  // active contract at this facility).
  const recordsWithFlag = records.map((r) => ({
    ...r,
    _onContract: (r.vendor?.contracts.length ?? 0) > 0,
  }))

  return serialize({ records: recordsWithFlag, total })
}

// ─── Create Single COG Record ───────────────────────────────────

export async function createCOGRecord(input: CreateCOGRecordInput) {
  const session = await requireFacility()
  const data = createCOGRecordSchema.parse(input)

  const record = await prisma.cOGRecord.create({
    data: {
      facilityId: session.facility.id,
      vendorId: data.vendorId,
      vendorName: data.vendorName,
      inventoryNumber: data.inventoryNumber,
      inventoryDescription: data.inventoryDescription,
      vendorItemNo: data.vendorItemNo,
      manufacturerNo: data.manufacturerNo,
      poNumber: data.poNumber,
      unitCost: data.unitCost,
      extendedPrice: data.extendedPrice,
      quantity: data.quantity,
      transactionDate: new Date(data.transactionDate),
      category: data.category,
      createdBy: session.user.id,
    },
  })
  return serialize(record)
}

// ─── Bulk Import COG Records ────────────────────────────────────

const BATCH_SIZE = 500

export async function bulkImportCOGRecords(input: BulkImportInput) {
  const session = await requireFacility()
  const data = bulkImportSchema.parse(input)

  let imported = 0
  let skipped = 0
  let errors = 0

  // Auto-create Vendor rows for any vendorName that doesn't already match an
  // existing vendor. The shared resolver runs exact → alias → fuzzy, then
  // creates vendors for names that still don't match (e.g. distributors
  // not in our catalog). Without this, imported COG data "loses" its
  // vendors and the Vendors list goes stale.
  const unmatchedNames = data.records
    .filter((r) => !r.vendorId && r.vendorName && r.vendorName.trim())
    .map((r) => r.vendorName!.trim())
  const nameToId = await resolveVendorIdsBulk(unmatchedNames)

  const resolveVendorId = (record: (typeof data.records)[number]) => {
    if (record.vendorId) return record.vendorId
    if (record.vendorName) {
      const id = nameToId.get(record.vendorName.trim().toLowerCase())
      if (id) return id
    }
    return record.vendorId
  }

  const toCreateData = (record: (typeof data.records)[number]) => ({
    facilityId: session.facility.id,
    vendorId: resolveVendorId(record),
    vendorName: record.vendorName,
    inventoryNumber: record.inventoryNumber,
    inventoryDescription: record.inventoryDescription,
    vendorItemNo: record.vendorItemNo,
    manufacturerNo: record.manufacturerNo,
    poNumber: record.poNumber,
    unitCost: record.unitCost,
    // Calculate extendedPrice from unitCost * quantity when not provided
    extendedPrice: record.extendedPrice ?? (record.unitCost * (record.quantity ?? 1)),
    quantity: record.quantity,
    transactionDate: new Date(record.transactionDate),
    category: record.category,
    createdBy: session.user.id,
  })

  for (let i = 0; i < data.records.length; i += BATCH_SIZE) {
    const batch = data.records.slice(i, i + BATCH_SIZE)

    try {
      if (data.duplicateStrategy === "keep_both") {
        const result = await prisma.cOGRecord.createMany({
          data: batch.map(toCreateData),
        })
        imported += result.count
        continue
      }

      // skip / overwrite — batch-lookup existing records first
      const existing = await prisma.cOGRecord.findMany({
        where: {
          facilityId: session.facility.id,
          OR: batch.map((r) => ({
            AND: [
              { inventoryNumber: r.inventoryNumber },
              { transactionDate: new Date(r.transactionDate) },
              ...(r.vendorItemNo ? [{ vendorItemNo: r.vendorItemNo }] : []),
            ],
          })),
        },
        select: {
          id: true,
          inventoryNumber: true,
          transactionDate: true,
          vendorItemNo: true,
        },
      })

      const existingKey = (inv: string, date: string, vItem: string | null) =>
        `${inv}|${date}|${vItem ?? ""}`
      const existingMap = new Map(
        existing.map((e) => [
          existingKey(
            e.inventoryNumber,
            e.transactionDate.toISOString().slice(0, 10),
            e.vendorItemNo,
          ),
          e.id,
        ]),
      )

      const newRecords: (typeof batch) = []
      const toOverwrite: { id: string; record: (typeof batch)[number] }[] = []

      for (const record of batch) {
        const key = existingKey(
          record.inventoryNumber,
          record.transactionDate,
          record.vendorItemNo ?? null,
        )
        const existingId = existingMap.get(key)

        if (existingId) {
          if (data.duplicateStrategy === "skip") {
            skipped++
          } else {
            toOverwrite.push({ id: existingId, record })
          }
        } else {
          newRecords.push(record)
        }
      }

      // Batch-overwrite existing records via transaction
      if (toOverwrite.length > 0) {
        try {
          await prisma.$transaction(
            toOverwrite.map(({ id, record }) =>
              prisma.cOGRecord.update({
                where: { id },
                data: {
                  vendorId: resolveVendorId(record),
                  vendorName: record.vendorName,
                  inventoryDescription: record.inventoryDescription,
                  manufacturerNo: record.manufacturerNo,
                  unitCost: record.unitCost,
                  extendedPrice: record.extendedPrice,
                  quantity: record.quantity,
                  category: record.category,
                },
              }),
            ),
          )
          imported += toOverwrite.length
        } catch {
          errors += toOverwrite.length
        }
      }

      // Batch-create all new records at once
      if (newRecords.length > 0) {
        const result = await prisma.cOGRecord.createMany({
          data: newRecords.map(toCreateData),
        })
        imported += result.count
      }
    } catch {
      errors += batch.length
    }
  }

  await logAudit({
    userId: session.user.id,
    action: "cog.imported",
    entityType: "cogRecord",
    metadata: { imported, skipped, errors, totalRecords: data.records.length },
  })

  return { imported, skipped, errors }
}

// ─── Vendor COG Spend (aggregate) ──────────────────────────────

export async function getVendorCOGSpend(vendorId: string): Promise<number> {
  const { facility } = await requireFacility()
  const result = await prisma.cOGRecord.aggregate({
    where: { facilityId: facility.id, vendorId },
    _sum: { extendedPrice: true },
  })
  return Number(result._sum.extendedPrice ?? 0)
}

// ─── Compute Pricing vs COG (projected spend) ──────────────────

/**
 * Match pricing file items against historical COG records to compute
 * projected annual spend. For each pricing item, finds the COG record
 * with the same vendorItemNo and uses historical quantity × proposed price.
 */
export async function computePricingVsCOG(
  vendorId: string,
  pricingItems: { vendorItemNo: string; unitPrice: number }[]
): Promise<number> {
  const { facility } = await requireFacility()

  if (pricingItems.length === 0) return 0

  // Get all COG records for this vendor with quantities
  const cogRecords = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId,
      vendorItemNo: { in: pricingItems.map((p) => p.vendorItemNo).filter(Boolean) },
    },
    select: { vendorItemNo: true, quantity: true },
  })

  // Sum quantities by vendorItemNo
  const cogQtyMap = new Map<string, number>()
  for (const r of cogRecords) {
    if (!r.vendorItemNo) continue
    cogQtyMap.set(r.vendorItemNo, (cogQtyMap.get(r.vendorItemNo) ?? 0) + r.quantity)
  }

  // For each pricing item, projected spend = historical qty × proposed price
  let total = 0
  let matchedItems = 0
  for (const item of pricingItems) {
    const historicalQty = cogQtyMap.get(item.vendorItemNo)
    if (historicalQty && historicalQty > 0) {
      total += historicalQty * item.unitPrice
      matchedItems++
    }
  }

  // If no COG matches found, fall back to vendor's total COG spend
  if (matchedItems === 0) {
    const result = await prisma.cOGRecord.aggregate({
      where: { facilityId: facility.id, vendorId },
      _sum: { extendedPrice: true },
    })
    return Number(result._sum.extendedPrice ?? 0)
  }

  return total
}

// ─── Match COG Records to Contracts (the "Match Pricing" action) ─

/**
 * Re-processes every COG record at the facility to resolve vendor
 * identities and link items to contracts. This is the action behind
 * the "Match Pricing" button.
 *
 * Steps:
 *   1. Load all distinct vendorNames from COG records
 *   2. For each name, attempt fuzzy match against system vendors
 *      (which already have contracts)
 *   3. Update vendorId on every COG row that can be resolved
 *   4. For item-level matching, cross-reference vendorItemNo against
 *      pricing files to detect on-contract items
 *
 * Returns a summary: how many records were re-linked, how many
 * vendors were matched, how many remain unmatched.
 */
export async function matchCOGToContracts(): Promise<{
  totalRecords: number
  vendorsMatched: number
  vendorsUnmatched: number
  recordsUpdated: number
  onContractAfter: number
}> {
  const { facility } = await requireFacility()

  // 1. Get distinct (vendorName, current vendorId) pairs
  const distinctVendors = await prisma.cOGRecord.groupBy({
    by: ["vendorName", "vendorId"],
    where: { facilityId: facility.id },
    _count: true,
  })

  // 2. Resolve every distinct name to an id via the shared resolver
  //    (createMissing: false — if a name can't match, we leave it alone
  //    rather than fragment the vendor table further).
  const distinctNames = distinctVendors
    .map((g) => g.vendorName ?? "")
    .filter((n) => n.trim())
  const resolved = await resolveVendorIdsBulk(distinctNames, { createMissing: false })

  // 3. Load vendors that have active contracts at this facility so we
  //    can tell the user which matches are "on contract" vs just "matched".
  const contractedVendorIds = new Set(
    (
      await prisma.contract.findMany({
        where: {
          status: { in: ["active", "expiring"] },
          OR: [
            { facilityId: facility.id },
            { contractFacilities: { some: { facilityId: facility.id } } },
          ],
        },
        select: { vendorId: true },
        distinct: ["vendorId"],
      })
    ).map((c) => c.vendorId),
  )

  let vendorsMatched = 0
  let vendorsUnmatched = 0
  let recordsUpdated = 0
  const totalRecords = distinctVendors.reduce((s, v) => s + v._count, 0)

  for (const group of distinctVendors) {
    const vendorName = group.vendorName ?? ""
    if (!vendorName.trim()) continue

    const currentVendorId = group.vendorId
    if (currentVendorId && contractedVendorIds.has(currentVendorId)) {
      vendorsMatched++
      continue
    }

    const matchedId = resolved.get(vendorName.toLowerCase())
    if (matchedId && matchedId !== currentVendorId) {
      const result = await prisma.cOGRecord.updateMany({
        where: {
          facilityId: facility.id,
          vendorName: { equals: vendorName, mode: "insensitive" },
        },
        data: { vendorId: matchedId },
      })
      recordsUpdated += result.count

      if (contractedVendorIds.has(matchedId)) {
        vendorsMatched++
      } else {
        vendorsUnmatched++
      }
    } else {
      vendorsUnmatched++
    }
  }

  // 5. Count on-contract after matching
  const onContractAfter = await prisma.cOGRecord.count({
    where: {
      facilityId: facility.id,
      vendor: {
        contracts: {
          some: {
            status: { in: ["active", "expiring"] },
            OR: [
              { facilityId: facility.id },
              { contractFacilities: { some: { facilityId: facility.id } } },
            ],
          },
        },
      },
    },
  })

  return {
    totalRecords,
    vendorsMatched,
    vendorsUnmatched,
    recordsUpdated,
    onContractAfter,
  }
}

// ─── Delete COG Record ──────────────────────────────────────────

export async function deleteCOGRecord(id: string) {
  const { facility } = await requireFacility()
  await prisma.cOGRecord.delete({ where: { id, facilityId: facility.id } })
}

// ─── Bulk Delete ────────────────────────────────────────────────

export async function bulkDeleteCOGRecords(ids: string[]) {
  const { facility } = await requireFacility()
  const result = await prisma.cOGRecord.deleteMany({
    where: { id: { in: ids }, facilityId: facility.id },
  })
  return { deleted: result.count }
}

// ─── Clear All COG Records for Facility ────────────────────────

export async function clearAllCOGRecords() {
  const { facility } = await requireFacility()
  const result = await prisma.cOGRecord.deleteMany({
    where: { facilityId: facility.id },
  })
  return { deleted: result.count }
}

// ─── Delete COG File (all records from a given import date) ────

export async function deleteCOGFileByDate(dateStr: string) {
  const { facility } = await requireFacility()
  const date = new Date(dateStr)
  const nextDay = new Date(date)
  nextDay.setDate(nextDay.getDate() + 1)

  const result = await prisma.cOGRecord.deleteMany({
    where: {
      facilityId: facility.id,
      createdAt: { gte: date, lt: nextDay },
    },
  })
  return { deleted: result.count }
}

// ─── Update COG Record ─────────────────────────────────────────

export async function updateCOGRecord(
  id: string,
  data: {
    inventoryNumber?: string
    inventoryDescription?: string
    unitCost?: number
    quantity?: number
    vendorName?: string
    vendorItemNo?: string
    category?: string
  }
) {
  const { facility } = await requireFacility()
  const extendedPrice =
    data.unitCost !== undefined && data.quantity !== undefined
      ? data.unitCost * data.quantity
      : undefined

  return serialize(
    await prisma.cOGRecord.update({
      where: { id, facilityId: facility.id },
      data: {
        ...data,
        ...(extendedPrice !== undefined ? { extendedPrice } : {}),
      },
    })
  )
}

// ─── Import History (aggregate by date) ─────────────────────────

export async function getCOGImportHistory(_facilityId?: string) {
  const { facility } = await requireFacility()

  // Group records by calendar date (truncate timestamp to date) so bulk
  // imports that share the same day collapse into a single history entry.
  const rows = await prisma.$queryRaw<
    { date: Date; record_count: bigint; total_spend: number | null }[]
  >`
    SELECT DATE("createdAt") AS date,
           COUNT(*)::bigint AS record_count,
           COALESCE(SUM("extendedPrice"), 0) AS total_spend
    FROM cog_record
    WHERE "facilityId" = ${facility.id}
    GROUP BY DATE("createdAt")
    ORDER BY date DESC
    LIMIT 50
  `

  return serialize(
    rows.map((r) => ({
      date: r.date instanceof Date ? r.date.toISOString() : String(r.date),
      recordCount: Number(r.record_count),
      totalSpend: Number(r.total_spend ?? 0),
    }))
  )
}

// ─── COG Stats (aggregated server-side) ─────────────────────────

export async function getCOGStats(facilityId: string) {
  const { facility } = await requireFacility()

  const [totalItems, totalSpendResult, onContractCount, vendorGroups, dateRange] =
    await Promise.all([
      prisma.cOGRecord.count({
        where: { facilityId: facility.id },
      }),
      prisma.cOGRecord.aggregate({
        where: { facilityId: facility.id },
        _sum: { extendedPrice: true },
      }),
      // Count items where the vendor has an active contract at this facility
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT cr.id)::bigint AS count
        FROM cog_record cr
        INNER JOIN contract c ON c."vendorId" = cr."vendorId"
          AND c.status IN ('active', 'expiring')
          AND (c."facilityId" = ${facility.id}
               OR EXISTS (SELECT 1 FROM contract_facility cf WHERE cf."contractId" = c.id AND cf."facilityId" = ${facility.id}))
        WHERE cr."facilityId" = ${facility.id}
          AND cr."vendorId" IS NOT NULL
      `.then((rows) => Number(rows[0]?.count ?? 0)),
      prisma.cOGRecord.groupBy({
        by: ["vendorName"],
        where: {
          facilityId: facility.id,
          vendorName: { not: null },
          NOT: { vendorName: "" },
        },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.cOGRecord.aggregate({
        where: { facilityId: facility.id },
        _min: { transactionDate: true },
        _max: { transactionDate: true },
      }),
    ])

  const totalSpend = Number(totalSpendResult._sum.extendedPrice ?? 0)
  const offContractCount = totalItems - onContractCount
  const uniqueVendors = vendorGroups.length
  const topVendors = vendorGroups.slice(0, 5).map((g) => ({
    name: g.vendorName ?? "Unknown",
    count: g._count.id,
  }))

  return serialize({
    totalItems,
    totalSpend,
    onContractCount,
    offContractCount,
    uniqueVendors,
    topVendors,
    minPODate: dateRange._min.transactionDate ?? null,
    maxPODate: dateRange._max.transactionDate ?? null,
  })
}
