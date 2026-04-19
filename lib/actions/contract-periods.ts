"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import {
  computeRebateFromPrismaTiers,
  DEFAULT_COLLECTION_RATE,
} from "@/lib/rebates/calculate"

/**
 * Fetch all contract periods for a given contract, ordered by periodStart desc.
 * Used by the Contract Transactions ledger component.
 *
 * Falls back to computing synthetic monthly periods from live COG data
 * when no persisted ContractPeriod rows exist — otherwise a newly-created
 * contract with real COG activity renders a blank Performance tab even
 * though the spend and rebate data are sitting in adjacent tables.
 */
export async function getContractPeriods(contractId: string) {
  const { facility } = await requireFacility()

  // Verify access + pull the contract shape we need for the fallback
  // compute (vendor, effective window, term tiers).
  const contract = await prisma.contract.findUniqueOrThrow({
    where: {
      id: contractId,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    select: {
      id: true,
      vendorId: true,
      facilityId: true,
      effectiveDate: true,
      expirationDate: true,
      terms: {
        select: {
          evaluationPeriod: true,
          tiers: { orderBy: { tierNumber: "asc" } },
        },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  })

  const persisted = await prisma.contractPeriod.findMany({
    where: { contractId },
    orderBy: { periodStart: "desc" },
  })
  if (persisted.length > 0) return serialize(persisted)

  // ── Fallback: compute monthly periods from COG matched to this
  // vendor at this facility, bounded by the contract's effective window.
  const cogRows = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      transactionDate: {
        gte: new Date(contract.effectiveDate),
        lte: new Date(contract.expirationDate),
      },
    },
    select: { transactionDate: true, extendedPrice: true },
  })

  if (cogRows.length === 0) return serialize([])

  // Bucket by YYYY-MM
  const monthBuckets = new Map<string, { start: Date; end: Date; spend: number }>()
  for (const row of cogRows) {
    if (!row.transactionDate) continue
    const d = new Date(row.transactionDate)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    const existing = monthBuckets.get(key)
    if (existing) {
      existing.spend += Number(row.extendedPrice ?? 0)
    } else {
      const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      monthBuckets.set(key, {
        start,
        end,
        spend: Number(row.extendedPrice ?? 0),
      })
    }
  }

  // Apply the contract's first-term tier structure to cumulative spend.
  const tiers = contract.terms[0]?.tiers ?? []
  // Charles R4.6: honor `evaluationPeriod` — monthly-eval contracts
  // qualify each month's tier from THAT month's spend, not a running
  // cumulative annual total. Otherwise the ladder's "annual" spendMins
  // are never reached by a single month.
  const evaluationPeriod = contract.terms[0]?.evaluationPeriod ?? "annual"
  const sortedKeys = Array.from(monthBuckets.keys()).sort()
  let cumulative = 0
  const synthetic = sortedKeys.map((key, idx) => {
    const bucket = monthBuckets.get(key)!
    cumulative += bucket.spend

    // Pick the tier-qualification denominator based on evaluationPeriod.
    // Charles R4.6: monthly-eval contracts should qualify on the month's
    // own spend, not cumulative year-to-date, otherwise tiers whose
    // spendMin was sized for annual totals never trigger.
    const tierSpend =
      evaluationPeriod === "monthly" ? bucket.spend : cumulative
    const { tierAchieved, rebatePercent } = computeRebateFromPrismaTiers(
      tierSpend,
      tiers,
    )
    // Apply the achieved tier's rate to this month's spend directly.
    // (The earlier version re-invoked computeRebateFromPrismaTiers with a
    // synthetic tier but lost the rebateType discriminator, silently
    // returning zero for percent_of_spend terms.)
    const rebateEarned = (bucket.spend * rebatePercent) / 100
    const rebateCollected = rebateEarned * DEFAULT_COLLECTION_RATE

    return {
      id: `synthetic-${contract.id}-${key}`,
      contractId: contract.id,
      facilityId: contract.facilityId ?? facility.id,
      periodStart: bucket.start,
      periodEnd: bucket.end,
      totalSpend: bucket.spend,
      totalVolume: 0,
      rebateEarned,
      rebateCollected,
      paymentExpected: 0,
      paymentActual: 0,
      balanceExpected: 0,
      balanceActual: 0,
      tierAchieved,
      createdAt: new Date(),
      updatedAt: new Date(),
      _synthetic: true as const,
      _periodIndex: idx,
    }
  })

  // UI expects desc order (latest first) — same as the persisted branch.
  return serialize(synthetic.reverse())
}

