/**
 * Backfill COGRecord.category from ProductBenchmark.vendorItemNo.
 *
 * Context: Today's commits 42604e1 (UX bandage) and e482147
 * (import-time inference) close the FUTURE gap, but rows already
 * imported on prod with `category = null` won't change automatically.
 * This script applies the same conservative inference rule
 * retroactively, with a safe DRY-RUN default.
 *
 * Inference rule (see lib/cog/categorize-from-benchmark.ts):
 *   For each COGRecord with `category = null` AND a non-null
 *   `vendorItemNo`, look up
 *     ProductBenchmark.findFirst({ where: { vendorItemNo } })
 *   and propose its category as the update. Never overwrites an
 *   existing non-null category.
 *
 * Usage (LOCAL):
 *   bun run backfill:cog-categories
 *   bun run backfill:cog-categories -- --facility-id <id>
 *   bun run backfill:cog-categories -- --vendor-id <id>
 *
 * Usage (PROD DRY-RUN):
 *   DATABASE_URL="$(railway variables --service Postgres --environment production --kv | grep ^DATABASE_PUBLIC_URL= | cut -d= -f2-)" \
 *     bun run backfill:cog-categories
 *
 * Usage (PROD APPLY — only after dry-run review):
 *   CONFIRM_BACKFILL=yes \
 *   RAN_BY="vick.kumar19@gmail.com" \
 *   DATABASE_URL="$(railway variables --service Postgres --environment production --kv | grep ^DATABASE_PUBLIC_URL= | cut -d= -f2-)" \
 *     bun run backfill:cog-categories -- --apply
 */
import { prisma } from "@/lib/db"
import { inferCategoryFromBenchmark } from "@/lib/cog/categorize-from-benchmark"

interface CliArgs {
  apply: boolean
  facilityId: string | null
  vendorId: string | null
  ranBy: string | null
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    apply: false,
    facilityId: null,
    vendorId: null,
    ranBy: process.env.RAN_BY ?? null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--apply") args.apply = true
    else if (a === "--dry-run") args.apply = false
    else if (a === "--facility-id") args.facilityId = argv[++i] ?? null
    else if (a === "--vendor-id") args.vendorId = argv[++i] ?? null
    else if (a === "--ran-by") args.ranBy = argv[++i] ?? null
  }
  return args
}

interface VendorRollup {
  vendorId: string | null
  vendorName: string
  uncategorizedDollarsBefore: number
  rowsThatWouldFill: number
  rowsThatWouldRemainNull: number
}

interface InferredTuple {
  vendorItemNo: string
  category: string
  count: number
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n)
  return s + " ".repeat(n - s.length)
}

