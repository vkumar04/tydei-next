// scripts/diagnose-contracts-list-parity.ts
// Usage: bun scripts/diagnose-contracts-list-parity.ts <facilityId>
// Writes a markdown table of drift between the list-row path and
// the detail-page path for each contract on a facility.
//
// The server actions (`getContracts` / `getContract` / `getContractMetricsBatch`)
// are "use server" gated on `requireFacility()`, which needs a request
// scope. To run this from a CLI we re-implement the same reducers here
// against prisma + the canonical helpers. Numbers must match the
// server actions exactly (otherwise this script itself has drift).

import { prisma } from "@/lib/db"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"

async function main() {
  const facilityId = process.argv[2] ?? "cmo4sbr8p0004wthl91ubwfwb" // demo facility

  const lines: string[] = []
  lines.push(`# List vs detail parity — facility ${facilityId}`)
  lines.push(`_Generated ${new Date().toISOString()}_\n`)

  const today = new Date()
  const startOfYear = new Date(today.getFullYear(), 0, 1)
  const windowEnd = today
  const windowStart = new Date(today)
  windowStart.setFullYear(windowStart.getFullYear() - 1)

  // Pull every contract owned by the facility, plus the rebate rows that
  // feed both the list reducers and the detail header card.
  const contracts = await prisma.contract.findMany({
    where: contractsOwnedByFacility(facilityId),
    include: {
      rebates: {
        select: {
          rebateEarned: true,
          rebateCollected: true,
          payPeriodEnd: true,
          collectionDate: true,
        },
      },
    },
  })

  const contractIds = contracts.map((c) => c.id)

  // List-path spend: trailing-12mo cascade (ContractPeriod → COG-by-contract → COG-by-vendor)
  const [periodSpendAgg, cogByContractAgg] =
    contractIds.length === 0
      ? [[] as Array<{ contractId: string; _sum: { totalSpend: unknown } }>, [] as Array<{ contractId: string | null; _sum: { extendedPrice: unknown } }>]
      : await Promise.all([
          prisma.contractPeriod.groupBy({
            by: ["contractId"],
            where: {
              contractId: { in: contractIds },
              periodEnd: { gte: windowStart, lte: windowEnd },
            },
            _sum: { totalSpend: true },
          }),
          prisma.cOGRecord.groupBy({
            by: ["contractId"],
            where: {
              facilityId,
              contractId: { in: contractIds },
              transactionDate: { gte: windowStart, lte: windowEnd },
            },
            _sum: { extendedPrice: true },
          }),
        ])

  const periodSpendByContract = new Map<string, number>()
  for (const row of periodSpendAgg) {
    periodSpendByContract.set(row.contractId, Number(row._sum?.totalSpend ?? 0))
  }
  const cogSpendByContract = new Map<string, number>()
  for (const row of cogByContractAgg) {
    if (row.contractId) {
      cogSpendByContract.set(
        row.contractId,
        Number(row._sum?.extendedPrice ?? 0),
      )
    }
  }

  // Batch-path (getContractMetricsBatch): separate Prisma aggregation that
  // was "kept in sync" with the canonical helper but silently drifts.
  const [batchRebateAgg, batchPeriodRebateAgg, batchCogByContract] =
    contractIds.length === 0
      ? [[], [], []]
      : await Promise.all([
          prisma.rebate.groupBy({
            by: ["contractId"],
            where: {
              contractId: { in: contractIds },
              facilityId,
              payPeriodEnd: { gte: startOfYear, lte: today },
            },
            _sum: { rebateEarned: true },
          }),
          prisma.contractPeriod.groupBy({
            by: ["contractId"],
            where: {
              contractId: { in: contractIds },
              facilityId,
              periodEnd: { gte: startOfYear, lte: today },
            },
            _sum: { rebateEarned: true },
          }),
          prisma.cOGRecord.groupBy({
            by: ["contractId"],
            where: { facilityId, contractId: { in: contractIds } },
            _sum: { extendedPrice: true },
          }),
        ])

  const batchRebateFromTable = new Map<string, number>()
  for (const row of batchRebateAgg) {
    if (row.contractId) {
      batchRebateFromTable.set(
        row.contractId,
        Number(row._sum?.rebateEarned ?? 0),
      )
    }
  }
  const batchRebateFromPeriods = new Map<string, number>()
  for (const row of batchPeriodRebateAgg) {
    if (row.contractId) {
      batchRebateFromPeriods.set(
        row.contractId,
        Number(row._sum?.rebateEarned ?? 0),
      )
    }
  }
  const batchSpendByContract = new Map<string, number>()
  for (const row of batchCogByContract) {
    if (row.contractId) {
      batchSpendByContract.set(
        row.contractId,
        Number(row._sum?.extendedPrice ?? 0),
      )
    }
  }

  type DriftRow = {
    id: string
    name: string
    field: string
    list: number
    detail: number
    batch: number
    delta: number
  }
  const rows: DriftRow[] = []

  for (const c of contracts) {
    // List path (canonical helpers)
    // Charles audit round-1 facility CONCERN-B + iMessage 2026-04-20 N13:
    // list column is now LIFETIME (was YTD). Doc + diagnose follow.
    const listRebateEarned = sumEarnedRebatesLifetime(c.rebates ?? [])
    const listRebateCollected = sumCollectedRebates(c.rebates ?? [])
    const periodSpend = periodSpendByContract.get(c.id) ?? 0
    const cogContractSpend = cogSpendByContract.get(c.id) ?? 0
    const listCurrentSpend =
      periodSpend > 0 ? periodSpend : cogContractSpend

    // Detail path is the same canonical helpers, applied to the same
    // rebate rows. The detail header's spend uses the same trailing-12mo
    // cascade as the list path (per R5.28). So list & detail should
    // always match — any drift on this pair indicates the reducers have
    // forked.
    const detailRebateEarned = sumEarnedRebatesLifetime(c.rebates ?? [])
    const detailRebateCollected = sumCollectedRebates(c.rebates ?? [])
    const detailCurrentSpend = listCurrentSpend

    // Batch path (getContractMetricsBatch) — what the list column
    // accessor currently prefers via `?? metricsRebate` / `?? metricsSpend`.
    const directRebate = batchRebateFromTable.get(c.id) ?? 0
    const periodRebate = batchRebateFromPeriods.get(c.id) ?? 0
    const batchRebate = directRebate > 0 ? directRebate : periodRebate
    const cogSpend = batchSpendByContract.get(c.id) ?? 0
    const batchSpend = cogSpend > 0 ? cogSpend : periodSpend

    const fields = [
      {
        name: "rebateEarned",
        list: listRebateEarned,
        detail: detailRebateEarned,
        batch: batchRebate,
      },
      {
        name: "rebateCollected",
        list: listRebateCollected,
        detail: detailRebateCollected,
        batch: 0,
      },
      {
        name: "currentSpend",
        list: listCurrentSpend,
        detail: detailCurrentSpend,
        batch: batchSpend,
      },
    ]

    for (const f of fields) {
      // Drift = list row vs detail page (the user-visible comparison).
      // We always print rows where list != detail OR where the batch
      // shadow differs from the canonical value — the latter is what
      // the column accessor's fallback actually surfaces.
      const columnValue =
        f.name === "rebateEarned"
          ? f.batch > 0
            ? f.batch
            : f.list
          : f.name === "currentSpend"
            ? f.list > 0
              ? f.list
              : f.batch
            : f.list
      if (columnValue !== f.detail || f.batch !== f.list) {
        rows.push({
          id: c.id,
          name: c.name,
          field: f.name,
          list: f.list,
          detail: f.detail,
          batch: f.batch,
          delta: columnValue - f.detail,
        })
      }
    }
  }

  lines.push(`## Contracts scanned: ${contracts.length}\n`)

  lines.push(`## Drift rows\n`)
  lines.push("| Contract | Name | Field | List (canonical) | Detail | Batch | Delta (column − detail) |")
  lines.push("|---|---|---|---:|---:|---:|---:|")
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${r.name} | ${r.field} | ${r.list} | ${r.detail} | ${r.batch} | ${r.delta} |`,
    )
  }
  if (rows.length === 0) lines.push("_No drift detected._")

  // Suppress unused import complaint in this diagnostic; the helper is
  // here intentionally so follow-up diagnostics can extend coverage.
  void sumEarnedRebatesLifetime

  console.log(lines.join("\n"))

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