/**
 * Create a contract transaction.
 *
 * A `rebate` transaction represents the facility recording that a vendor
 * rebate has been earned *and* collected — it writes a `Rebate` row with
 * `collectionDate` set so the detail page's "Rebates Earned" /
 * "Rebates Collected" summary cards (which aggregate Rebate rows per the
 * CLAUDE.md rules) pick it up immediately.
 *
 * Credits and payments continue to be stored on `ContractPeriod` since
 * those don't flow through the Rebate aggregations.
 */
export async function createContractTransaction(input: {
  contractId: string
  type: "rebate" | "credit" | "payment"
  amount: number
  description: string
  date: string
  // Optional unit count for per-unit / per-procedure rebate terms. Persisted
  // into the Rebate row's `notes` as a "Qty: N" suffix so the facility can
  // audit the basis of the entry without a schema migration. Only applies
  // when type === "rebate"; ignored for credit/payment.
  quantity?: number
}) {
  const { facility } = await requireFacility()

  // Verify access
  await prisma.contract.findUniqueOrThrow({
    where: {
      id: input.contractId,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    select: { id: true },
  })

  const txnDate = new Date(input.date)

  if (input.type === "rebate") {
    // Record both earned + collected on the Rebate row so aggregates that
    // filter on `payPeriodEnd <= today` (earned) and `collectionDate != null`
    // (collected) both include it. `payPeriodStart` matches `payPeriodEnd`
    // for a point-in-time entry — the user is logging a realized rebate.
    // If a quantity was supplied (per-unit / per-procedure terms), append it
    // to `notes` as "Qty: N" so audit trails preserve the unit count even
    // though Rebate has no dedicated quantity column.
    const qty =
      typeof input.quantity === "number" && Number.isFinite(input.quantity) && input.quantity > 0
        ? input.quantity
        : null
    const notes =
      qty != null ? `${input.description} (Qty: ${qty})` : input.description
    const rebate = await prisma.rebate.create({
      data: {
        contractId: input.contractId,
        facilityId: facility.id,
        rebateEarned: input.amount,
        rebateCollected: input.amount,
        payPeriodStart: txnDate,
        payPeriodEnd: txnDate,
        collectionDate: txnDate,
        notes,
      },
    })
    return serialize({ kind: "rebate" as const, row: rebate })
  }

  const period = await prisma.contractPeriod.create({
    data: {
      contractId: input.contractId,
      facilityId: facility.id,
      periodStart: txnDate,
      periodEnd: txnDate,
      totalSpend: input.type === "payment" ? input.amount : 0,
      rebateEarned: 0,
      rebateCollected: 0,
      paymentExpected: input.type === "credit" ? input.amount : 0,
      paymentActual: input.type === "credit" ? input.amount : 0,
    },
  })

  return serialize({ kind: "period" as const, row: period })
}

// ─── Rebate rows per contract ───────────────────────────────────
//
// Returns the underlying Rebate rows for a contract so the UI can
// surface what the user has actually logged. Aggregation rules live
// in getContract (see lib/actions/contracts.ts); this endpoint is
// the row-level companion used by the Transactions ledger.
export async function getContractRebates(contractId: string) {
  const { facility } = await requireFacility()

  await prisma.contract.findUniqueOrThrow({
    where: {
      id: contractId,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    select: { id: true },
  })

  const rows = await prisma.rebate.findMany({
    where: { contractId },
    orderBy: { payPeriodEnd: "desc" },
    select: {
      id: true,
      rebateEarned: true,
      rebateCollected: true,
      payPeriodStart: true,
      payPeriodEnd: true,
      collectionDate: true,
      notes: true,
      createdAt: true,
    },
  })

  return serialize(rows)
}