function padRight(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n)
  return " ".repeat(n - s.length) + s
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const mode = args.apply ? "APPLY" : "DRY-RUN"

  console.log(`# COG category backfill — mode=${mode}`)
  console.log(`# facilityId=${args.facilityId ?? "(all)"}  vendorId=${args.vendorId ?? "(all)"}`)
  console.log()

  if (args.apply && process.env.CONFIRM_BACKFILL !== "yes") {
    console.error(
      "REFUSED: --apply requires CONFIRM_BACKFILL=yes in the environment.\n" +
        "Re-run with: CONFIRM_BACKFILL=yes ... bun run backfill:cog-categories -- --apply"
    )
    process.exit(2)
  }

  // 1. Pull every uncategorized COG row in scope. We need the
  //    extendedPrice/quantity/unitCost so we can compute "dollars
  //    that would be filled" without a second query.
  const rows = await prisma.cOGRecord.findMany({
    where: {
      category: null,
      vendorItemNo: { not: null },
      ...(args.facilityId ? { facilityId: args.facilityId } : {}),
      ...(args.vendorId ? { vendorId: args.vendorId } : {}),
    },
    select: {
      id: true,
      facilityId: true,
      vendorId: true,
      vendorName: true,
      vendorItemNo: true,
      category: true,
      unitCost: true,
      extendedPrice: true,
      quantity: true,
    },
  })

  console.log(`Scanned ${rows.length} COG rows with category=null and a vendorItemNo.`)
  if (rows.length === 0) {
    console.log("Nothing to do.")
    await prisma.$disconnect()
    return
  }

  // 2. Build the benchmark map in a single query.
  const distinctItems = Array.from(
    new Set(rows.map((r) => r.vendorItemNo).filter((v): v is string => Boolean(v)))
  )
  const benchmarks = await prisma.productBenchmark.findMany({
    where: { vendorItemNo: { in: distinctItems } },
    select: { vendorItemNo: true, category: true },
  })
  const benchmarkMap = new Map<string, string>()
  for (const b of benchmarks) {
    if (b.category) {
      // findFirst-equivalent: keep the first non-null hit per
      // vendorItemNo. Order from Prisma is stable for the input set.
      if (!benchmarkMap.has(b.vendorItemNo)) {
        benchmarkMap.set(b.vendorItemNo, b.category)
      }
    }
  }
  console.log(
    `Resolved ${benchmarkMap.size} vendorItemNo -> category mappings from ${benchmarks.length} ProductBenchmark rows.`
  )
  console.log()

  // 3. Walk rows, decide proposed update, accumulate vendor + tuple
  //    rollups.
  const vendorMap = new Map<string, VendorRollup>()
  const tupleMap = new Map<string, InferredTuple>()
  const updates: Array<{ id: string; category: string }> = []

  for (const r of rows) {
    const proposed = inferCategoryFromBenchmark(
      { currentCategory: r.category, vendorItemNo: r.vendorItemNo },
      benchmarkMap
    )
    const dollars = Number(r.extendedPrice ?? 0) || Number(r.unitCost) * (r.quantity ?? 0)
    const vendorKey = r.vendorId ?? `__noid:${r.vendorName ?? "unknown"}`
    let vRoll = vendorMap.get(vendorKey)
    if (!vRoll) {
      vRoll = {
        vendorId: r.vendorId,
        vendorName: r.vendorName ?? "(unknown)",
        uncategorizedDollarsBefore: 0,
        rowsThatWouldFill: 0,
        rowsThatWouldRemainNull: 0,
      }
      vendorMap.set(vendorKey, vRoll)
    }
    vRoll.uncategorizedDollarsBefore += dollars

    if (proposed && r.vendorItemNo) {
      vRoll.rowsThatWouldFill += 1
      updates.push({ id: r.id, category: proposed })
      const tupleKey = `${r.vendorItemNo}|${proposed}`
      const existingTuple = tupleMap.get(tupleKey)
      if (existingTuple) {
        existingTuple.count += 1
      } else {
        tupleMap.set(tupleKey, {
          vendorItemNo: r.vendorItemNo,
          category: proposed,
          count: 1,
        })
      }
    } else {
      vRoll.rowsThatWouldRemainNull += 1
    }
  }

  // 4. Render vendor rollup table (sorted by uncategorized dollars desc).
  const vendorRows = Array.from(vendorMap.values()).sort(
    (a, b) => b.uncategorizedDollarsBefore - a.uncategorizedDollarsBefore
  )
  const COL_VENDOR = 42
  const COL_DOLLARS = 16
  const COL_FILL = 12
  const COL_REMAIN = 14
  console.log("Per-vendor rollup:")
  console.log(
    pad("Vendor", COL_VENDOR) +
      padRight("Uncat $ before", COL_DOLLARS) +
      padRight("Would fill", COL_FILL) +
      padRight("Would remain", COL_REMAIN)
  )
  console.log("-".repeat(COL_VENDOR + COL_DOLLARS + COL_FILL + COL_REMAIN))
  for (const v of vendorRows) {
    console.log(
      pad(v.vendorName, COL_VENDOR) +
        padRight(fmtUsd(v.uncategorizedDollarsBefore), COL_DOLLARS) +
        padRight(String(v.rowsThatWouldFill), COL_FILL) +
        padRight(String(v.rowsThatWouldRemainNull), COL_REMAIN)
    )
  }
  console.log()

  // 5. Top-10 inferred tuples for sanity check.
  const tupleRows = Array.from(tupleMap.values()).sort((a, b) => b.count - a.count).slice(0, 10)
  console.log("Top 10 inferred (vendorItemNo, count, category) tuples:")
  console.log(pad("vendorItemNo", 28) + padRight("count", 10) + "  category")
  console.log("-".repeat(70))
  for (const t of tupleRows) {
    console.log(pad(t.vendorItemNo, 28) + padRight(String(t.count), 10) + "  " + t.category)
  }
  console.log()

  // 6. Summary.
  const totalUpdates = updates.length
  const totalRemain = rows.length - totalUpdates
  console.log(`Would update ${totalUpdates} rows. Would leave ${totalRemain} rows un-categorized.`)
  console.log()

  // 7. Apply path.
  if (!args.apply) {
    console.log("[DRY-RUN] No writes performed. Re-run with --apply CONFIRM_BACKFILL=yes to apply.")
    await prisma.$disconnect()
    return
  }

  console.log(`# APPLYING ${totalUpdates} updates in batches of 500...`)
  const BATCH_SIZE = 500
  let batchNum = 0
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    batchNum += 1
    const slice = updates.slice(i, i + BATCH_SIZE)
    await prisma.$transaction(
      slice.map((u) =>
        prisma.cOGRecord.update({
          // SAFETY: the where clause includes `category: null` so we
          // can never overwrite a row that was categorized between
          // the dry-run scan and this write. If a row was filled
          // concurrently, the update count for it will be 0 and
          // Prisma will throw — caller should re-run.
          where: { id: u.id, category: null },
          data: { category: u.category },
        })
      )
    )
    console.log(`  batch ${batchNum}: wrote ${slice.length} rows.`)
  }

  // 8. Audit log. We need a userId — fall back to the first admin
  //    user if RAN_BY/--ran-by didn't resolve to a User row. The
  //    AuditLog FK requires a real userId.
  let auditUserId: string | null = null
  if (args.ranBy) {
    const user = await prisma.user.findFirst({
      where: { email: args.ranBy },
      select: { id: true },
    })
    auditUserId = user?.id ?? null
  }
  if (!auditUserId) {
    const admin = await prisma.user.findFirst({
      where: { role: "admin" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })
    auditUserId = admin?.id ?? null
  }
  if (auditUserId) {
    await prisma.auditLog.create({
      data: {
        userId: auditUserId,
        action: "cog.categorize_backfill",
        entityType: "cogRecord",
        metadata: {
          facilityId: args.facilityId,
          vendorId: args.vendorId,
          dryRun: false,
          updated: totalUpdates,
          scanned: rows.length,
          ranBy: args.ranBy ?? "(unresolved)",
        },
      },
    })
    console.log(`Audit log written by userId=${auditUserId}.`)
  } else {
    console.warn(
      "[WARN] No User row could be resolved for the audit log. Skipping AuditLog write."
    )
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error("[backfill-cog-categories] FATAL:", err)
  await prisma.$disconnect()
  process.exit(1)
})
