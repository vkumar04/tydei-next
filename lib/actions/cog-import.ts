"use server"

/**
 * Bulk COG import.
 *
 * Extracted from lib/actions/cog-records.ts during subsystem-9 tech
 * debt split. Vendor resolution goes through the shared resolver
 * (lib/vendors/resolve) so we never add a parallel vendor-match path.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  bulkImportSchema,
  type BulkImportInput,
} from "@/lib/validators/cog-records"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import { resolveVendorIdsBulk } from "@/lib/vendors/resolve"
import { resolveCategoryNamesBulk } from "@/lib/categories/resolve"

// How far back (ms) to look when scoping "this import" stats without a
// FileImport row. Matches the plan's interim approximation — replace with
// a `fileImportId` filter once Subsystem 1 wires one through.
const IMPORT_STATS_WINDOW_MS = 60_000

const BATCH_SIZE = 500

export async function bulkImportCOGRecords(input: BulkImportInput) {
  const session = await requireFacility()
  const data = bulkImportSchema.parse(input)
  const t0 = Date.now()
  // Charles 2026-04-29: 46,512-record imports were silently failing
  // with the generic "Server Components render" overlay because the
  // 10mb body cap was rejecting before the action ran (now bumped to
  // 50mb). Log the count up-front so future large-import diagnostics
  // (timing, where it died) are traceable in server logs.
  console.log(
    `[bulkImportCOGRecords] start: ${data.records.length} records, facility=${session.facility.id}`,
  )

  try {
    const result = await runBulkImport(session, data)
    console.log(
      `[bulkImportCOGRecords] done in ${Date.now() - t0}ms — imported=${"imported" in result ? result.imported : "?"}`,
    )
    return result
  } catch (err) {
    // Charles W2.C-B: top-level guard. Without this, any throw from
    // pre-loop resolvers, post-loop recompute, or the final stats
    // Promise.all surfaces in prod as the generic "Server Components
    // render" digest with no server-side trace. Log the full error
    // before re-throwing so ops can debug from Vercel logs.
    console.error("[bulkImportCOGRecords]", err, {
      facilityId: session.facility.id,
      totalRecords: data.records.length,
      elapsedMs: Date.now() - t0,
    })
    throw err
  }
}

async function runBulkImport(
  session: Awaited<ReturnType<typeof requireFacility>>,
  data: BulkImportInput,
) {
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

  // 2026-04-26: category inference from ProductBenchmark.
  //
  // Prod feedback: "Several contracts missing market share — I don't
  // understand why some do and some do not." Root cause was that some
  // CSV imports include a category column and some don't. Without a
  // category, the per-category share card silently hid itself.
  //
  // We now backfill `category` at import time from ProductBenchmark
  // when the CSV didn't supply one — matched on `vendorItemNo`. This
  // is conservative: only fills when there's a concrete benchmark
  // row to map from. Manual category overrides in the CSV always
  // win (we don't overwrite a non-null record.category).
  // Dedupe before the IN query — a 46k-row import typically has far
  // fewer distinct vendorItemNos, and Postgres caps `IN (...)` at
  // 32,767 parameters. We additionally chunk to stay safely under
  // that limit even when distinct count is high (Charles 2026-04-26
  // prod failure: 46,512-row import threw before the batch loop).
  const itemsNeedingCategory = Array.from(
    new Set(
      data.records
        .filter((r) => !r.category && r.vendorItemNo)
        .map((r) => r.vendorItemNo!),
    ),
  )
  const benchmarkCategoryByItem = new Map<string, string>()
  if (itemsNeedingCategory.length > 0) {
    const PG_IN_CHUNK = 5000
    for (let i = 0; i < itemsNeedingCategory.length; i += PG_IN_CHUNK) {
      const chunk = itemsNeedingCategory.slice(i, i + PG_IN_CHUNK)
      const benchmarks = await prisma.productBenchmark.findMany({
        where: { vendorItemNo: { in: chunk } },
        select: { vendorItemNo: true, category: true },
      })
      for (const b of benchmarks) {
        if (b.category) benchmarkCategoryByItem.set(b.vendorItemNo, b.category)
      }
    }
  }

  // 2026-04-26 (Charles prod feedback): canonicalize the category
  // string AGAINST the ProductCategory table so two imports that
  // type "Ortho-Extremity" / "ortho-extremity" / "Ortho Extremity"
  // collapse to one canonical name. Mirrors the resolveVendorIdsBulk
  // pattern. createMissing=true tags new categories with source=cog
  // so admins can audit/dedupe in Settings later.
  const allRawCategories: Array<string | null | undefined> = [
    ...data.records.map((r) => r.category),
    ...benchmarkCategoryByItem.values(),
  ]
  const canonicalCategoryMap = await resolveCategoryNamesBulk(
    allRawCategories,
    { createMissing: true, source: "cog" },
  )
  const canonicalize = (raw: string | null | undefined): string | null => {
    if (!raw) return null
    const key = raw.trim().toLowerCase().replace(/\s+/g, " ")
    return canonicalCategoryMap.get(key) ?? (raw.trim() || null)
  }

  const resolveCategory = (record: (typeof data.records)[number]) => {
    if (record.category) return canonicalize(record.category)
    if (record.vendorItemNo) {
      const inferred = benchmarkCategoryByItem.get(record.vendorItemNo)
      if (inferred) return canonicalize(inferred)
    }
    return null
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
    category: resolveCategory(record),
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
              // auth-scope-scanner-skip: id is sourced from the
              // facility-scoped findMany above (where: facilityId:
              // session.facility.id). Tenant boundary already enforced.
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
                  category: resolveCategory(record),
                },
              }),
            ),
          )
          imported += toOverwrite.length
        } catch (err) {
          // Charles W2.C-B: never swallow the Prisma exception. The
          // error counter is visible to the user; the server log is
          // the only place ops can learn what actually broke.
          console.error("[bulkImportCOGRecords] batch update failed", {
            error: err,
            batchSize: toOverwrite.length,
            sample: toOverwrite.slice(0, 2).map(({ record }) => ({
              vendorName: record.vendorName,
              vendorItemNo: record.vendorItemNo,
              inventoryNumber: record.inventoryNumber,
              transactionDate: record.transactionDate,
            })),
          })
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
    } catch (err) {
      // Charles W2.C-B: see note above. Surface the actual failure so
      // ops can debug '144 errors, 0 imported' without guessing.
      console.error("[bulkImportCOGRecords] batch failed", {
        error: err,
        batchSize: batch.length,
        sample: batch.slice(0, 2).map((record) => ({
          vendorName: record.vendorName,
          vendorItemNo: record.vendorItemNo,
          inventoryNumber: record.inventoryNumber,
          transactionDate: record.transactionDate,
        })),
      })
      errors += batch.length
    }
  }

  await logAudit({
    userId: session.user.id,
    action: "cog.imported",
    entityType: "cogRecord",
    metadata: { imported, skipped, errors, totalRecords: data.records.length },
  })

  // ─── Post-import enrichment (subsystem 3 wiring) ─────────────
  //
  // For every distinct vendorId in the persisted batch, recompute
  // match statuses so newly-imported rows pick up contract pricing
  // immediately. Strategic-direction Plan #3 light: instead of
  // swallowing failures with console.warn, track them in a
  // structured result so the import action surfaces "succeeded but N
  // recompute steps failed" to the caller. The UI can then prompt
  // the user to retry via the contract-detail Refresh button instead
  // of silently displaying stale numbers.
  const recomputeFailures: { step: string; reason: string }[] = []
  if (imported > 0) {
    const vendorIds = new Set<string>()
    for (const record of data.records) {
      const vid = resolveVendorId(record)
      if (vid) vendorIds.add(vid)
    }

    if (vendorIds.size > 0) {
      const { recomputeMatchStatusesForVendor } = await import(
        "@/lib/cog/recompute"
      )
      for (const vendorId of vendorIds) {
        try {
          await recomputeMatchStatusesForVendor(prisma, {
            vendorId,
            facilityId: session.facility.id,
          })
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          console.error(
            "[bulkImportCOGRecords] recomputeMatchStatusesForVendor failed",
            err,
            { facilityId: session.facility.id, vendorId },
          )
          recomputeFailures.push({
            step: `match-statuses (vendor ${vendorId})`,
            reason,
          })
        }
      }
      // Charles 2026-04-28 Bug #5: dashboard category-spend card
      // ("only categories from the first contract show up"). Root
      // cause: when a COG file lacks a category column AND the items
      // aren't covered by ProductBenchmark or ContractPricing, every
      // row lands with category=null → aggregates into "uncategorized"
      // instead of the contract's category bucket. The contract
      // already carries an explicit productCategory; backfill it onto
      // any matched-but-uncategorized COG rows so the dashboard
      // pivot lights up. Best-effort — failures here don't block the
      // import or the downstream recomputes.
      try {
        const contractsWithCategory = await prisma.contract.findMany({
          where: {
            facilityId: session.facility.id,
            vendorId: { in: [...vendorIds] },
            productCategoryId: { not: null },
          },
          select: { id: true, productCategory: { select: { name: true } } },
        })
        for (const c of contractsWithCategory) {
          if (!c.productCategory?.name) continue
          await prisma.cOGRecord.updateMany({
            where: {
              facilityId: session.facility.id,
              contractId: c.id,
              category: null,
            },
            data: { category: c.productCategory.name },
          })
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        console.error(
          "[bulkImportCOGRecords] category backfill from Contract.productCategory failed",
          err,
          { facilityId: session.facility.id },
        )
        recomputeFailures.push({
          step: "category-backfill (contract-level)",
          reason,
        })
      }

      // Charles 2026-04-25 (Bug 27 part 2): after a COG import we have
      // potentially new vendor → contract bindings; refresh the
      // case-supply on-contract flags so Case Costing's compliance
      // numbers stay in sync.
      try {
        const { recomputeCaseSupplyContractStatus } = await import(
          "@/lib/case-costing/recompute-supply"
        )
        await recomputeCaseSupplyContractStatus(prisma, session.facility.id)
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        console.error(
          "[bulkImportCOGRecords] recomputeCaseSupplyContractStatus failed",
          err,
          { facilityId: session.facility.id },
        )
        recomputeFailures.push({
          step: "case-supply-contract-status",
          reason,
        })
      }

      // Strategic-direction Plan #1 (2026-04-28): persisted derived
      // metrics (Contract.complianceRate, currentMarketShare,
      // annualValue) drift after every COG import. Refresh them on
      // every contract owned by an affected vendor so the contract-
      // detail surfaces stay in sync without requiring a manual edit.
      const { refreshContractMetricsForVendor } = await import(
        "@/lib/actions/contracts/refresh-metrics"
      )
      for (const vendorId of vendorIds) {
        try {
          await refreshContractMetricsForVendor({
            vendorId,
            facilityId: session.facility.id,
          })
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          console.error(
            "[bulkImportCOGRecords] refreshContractMetricsForVendor failed",
            err,
            { facilityId: session.facility.id, vendorId },
          )
          recomputeFailures.push({
            step: `refresh-metrics (vendor ${vendorId})`,
            reason,
          })
        }
      }

      // Charles 2026-04-28 Bug #6 ("only Spend rebate is working"):
      // the Rebate ledger is written by recomputeAccrualForContract,
      // which only fires on contract create + term edit — NOT after a
      // COG import. So:
      //   - new spend never re-emits Rebate rows for the spend writer
      //   - the threshold engine (market_share / compliance_rebate)
      //     emitted 0 rebates on the create path because
      //     Contract.currentMarketShare was null; refresh-metrics
      //     above just updated it, but no second recompute fires
      //
      // Fan out a recompute over every active contract owned by an
      // affected vendor. Per-contract failures are collected so one
      // bad contract doesn't poison the import result.
      const { _recomputeAccrualForContractWithFacility } = await import(
        "@/lib/actions/contracts/recompute-accrual"
      )
      let affectedContracts: { id: string; name: string | null }[] = []
      try {
        affectedContracts = await prisma.contract.findMany({
          where: {
            facilityId: session.facility.id,
            vendorId: { in: [...vendorIds] },
            status: { in: ["active", "expiring"] },
          },
          select: { id: true, name: true },
        })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        console.error(
          "[bulkImportCOGRecords] failed to load contracts for accrual fan-out",
          err,
          { facilityId: session.facility.id },
        )
        recomputeFailures.push({
          step: "accrual-recompute (contract lookup)",
          reason,
        })
      }
      for (const contract of affectedContracts) {
        try {
          await _recomputeAccrualForContractWithFacility(
            contract.id,
            session.facility.id,
          )
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          console.error(
            "[bulkImportCOGRecords] recomputeAccrualForContract failed",
            err,
            {
              facilityId: session.facility.id,
              contractId: contract.id,
              contractName: contract.name,
            },
          )
          recomputeFailures.push({
            step: `accrual-recompute (${contract.name ?? contract.id})`,
            reason,
          })
        }
      }
    }
  }

  // ─── Import completion stats (subsystem 10.1) ────────────────
  //
  // Aggregate matched/unmatched/on-contract counts for the rows touched
  // by THIS import so the import dialog can show a summary card. We
  // don't have a FileImport row yet (Subsystem 1 still pending), so we
  // approximate "this import" by windowing on createdAt — the action
  // just finished inserting, so any COG row in the facility within the
  // last 60 seconds is effectively part of this batch.
  const since = new Date(Date.now() - IMPORT_STATS_WINDOW_MS)
  const facilityId = session.facility.id
  const [totalForFile, matchedCount, onContractCount] = await Promise.all([
    prisma.cOGRecord.count({
      where: { facilityId, createdAt: { gte: since } },
    }),
    prisma.cOGRecord.count({
      where: {
        facilityId,
        createdAt: { gte: since },
        matchStatus: { not: "pending" },
      },
    }),
    prisma.cOGRecord.count({
      where: {
        facilityId,
        createdAt: { gte: since },
        isOnContract: true,
      },
    }),
  ])

  return serialize({
    imported,
    skipped,
    errors,
    matched: matchedCount,
    unmatched: Math.max(0, totalForFile - matchedCount),
    onContractRate: totalForFile > 0 ? onContractCount / totalForFile : 0,
    // 2026-04-28 strategic-direction Plan #3 light: surface recompute
    // failures so the import UI can warn that the contract-detail
    // numbers may be stale until the user clicks Refresh on the
    // affected contracts. Empty array = everything succeeded.
    recomputeFailures,
  })
}
