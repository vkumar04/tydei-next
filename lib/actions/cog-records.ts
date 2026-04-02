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
      include: { vendor: { select: { id: true, name: true } } },
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.cOGRecord.count({ where }),
  ])

  return serialize({ records, total })
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

  const toCreateData = (record: (typeof data.records)[number]) => ({
    facilityId: session.facility.id,
    vendorId: record.vendorId,
    vendorName: record.vendorName,
    inventoryNumber: record.inventoryNumber,
    inventoryDescription: record.inventoryDescription,
    vendorItemNo: record.vendorItemNo,
    manufacturerNo: record.manufacturerNo,
    unitCost: record.unitCost,
    extendedPrice: record.extendedPrice,
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
            inventoryNumber: r.inventoryNumber,
            transactionDate: new Date(r.transactionDate),
            ...(r.vendorItemNo ? { vendorItemNo: r.vendorItemNo } : {}),
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
            // overwrite
            try {
              await prisma.cOGRecord.update({
                where: { id: existingId },
                data: {
                  vendorId: record.vendorId,
                  vendorName: record.vendorName,
                  inventoryDescription: record.inventoryDescription,
                  manufacturerNo: record.manufacturerNo,
                  unitCost: record.unitCost,
                  extendedPrice: record.extendedPrice,
                  quantity: record.quantity,
                  category: record.category,
                },
              })
              imported++
            } catch {
              errors++
            }
          }
        } else {
          newRecords.push(record)
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

// ─── Import History (aggregate by date) ─────────────────────────

export async function getCOGImportHistory(_facilityId?: string) {
  const { facility } = await requireFacility()

  // Group records by calendar date (truncate timestamp to date) so bulk
  // imports that share the same day collapse into a single history entry.
  const rows = await prisma.$queryRaw<
    { date: Date; record_count: bigint }[]
  >`
    SELECT DATE("createdAt") AS date, COUNT(*)::bigint AS record_count
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
    }))
  )
}

// ─── COG Stats (aggregated server-side) ─────────────────────────

export async function getCOGStats(facilityId: string) {
  const { facility } = await requireFacility()

  const [totalItems, totalSpendResult, onContractCount, vendorGroups] =
    await Promise.all([
      prisma.cOGRecord.count({
        where: { facilityId: facility.id },
      }),
      prisma.cOGRecord.aggregate({
        where: { facilityId: facility.id },
        _sum: { extendedPrice: true },
      }),
      prisma.cOGRecord.count({
        where: {
          facilityId: facility.id,
          category: { not: null },
          NOT: { category: "" },
        },
      }),
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
  })
}
