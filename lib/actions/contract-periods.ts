"use server"

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
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
      // Bug 12 (2026-04-23) — the synthetic-period fallback was
      // vendor-wide, so two contracts with the same vendor + overlapping
      // windows rendered identical period sets. Pulling every term's
      // scope here lets us narrow the COG query to only categories the
      // contract's terms actually cover.
      terms: {
        select: {
          evaluationPeriod: true,
          appliesTo: true,
          categories: true,
          tiers: { orderBy: { tierNumber: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  const persisted = await prisma.contractPeriod.findMany({
    where: { contractId },
    orderBy: { periodStart: "desc" },
  })
  if (persisted.length > 0) return serialize(persisted)

  // ── Fallback: compute monthly periods from COG matched to this
  // vendor at this facility, bounded by the contract's effective window
  // AND the union of category scopes the contract's terms cover.
  // Pre-fix (Bug 12) this was vendor-wide which produced identical
  // periods across sibling contracts. Uses the same helper the
  // contracts-list and accrual-timeline rely on so the scope is
  // canonical.
  const { buildUnionCategoryWhereClause } = await import(
    "@/lib/contracts/cog-category-filter"
  )
  const termScopes = contract.terms.map((t) => ({
    appliesTo: t.appliesTo,
    categories: t.categories,
  }))
  const unionCategoryWhere = buildUnionCategoryWhereClause(termScopes)
  const cogRows = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      transactionDate: {
        gte: new Date(contract.effectiveDate),
        lte: new Date(contract.expirationDate),
      },
      ...unionCategoryWhere,
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

  // Apply the PRIMARY (first) term's tier structure for the tier-badge
  // column on the synthetic period rows. Charles R5.29 note: we
  // intentionally pick a single term here because the tierAchieved
  // column represents "which tier did this month land in" on the
  // Performance tab — it's a badge, not a summable metric. The per-
  // month `totalSpend` is term-agnostic (raw COG), and true multi-term
  // rebate aggregation happens through persisted Rebate rows written
  // by `recomputeAccrualForContract`, which DOES iterate all terms.
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
    // Charles R5.7: use the facade's `rebateEarned` directly instead of
    // re-deriving it from `rebatePercent`. The facade is rebateType-aware
    // — for `percent_of_spend` it returns a percent-of-tierSpend number,
    // for `fixed_rebate` it returns the flat dollar value, and for
    // unit-based tiers it short-circuits to 0 (those need
    // `computeRebateFromPrismaTerm` and unit counts). The old code
    // multiplied `bucket.spend * rebatePercent / 100` which (a) re-applied
    // the percent to the bucket instead of the tier-qualification spend,
    // and (b) zeroed out all non-percent rebate types because
    // `rebatePercent` is 0 for fixed/per-unit tiers.
    const facade = computeRebateFromPrismaTiers(tierSpend, tiers)
    const tierAchieved = facade.tierAchieved
    // Charles 2026-04-25 (drift fix): the prior implementation read
    // `Number(applicableTier.rebateValue)` raw and multiplied by
    // `bucket.spend`, which only worked because rebateValue is stored
    // as a fraction. Any future change to that storage convention
    // (or the addition of a non-fraction rebateType to the same
    // branch) would silently break this path. Use the facade's
    // canonical effective rate (`facade.rebateEarned / tierSpend`)
    // and re-apply to the month's own spend, so the unit convention
    // is owned exclusively by `computeRebateFromPrismaTiers`.
    const applicableTier = [...tiers]
      .sort((a, b) => Number(a.spendMin) - Number(b.spendMin))
      .reduce<(typeof tiers)[number] | null>(
        (best, t) => (tierSpend >= Number(t.spendMin) ? t : best),
        null,
      )
    let rebateEarned = 0
    if (applicableTier?.rebateType === "percent_of_spend") {
      const effectiveRate =
        tierSpend > 0 ? facade.rebateEarned / tierSpend : 0
      rebateEarned = bucket.spend * effectiveRate
    } else {
      // Fixed / per-unit / per-procedure — trust the facade (which
      // short-circuits unit-based types to 0 since we don't have unit
      // counts here). Fixed-rebate yields the flat tier value per period.
      rebateEarned = facade.rebateEarned
    }
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
 * A `rebate` transaction splits into two distinct intents via `rebateKind`:
 *   - `"earned"` (default): the facility is logging an accrual for a closed
 *     period. Writes `rebateEarned=amount, rebateCollected=0, collectionDate=null`
 *     so only the "Rebates Earned" aggregate picks it up.
 *   - `"collected"`: the facility is logging a payment *received* from the
 *     vendor. Charles W1.W-C1: this path UPDATES an existing earned
 *     (un-collected) Rebate row in place — stamping `collectionDate` and
 *     `rebateCollected` onto the same row — instead of creating a second
 *     row. That makes the ledger render as Earned / Collected / Outstanding
 *     per period on a single line. If `rebateId` is provided the caller
 *     has picked which earned row this collection pays down; otherwise we
 *     auto-match the oldest earned row on this contract that has
 *     `rebateEarned > 0 AND collectionDate IS NULL`. If no earned row is
 *     found, we fall back to creating a pure-collection row
 *     (`rebateEarned=0`) so out-of-band payments still land in the ledger
 *     (e.g. a rebate check the user didn't see accrue yet).
 *
 * Manual rebates never carry the `[auto-accrual]` notes prefix — that prefix
 * is reserved for rows emitted by `recomputeAccrualForContract`.
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
  // For type=rebate, disambiguate accrual (earned) vs payment-in (collected).
  // Ignored for credit/payment. Defaults to "earned" to preserve the pre-R5.34
  // call-site semantics for callers that haven't been updated.
  rebateKind?: "earned" | "collected"
  // Optional unit count for per-unit / per-procedure rebate terms. Persisted
  // into the Rebate row's `notes` as a "Qty: N" suffix so the facility can
  // audit the basis of the entry without a schema migration. Only applies
  // when type === "rebate" && rebateKind === "earned"; ignored otherwise.
  quantity?: number
  // Charles W1.W-C1: when rebateKind === "collected", the user may have
  // picked a specific earned Rebate row from the "Log Collected Rebate"
  // dialog's period dropdown. If set, we update THAT row in place. If
  // omitted we auto-match the oldest earned-uncollected row on the
  // contract. Ignored for all other code paths.
  rebateId?: string
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
    const kind: "earned" | "collected" = input.rebateKind ?? "earned"
    // Quantity only makes sense for an earned-accrual row where unit counts
    // drive per-unit / per-procedure tier math. Collection rows record money
    // received and don't carry a unit basis.
    const qty =
      kind === "earned" &&
      typeof input.quantity === "number" &&
      Number.isFinite(input.quantity) &&
      input.quantity > 0
        ? input.quantity
        : null
    const descriptionForNotes = input.description.trim().length > 0
      ? input.description
      : kind === "collected"
        ? `Collected payment: $${input.amount.toLocaleString()} received ${txnDate.toDateString()}`
        : `Rebate earned (manual): $${input.amount.toLocaleString()}`
    const notes =
      qty != null ? `${descriptionForNotes} (Qty: ${qty})` : descriptionForNotes

    // ── Charles W1.W-C1: collection → update existing earned row in place.
    //
    // Logging a collection against an earned period must NOT create a
    // parallel row; it should stamp `collectionDate` + `rebateCollected`
    // on the SAME row so the ledger can render Earned / Collected /
    // Outstanding on a single line per period. If the caller passed a
    // specific rebateId from the period dropdown, we update that row;
    // otherwise we auto-match the oldest earned-uncollected row on this
    // contract so the most-delinquent period pays down first. Only when
    // no earned row is available do we fall back to the R5.34 pure-
    // collection row (`rebateEarned=0`).
    if (kind === "collected") {
      // Auto-match priority (when caller didn't pick a specific period):
      //   1. Period whose window contains the collection date — this is
      //      the user's actual intent in 99% of cases. Logging a collection
      //      for "Mar 30, 2026" belongs in the Q1 2026 period, not the
      //      oldest-outstanding Q1 2024 row (prior behavior — bug reported
      //      by Charles 2026-04-23).
      //   2. Oldest earned-uncollected row on the contract — fallback for
      //      out-of-window collections (e.g. paid very late).
      const rebateSelect = {
        id: true,
        rebateEarned: true,
        rebateCollected: true,
        collectionDate: true,
        notes: true,
      } as const
      // Charles 2026-04-24: only match against rows whose window contains
      // the collection date. The prior "oldest-unpaid" fallback caused a
      // March 31 2026 collection to silently bind to a 2024 row when the
      // current quarter's accrual hadn't been materialized yet. If no
      // windowed row exists, fall through to the orphan-row creation
      // path below (which is clearly labeled `[out-of-band]`) rather
      // than attaching the collection to an unrelated period.
      const target = input.rebateId
        ? await prisma.rebate.findFirst({
            where: { id: input.rebateId, contractId: input.contractId },
            select: rebateSelect,
          })
        : await prisma.rebate.findFirst({
            where: {
              contractId: input.contractId,
              collectionDate: null,
              rebateEarned: { gt: 0 },
              payPeriodStart: { lte: txnDate },
              payPeriodEnd: { gte: txnDate },
            },
            orderBy: { payPeriodEnd: "asc" },
            select: rebateSelect,
          })

      if (target) {
        const priorCollected = Number(target.rebateCollected ?? 0)
        const nextCollected = priorCollected + input.amount
        // Preserve the original accrual notes so the audit trail survives.
        // We append the collection event so the ledger shows both sides on
        // one row. Strip the `[auto-accrual]` prefix only if the combined
        // row is now fully collected — that way future `recomputeAccrualForContract`
        // runs (which delete rows still matching the prefix AND
        // `collectionDate IS NULL`) can't wipe a collection the user just
        // logged.
        const mergedNotes = [
          target.notes ?? "",
          `Collected ${txnDate.toDateString()}: ${descriptionForNotes}`,
        ]
          .filter((s) => s.length > 0)
          .join(" — ")
        const updated = await prisma.rebate.update({
          where: { id: target.id },
          data: {
            rebateCollected: nextCollected,
            collectionDate: txnDate,
            notes: mergedNotes,
          },
        })
        return serialize({ kind: "rebate" as const, row: updated })
      }
      // Fallback: no earned row available (out-of-band collection). Create
      // a pure-collection row so the payment still shows in the ledger,
      // and annotate so the user knows why it isn't paired with an earned
      // accrual.
      const orphanNotes = `[out-of-band] ${descriptionForNotes}`
      const rebate = await prisma.rebate.create({
        data: {
          contractId: input.contractId,
          facilityId: facility.id,
          rebateEarned: 0,
          rebateCollected: input.amount,
          payPeriodStart: txnDate,
          payPeriodEnd: txnDate,
          collectionDate: txnDate,
          notes: orphanNotes,
        },
      })
      return serialize({ kind: "rebate" as const, row: rebate })
    }

    // Earned path (unchanged from R5.34 semantics).
    const rebate = await prisma.rebate.create({
      data: {
        contractId: input.contractId,
        facilityId: facility.id,
        rebateEarned: input.amount,
        rebateCollected: 0,
        payPeriodStart: txnDate,
        payPeriodEnd: txnDate,
        collectionDate: null,
        notes,
      },
    })
    return serialize({ kind: "rebate" as const, row: rebate })
  }

  // Charles 2026-04-24 (Bug 14): payments/credits are vendor-invoice
  // activity and must not be written to `totalSpend`. `totalSpend` is the
  // canonical source for Current Spend (see lib/actions/contracts.ts
  // getContracts — `_sum: { totalSpend: true }` over ContractPeriod),
  // so bleeding a payment amount into it would overwrite the spend card
  // with the payment value. Both payment and credit mirror the same amount
  // onto paymentExpected and paymentActual so the per-type report's
  // variance column (expected − actual) nets to zero per logged row —
  // matching the seed invoice pattern in prisma/seeds/contract-periods.ts.
  // If we ever need a distinct expected-vs-actual signal for payments,
  // split these into a dedicated payments ledger rather than reusing
  // ContractPeriod rollup fields.
  const period = await prisma.contractPeriod.create({
    data: {
      contractId: input.contractId,
      facilityId: facility.id,
      periodStart: txnDate,
      periodEnd: txnDate,
      totalSpend: 0,
      rebateEarned: 0,
      rebateCollected: 0,
      paymentExpected: input.amount,
      paymentActual: input.amount,
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

  // Charles W1.Q — ledger shows only closed periods; future-dated
  // accruals (e.g. from seed data or speculative recompute) are hidden.
  // Matches CLAUDE.md doctrine: earned = payPeriodEnd <= today. If this
  // filter reduces visible rows to 0 when the contract HAS future-dated
  // rows, the empty state (W1.P) explains: "no earned rebates yet —
  // click Recompute."
  const today = new Date()
  const rows = await prisma.rebate.findMany({
    where: {
      contractId,
      payPeriodEnd: { lte: today },
    },
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

// ─── Edit / delete a ledger row (Charles W1.X-A) ────────────────
//
// Users had no way to correct a logged collection — wrong amount,
// wrong date — short of hand-editing the DB. `updateContractTransaction`
// is scoped via the same `requireFacility` + `contractOwnershipWhere`
// guard as `createContractTransaction`, and only mutates the whitelisted
// collection fields.
//
// Charles 2026-04-24 (Bug 13): `rebateEarned` is editable on MANUALLY
// entered rows (notes does NOT contain `[auto-accrual]`), so a typo in
// a hand-logged earned amount can be corrected without a DB edit.
// Engine-generated rows remain locked — the CLAUDE.md "rebates are
// never auto-computed for display" rule applies only to the engine's
// output; rows the user typed themselves are theirs to fix. Passing
// `collectionDate: null` is the explicit "uncollect" path.
interface UpdateContractTransactionInput {
  id: string
  contractId: string
  rebateEarned?: number
  rebateCollected?: number
  collectionDate?: string | null // explicit null = uncollect
  quantity?: number | null
  notes?: string
}

export async function updateContractTransaction(
  input: UpdateContractTransactionInput,
): Promise<void> {
  const { facility } = await requireFacility()
  // Ownership guard: the contract must belong to this facility.
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { id: true },
  })
  // The Rebate row must also belong to that contract.
  const rebate = await prisma.rebate.findUniqueOrThrow({
    where: { id: input.id },
    select: { contractId: true, notes: true },
  })
  if (rebate.contractId !== input.contractId) {
    throw new Error("Rebate does not belong to the requested contract")
  }

  const data: Prisma.RebateUpdateInput = {}
  if (input.rebateCollected !== undefined) {
    data.rebateCollected = input.rebateCollected
  }
  if (input.rebateEarned !== undefined) {
    // Engine-lock: auto-accrual rows carry the `[auto-accrual]` marker in
    // notes and must not have their earned amount mutated by hand — the
    // next recompute would just overwrite it anyway.
    if (rebate.notes?.includes("[auto-accrual]")) {
      throw new Error(
        "Earned amount on auto-accrual rows is engine-owned. Edit the term's tiers or click Recompute instead.",
      )
    }
    if (input.rebateEarned < 0) {
      throw new Error("Earned amount cannot be negative")
    }
    data.rebateEarned = input.rebateEarned
  }
  if (input.collectionDate !== undefined) {
    data.collectionDate =
      input.collectionDate === null ? null : new Date(input.collectionDate)
  }
  if (input.notes !== undefined) {
    data.notes = input.notes
  }
  // `quantity` is not a first-class Rebate column — the existing
  // create path folds it into `notes` as a "(Qty: N)" suffix. We
  // accept it on the input for API symmetry but don't persist it
  // separately; callers that want to edit the quantity should do so
  // via the `notes` field.

  await prisma.rebate.update({ where: { id: input.id }, data })
}

// `deleteContractTransaction` removes a user-logged Rebate row.
// Engine-generated accrual rows (notes contains `[auto-accrual]`) are
// refused — users should clear the collection via updateContractTransaction
// with `collectionDate: null`, or re-run Recompute Earned Rebates which
// will overwrite stale auto-accrual rows deterministically.
export async function deleteContractTransaction(input: {
  id: string
  contractId: string
}): Promise<void> {
  const { facility } = await requireFacility()
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { id: true },
  })
  const rebate = await prisma.rebate.findUniqueOrThrow({
    where: { id: input.id },
    select: { contractId: true, notes: true },
  })
  if (rebate.contractId !== input.contractId) {
    throw new Error("Rebate does not belong to the requested contract")
  }
  if (rebate.notes && rebate.notes.includes("[auto-accrual]")) {
    throw new Error(
      "Cannot delete an auto-accrual row. Uncollect instead, or run Recompute Earned Rebates.",
    )
  }
  await prisma.rebate.delete({ where: { id: input.id } })
}
