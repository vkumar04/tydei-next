"use server"

/**
 * Regenerate Rebate rows for a contract from its current term +
 * tier configuration (Charles R5.21).
 *
 * Background: `getAccrualTimeline` computes accruals on-the-fly for
 * display and NEVER writes to the database, while the contract detail
 * "Rebates Earned" card reads from `prisma.rebate` rows (per the
 * CLAUDE.md "never auto-compute rebates for display" rule).
 *
 * That split means when a user edits `ContractTerm.evaluationPeriod`
 * (or any other field that changes the accrual shape), the detail card
 * continues to show the stale $0 — no Rebate rows exist under the new
 * cadence until we regenerate them.
 *
 * This action owns that regeneration. It is safe to call repeatedly:
 *
 *   1. Delete all system-generated Rebate rows for the contract. Rows
 *      are identified by the auto-accrual notes-prefix FAMILY (see
 *      `AUTO_ACCRUAL_PREFIXES` — spend writer + every specialty
 *      writer) so manually entered rebates
 *      (`createContractTransaction` with type=rebate) are preserved
 *      while rows from a writer the contract's terms no longer route
 *      to are still wiped (bugs.rtfd 2026-06-12 R1 — term-type edits
 *      left the prior writer's rows immortal, double-counting:
 *      volume math 38,775 + stale 26,751 = 65,526).
 *   2. Walk the same compute path `getAccrualTimeline` uses, and write
 *      one Rebate row per month with a non-zero accrual, tagging each
 *      with the `[auto-accrual]` prefix.
 *
 * Called automatically at the end of every term save — create, update,
 * delete, and tier upsert — in `lib/actions/contract-terms.ts`.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import {
  bucketAccrualsByCadence,
  buildEvaluationPeriodAccruals,
  buildMonthlyAccruals,
  type EvaluationPeriod,
  type MonthlySpend,
  type MultiTermTimelineRow,
  type PaymentCadence,
  type TermAccrualConfig,
} from "@/lib/contracts/accrual"
import type {
  RebateMethodName,
  TierLike,
} from "@/lib/rebates/calculate"
import {
  buildCategoryWhereClause,
  buildUnionCategoryWhereClause,
} from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"
import { scaleRebateValueForEngine } from "@/lib/rebates/calculate"
import { ENGINE_VERSION } from "@/lib/rebates/engine-version"
// AUTO_ACCRUAL_PREFIX marks rows the spend writer owns so it can
// rewrite them safely without touching manually-entered rebate rows.
// AUTO_ACCRUAL_PREFIXES is the full writer family — the upfront wipes
// below must cover EVERY writer's prefix, not just the spend writer's
// (bugs.rtfd 2026-06-12 R1). Imported (never re-exported) because
// `"use server"` files can only export async functions per the
// CLAUDE.md convention; the constants live in a plain module.
import {
  AUTO_ACCRUAL_PREFIX,
  AUTO_ACCRUAL_PREFIXES,
} from "@/lib/contracts/recompute/auto-accrual-prefixes"

export interface RecomputeAccrualResult {
  deleted: number
  inserted: number
  // Total earned across all auto-accrual rows AFTER the rewrite. The
  // caller compares this against a prior total (if they have one) to
  // report how much the number moved; the action itself does not track
  // history. Charles W1.K: surfaced so the "Recompute Earned Rebates"
  // button in the Transactions tab can toast a real $ figure instead of
  // just row counts.
  sumEarned: number
  /** Charles 2026-04-26 #75/#76: term names of volume-family terms
   *  (volume_rebate, rebate_per_use, capitated_pricing_rebate) that
   *  had ≥1 tier but no CPT codes — the engine silently skips them
   *  because volume math counts CPT occurrences. Surface so the toast
   *  can warn the user instead of reporting "$0 earned" with no
   *  explanation. */
  volumeTermsMissingCpt: string[]
  /** Charles 2026-04-26 #55: term names of carve_out terms that have
   *  no ContractPricing rows with `carveOutPercent` set. The carve-out
   *  engine in `lib/rebates/engine/carve-out.ts` computes per-line
   *  rebates only when pricing rows carry the percent; without them
   *  the spend-writer falls through to plain tier math and the
   *  carve-out rates are effectively ignored. Surfacing the term name
   *  lets the recompute toast tell the user where to set the percent. */
  carveOutTermsMissingPricing: string[]
}

export async function recomputeAccrualForContract(
  contractId: string,
): Promise<RecomputeAccrualResult> {
  const { facility } = await requireFacility()
  return _recomputeAccrualForContractWithFacility(contractId, facility.id)
}

/**
 * Auth-bypassing engine. Same logic as `recomputeAccrualForContract`
 * but with the facility id passed in directly instead of resolved from
 * the session. Used by the source-oracle harness, which runs without
 * a session. Production code should call `recomputeAccrualForContract`
 * (the auth-gated entry point) instead.
 */
export async function _recomputeAccrualForContractWithFacility(
  contractId: string,
  facilityId: string,
): Promise<RecomputeAccrualResult> {
  const contract = await prisma.contract.findUnique({
    where: contractOwnershipWhere(contractId, facilityId),
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      // Charles audit suggestion #4 (v0-port): the per-line-item
      // cadence drives the accrual bucketing now that contract-level
      // paymentCadence is gone.
      capitalLineItems: {
        select: { paymentCadence: true },
        orderBy: { createdAt: "asc" },
      },
      // Bug #21: market_share + percent_of_spend writer needs the
      // primary category name to scope COG spend per period.
      productCategory: { select: { name: true } },
    },
  })

  // If the contract isn't visible to this facility, bail quietly — the
  // caller already validated the write. This just means we can't
  // recompute (e.g. cross-facility test fixtures).
  if (!contract) {
    return {
      deleted: 0,
      inserted: 0,
      sumEarned: 0,
      volumeTermsMissingCpt: [],
      carveOutTermsMissingPricing: [],
    }
  }

  // #2 (Vick 2026-05-31): a grouped contract's rebate accrual must run
  // over spend from EVERY participating vendor, not just the primary.
  // Every COG query below scopes to this set so a grouped contract owned
  // by vendor A also accrues on vendor B's spend. For a non-grouped
  // contract this is just [vendorId] — identical to the prior behavior.
  const vendorIds = contractVendorIds(contract)

  // Charles 2026-05-24 (Bug #16): tie-in contracts auto-stamp
  // collectionDate on every auto-accrual row (see line 586). The
  // delete filters below normally preserve rows with a non-null
  // collectionDate (user-logged collections), but tie-in has no
  // user-collection workflow — every "collected" row is system-
  // stamped. So drop the collectionDate gate when tie-in; otherwise
  // every Recompute click adds duplicate rows that survive forever.
  const isTieIn = contract.contractType === "tie_in"
  const preserveUserCollections = !isTieIn

  // Charles 2026-04-26 #75/#76: collect volume-family terms with no
  // CPT codes so the toast can warn the user. Done here (before the
  // filter strips them) so we have visibility into why the engine
  // produced no rows for that term.
  // Bug #24 (2026-05-11, Vick): the "missing CPT codes" diagnostic
  // is no longer accurate. Since bug #17 (2026-05-08), volume terms
  // with empty `cptCodes` route through `recomputeVolumeFromCogRecords`
  // and pay rebate on COG line-item quantity × tier rate. Surfacing
  // those terms as "Skipped — add CPT codes" was misleading and is
  // why screenshot 3 showed the warning despite the rebate working.
  // Only flag terms that have NEITHER cptCodes nor a usable COG
  // basis (vendor missing — fallback writer returns 0 then).
  const volumeTermsMissingCpt = contract.terms
    .filter(
      (t) =>
        (t.termType === "volume_rebate" ||
          t.termType === "rebate_per_use" ||
          t.termType === "capitated_pricing_rebate") &&
        t.tiers.length > 0 &&
        (!Array.isArray(t.cptCodes) || t.cptCodes.length === 0) &&
        // COG fallback needs a vendor to scope spend; without that
        // it returns 0 and the user has no path to a rebate.
        !contract.vendorId,
    )
    .map((t) => t.termName)

  // Charles 2026-04-26 #55: detect carve_out terms that have no
  // pricing-row carve-out percent set. Without that, the per-line
  // engine has no rates to apply.
  const carveOutTerms = contract.terms.filter(
    (t) => t.termType === "carve_out",
  )
  let carveOutTermsMissingPricing: string[] = []
  if (carveOutTerms.length > 0) {
    const carvePricingCount = await prisma.contractPricing.count({
      where: { contractId, carveOutPercent: { not: null } },
    })
    if (carvePricingCount === 0) {
      carveOutTermsMissingPricing = carveOutTerms.map((t) => t.termName)
    }
  }

  // Charles W1.Q — Self-heal future-dated auto-accrual rows first.
  // These are stale artifacts from seed scripts or pre-R5.26 runs that
  // wrote Rebate rows with `payPeriodEnd > today`. The main delete below
  // would catch them anyway (same notes prefix), but calling out the
  // future purge as its own step makes the invariant explicit: no
  // `[auto-accrual]` row may ever carry `payPeriodEnd > today`.
  // bugs.rtfd 2026-06-12 R1: both wipes below must cover the WHOLE
  // auto-accrual prefix family, not just the spend writer's
  // `[auto-accrual]`. Pre-fix, a term-type edit (market_share →
  // volume_rebate) left the prior writer's rows immortal — the
  // specialty writers each delete only their own prefix and only run
  // for terms currently of their type, so nothing ever deleted the
  // old `[auto-threshold-accrual]` rows (volume math 38,775 + stale
  // 26,751 = 65,526 double-count on prod). The specialty writers still
  // re-delete their own term prefix before writing; this upfront wipe
  // only widens what's already deleted, so their assumptions hold.
  // NOTE: the OR array is constructed fresh here — never spread these
  // branches into an existing OR clause (Prisma OR-spread collision
  // class, see project memory).
  const autoAccrualFamilyOr = AUTO_ACCRUAL_PREFIXES.map((p) => ({
    notes: { startsWith: p },
  }))
  const now = new Date()
  await prisma.rebate.deleteMany({
    where: {
      contractId,
      OR: autoAccrualFamilyOr,
      payPeriodEnd: { gt: now },
      // Charles W1.W-C1: never wipe a row the user has already marked
      // collected — that stamp is the only record of money received.
      // Bug #16: drop the collectionDate gate on tie-in so auto-
      // stamped future rows actually get purged.
      ...(preserveUserCollections ? { collectionDate: null } : {}),
    },
  })

  // Always wipe the previous auto-accrual rows first so a term edit
  // that shrinks the accrual window (e.g. fewer months qualify) drops
  // the now-obsolete entries. Manual rebates are preserved by the
  // `notes` prefix filter.
  //
  // Charles W1.W-C1: also preserve rows that have been collected. Once
  // the user logs a collection, the row carries `collectionDate != null`
  // and must survive future recomputes — otherwise Recompute Earned
  // Rebates would silently erase the payment-received stamp.
  //
  // bugs.rtfd 2026-06-12 R1: covers the full prefix family (see the
  // comment on the future-dated purge above) so stale rows from a
  // writer the term no longer routes to are wiped too.
  const deleteResult = await prisma.rebate.deleteMany({
    where: {
      contractId,
      OR: autoAccrualFamilyOr,
      ...(preserveUserCollections ? { collectionDate: null } : {}),
    },
  })

  // Charles R5.29: iterate ALL terms, not just terms[0]. Multi-term
  // contracts (e.g. "Qualified Annual Spend Rebate" + "Distal Extremities
  // Rebate") under-reported because only the first term's math was ever
  // summed into the ledger. We now compute each term's own accrual
  // series and sum per-month across terms before writing Rebate rows.
  // Charles 2026-04-25: filter out term types that have their own
  // dispatcher OR that are pricing-only (no rebate accrual). Without
  // this filter, a `price_reduction` term with tiers would feed the
  // spend writer and emit phantom Rebate rows even though the type's
  // dropdown description promises "no separate rebate accrual."
  // Pricing-only types (no rebate accrual at all):
  //   price_reduction, market_share_price_reduction,
  //   capitated_price_reduction, locked_pricing.
  // Types with their own dispatcher (handled below this block):
  //   volume_rebate, rebate_per_use, capitated_pricing_rebate
  //     → recomputeVolumeAccrualForTerm
  //   po_rebate → recomputePoAccrualForTerm
  //   payment_rebate → recomputeInvoiceAccrualForTerm
  //   compliance_rebate, market_share → recomputeThresholdAccrualForTerm
  // NOTE: carve_out and tie_in_capital are NOT in this skip set —
  // they keep the spend-writer math; their dedicated engines layer
  // additional logic on top (carve-out handles excluded items;
  // tie-in handles capital amortization) but do not replace the
  // spend writer's accrual emission.
  const SPEND_WRITER_SKIP_TYPES = new Set([
    "price_reduction",
    "market_share_price_reduction",
    "capitated_price_reduction",
    "locked_pricing",
    "volume_rebate",
    "rebate_per_use",
    "capitated_pricing_rebate",
    "po_rebate",
    "payment_rebate",
    "compliance_rebate",
    "market_share",
    // Charles 2026-04-26 #55: carve_out now routes through its own
    // dispatcher (recomputeCarveOutAccrualForTerm) so the per-line
    // carveOutPercent rates are honored. The earlier comment in this
    // file said carve_out kept the spend writer's math; that was the
    // bug — the spend writer ignored carve-out rates and applied tier
    // math to total spend instead.
    "carve_out",
  ])
  const allTermsWithTiers = contract.terms.filter((t) => t.tiers.length > 0)
  const termsWithTiers = allTermsWithTiers.filter(
    (t) => !SPEND_WRITER_SKIP_TYPES.has(t.termType),
  )
  // Early-return ONLY when there are no terms in either the spend
  // writer's domain OR any dispatcher's domain. A contract with only
  // a volume_rebate term still needs the volume dispatcher to fire.
  if (allTermsWithTiers.length === 0) {
    return {
      deleted: deleteResult.count,
      inserted: 0,
      sumEarned: 0,
      volumeTermsMissingCpt,
      carveOutTermsMissingPricing,
    }
  }

  // Charles W1.U-A: each term may be scoped to a specific set of product
  // categories (`ContractTerm.appliesTo === "specific_category"` with
  // `categories: ["Spine", ...]`). Pre-W1.U the engine pulled COG by
  // vendorId only and fed the vendor's entire spend through every term,
  // which over-reported rebates on narrow terms and under-reported when
  // tier thresholds needed isolated category spend.
  //
  // Strategy: query COG once over the UNION of every term's categories
  // (or unfiltered when any term is all-products), then partition the
  // rows per-term in memory and run the engine per-term with its own
  // spend series. The per-term accrual rows are then summed per month
  // into a synthetic `MultiTermTimelineRow[]` that the existing cadence
  // bucketer consumes unchanged.
  const termScopes = termsWithTiers.map((term) => ({
    appliesTo: term.appliesTo,
    categories: term.categories,
  }))
  // 2026-06-08: expand category scope to the facility's drifted COG variants
  // (canonical match) so accrual doesn't drop case/word-order-different rows
  // — both the union SQL fetch below and the per-term in-memory partition.
  const cogCategoryUniverse = await facilityCogCategoryUniverse(facilityId)
  const unionCategoryWhere = buildUnionCategoryWhereClause(
    termScopes,
    cogCategoryUniverse,
  )

  // Charles W1.V — scale `rebateValue` by 100 at the Prisma boundary for
  // `percent_of_spend` tiers (same convention as `getAccrualTimeline`
  // from W1.S and `computeRebateFromPrismaTiers`). Pre-fix this boundary
  // fed raw fractions (0.03) into the engine, which expects integer
  // percent (3), so every persisted Rebate row's `rebateEarned` landed
  // 100× too small. Routes through `scaleRebateValueForEngine` so the
  // unit convention is owned by a single helper. See CLAUDE.md "Rebate
  // engine units" rule.
  const termConfigs: TermAccrualConfig[] = termsWithTiers.map((term) => {
    // Charles iMessage 2026-04-21: "Fixed Rebate" tiers (rebateType =
    // fixed_rebate) were being treated as percent_of_spend — a \$30,000
    // fixed rebate was computed as 30000% × spend. Thread fixedRebateAmount
    // through so the canonical engine's cumulative/marginal helpers
    // short-circuit to the flat dollar amount on tier qualification.
    const tiers: TierLike[] = term.tiers.map((t) => {
      const isFixedRebate = t.rebateType === "fixed_rebate"
      return {
        tierNumber: t.tierNumber,
        tierName: t.tierName ?? null,
        spendMin: Number(t.spendMin),
        spendMax: t.spendMax ? Number(t.spendMax) : null,
        // For fixed_rebate tiers the rebateValue column stores dollars,
        // not a percent. Set rebateValue to 0 here so any code path
        // that multiplies by spend × value cleanly returns 0; the
        // canonical engine reads fixedRebateAmount first and returns
        // the flat dollars before falling through to the percent math.
        rebateValue: isFixedRebate
          ? 0
          : scaleRebateValueForEngine(t.rebateValue, t.rebateType),
        fixedRebateAmount: isFixedRebate ? Number(t.rebateValue) : null,
      }
    })
    const method: RebateMethodName = term.rebateMethod ?? "cumulative"
    const evaluationPeriod: EvaluationPeriod =
      term.evaluationPeriod === "monthly" ||
      term.evaluationPeriod === "quarterly" ||
      term.evaluationPeriod === "semi_annual"
        ? term.evaluationPeriod
        : "annual"
    return {
      tiers,
      method,
      evaluationPeriod,
      effectiveStart: term.effectiveStart ?? null,
      effectiveEnd: term.effectiveEnd ?? null,
      // Charles 2026-04-25: growth-baseline plumbing. Threading the
      // term's `spendBaseline` + `baselineType` + `termType` through
      // so `buildEvaluationPeriodAccruals` can subtract the pro-rated
      // baseline before tier evaluation when the term is growth-based.
      spendBaseline:
        term.spendBaseline === null || term.spendBaseline === undefined
          ? null
          : Number(term.spendBaseline),
      baselineType: term.baselineType ?? null,
      termType: term.termType ?? null,
      // bugs.rtfd 2026-06-13 #1: baseline subtraction is gated on this.
      growthOnly: term.growthOnly ?? false,
    }
  })

  // Bound the accrual window by today — future months have no actuals
  // and shouldn't emit Rebate rows (those would leak into "earned"
  // aggregates that filter on payPeriodEnd <= today).
  const end = new Date(
    Math.min(new Date().getTime(), contract.expirationDate.getTime()),
  )

  // Charles R5.10/R5.12 — bucket COG spend by `transactionDate` (the
  // real purchase date), never by `createdAt` (the DB insertion time).
  // Using `createdAt` made every auto-accrual Rebate row land in the
  // single month the seed/import ran, pushing `payPeriodEnd` forward to
  // that month's end — which in turn got filtered out of the contract
  // detail "Rebates Earned" card (payPeriodEnd > today).
  //
  // Charles W1.U-A — spread `unionCategoryWhere` so the narrow set of
  // COG rows we ever need to consider is fetched in one round-trip;
  // per-term filtering happens below, in memory.
  const cogRecords = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facilityId,
      // #2 (Vick 2026-05-31): group-aware spend basis — the main
      // spend_rebate / threshold accrual sums COG across the contract's
      // full vendor set. (Per-term sub-writers — volume, po, carve-out,
      // invoice — still scope to the primary vendor; threading the set
      // through those writers is a tracked follow-up.)
      vendorId: { in: vendorIds },
      transactionDate: { gte: contract.effectiveDate, lte: end },
      ...unionCategoryWhere,
    },
    select: {
      transactionDate: true,
      extendedPrice: true,
      category: true,
    },
  })

  // Helper: build a YYYY-MM-keyed monthly spend series from a subset of
  // COG rows. We run it once per term with the term's category filter
  // applied so each term's tier math sees only the slice it is scoped to.
  const buildSeries = (
    rows: typeof cogRecords,
    categoryFilter: ReturnType<typeof buildCategoryWhereClause>,
  ): MonthlySpend[] => {
    const categoryIn = categoryFilter.category?.in ?? null
    const categorySet = categoryIn ? new Set(categoryIn) : null

    const byMonth = new Map<string, number>()
    for (const r of rows) {
      const d = r.transactionDate
      if (!d) continue
      if (categorySet && !categorySet.has(r.category ?? "")) continue
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
      byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.extendedPrice))
    }

    const series: MonthlySpend[] = []
    const cursor = new Date(
      Date.UTC(
        contract.effectiveDate.getUTCFullYear(),
        contract.effectiveDate.getUTCMonth(),
        1,
      ),
    )
    const lastMonth = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1),
    )
    while (cursor <= lastMonth) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`
      series.push({ month: key, spend: byMonth.get(key) ?? 0 })
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
    return series
  }

  // Charles W1.W-B1 — split terms by evaluation period. Terms whose
  // `evaluationPeriod` is longer than monthly (annual, semi-annual,
  // quarterly) must emit ONE Rebate row per completed evaluation window
  // — not monthly rows that accrete before the period closes. Monthly-
  // eval terms continue through the legacy per-month accrual + payment-
  // cadence bucketer so per-month rebate reporting still works.
  const monthlyEvalIdx: number[] = []
  const periodEvalIdx: number[] = []
  termsWithTiers.forEach((_, idx) => {
    if (termConfigs[idx].evaluationPeriod === "monthly") {
      monthlyEvalIdx.push(idx)
    } else {
      periodEvalIdx.push(idx)
    }
  })

  // ─── Monthly-eval terms: existing monthly → cadence-bucket flow ───
  const monthlyPerTermResults = monthlyEvalIdx.map((origIdx) => {
    const term = termsWithTiers[origIdx]
    const termScope = { appliesTo: term.appliesTo, categories: term.categories }
    const termCategoryWhere = buildCategoryWhereClause(
      termScope,
      cogCategoryUniverse,
    )
    const series = buildSeries(cogRecords, termCategoryWhere)
    const rows = buildMonthlyAccruals(
      series,
      termConfigs[origIdx].tiers,
      termConfigs[origIdx].method,
      termConfigs[origIdx].evaluationPeriod,
    )
    return { termIndex: origIdx, series, rows, config: termConfigs[origIdx] }
  })

  const monthsTimeline =
    monthlyPerTermResults[0]?.series.map((s) => s.month) ?? []

  const multiRows: MultiTermTimelineRow[] = monthsTimeline.map((month, i) => {
    let totalSpend = 0
    let totalAccrued = 0
    let bestTier = 0
    let bestPercent = 0
    let bestContribution = -1
    const contributions: MultiTermTimelineRow["termContributions"] = []

    const monthStart = monthKeyToDate(month)
    const monthEnd = monthKeyEndOfMonth(month)

    for (const { termIndex, rows, config, series } of monthlyPerTermResults) {
      const startOk =
        config.effectiveStart == null || config.effectiveStart <= monthEnd
      const endOk =
        config.effectiveEnd == null || config.effectiveEnd >= monthStart
      if (!startOk || !endOk) continue

      const row = rows[i]
      const entry = series[i]
      if (!row || !entry) continue

      totalSpend += entry.spend

      if (row.accruedAmount <= 0) continue
      totalAccrued += row.accruedAmount
      contributions.push({
        termIndex,
        accruedAmount: row.accruedAmount,
        tierAchieved: row.tierAchieved,
        rebatePercent: row.rebatePercent,
      })
      if (row.accruedAmount > bestContribution) {
        bestContribution = row.accruedAmount
        bestTier = row.tierAchieved
        bestPercent = row.rebatePercent
      }
    }

    return {
      month,
      spend: totalSpend,
      cumulativeSpend: totalSpend,
      accruedAmount: totalAccrued,
      tierAchieved: bestTier,
      rebatePercent: bestPercent,
      termContributions: contributions,
    }
  })

  // Charles audit suggestion #4 (v0-port): contract-level paymentCadence
  // was removed when capital moved to line items. Recompute now buckets
  // monthly-eval accruals into the contract's first capital line item's
  // cadence (multi-asset deals pick the densest cadence the same way
  // tie-in.ts aggregates schedules). Falls back to monthly when no
  // capital is configured.
  const cadences = contract.capitalLineItems
    ?.map((i) => (i.paymentCadence ?? "monthly") as PaymentCadence)
    ?? []
  const primaryCadence: PaymentCadence = cadences.includes("monthly")
    ? "monthly"
    : cadences.includes("quarterly")
      ? "quarterly"
      : cadences[0] ?? "monthly"
  const cadenceBuckets = bucketAccrualsByCadence(multiRows, primaryCadence)

  // Charles W1.W-C1: preserved collected rows from a prior accrual run
  // now live in the Rebate table with `collectionDate != null`. Skip
  // any bucket whose period already has such a row — re-inserting would
  // double-count the earned accrual. The collected row already carries
  // the accrual (rebateEarned is preserved in-place when the user logs
  // a collection), so we trust it as the final ledger entry for that
  // period.
  const preservedCollected = await prisma.rebate.findMany({
    where: {
      contractId,
      collectionDate: { not: null },
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    },
    select: { payPeriodStart: true, payPeriodEnd: true },
  })
  // 2026-06-09 prod audit (Bug 3): key on DATE-ONLY, not full ISO strings.
  // The engine emits periodEnd = nextStart − 1ms (…T23:59:59.999Z), but
  // Rebate.payPeriodStart/End are @db.Date — stored truncated to midnight —
  // so the full-ISO comparison NEVER matched and every recompute after a
  // collection re-inserted the period (live proof: a $391,846.83 row
  // duplicated on prod 8 minutes apart). Date-only keys match what the DB
  // actually stores.
  const dateKey = (d: Date | string): string =>
    new Date(d).toISOString().slice(0, 10)
  const preservedKeys = new Set(
    preservedCollected.map(
      (r) => `${dateKey(r.payPeriodStart)}|${dateKey(r.payPeriodEnd)}`,
    ),
  )
  const periodKey = (start: Date, end: Date): string =>
    `${dateKey(start)}|${dateKey(end)}`

  // Monthly-eval path (from W1.W-B): cadence-bucketed rows. Skip any
  // bucket whose period already has a preserved collected row.
  // Roadmap track 2: every auto-accrual row carries the engine version
  // that computed it; stamp here so future targeted-recompute runs can
  // identify rows that predate a math change.
  // Charles 2026-04-23 (Bug 3a): on tie-in contracts the rebate retires
  // capital on EARN, not on collect — the vendor applies the credit
  // directly. We encode that by auto-stamping `collectionDate` on
  // tie-in auto-accrual rows equal to `payPeriodEnd`, so `rebateCollected`
  // === `rebateEarned` by construction. That lets the canonical
  // `sumRebateAppliedToCapital` keep its collected-only rule without a
  // semantic flip while giving the user the "no manual collect needed"
  // experience they asked for. Non-tie-in contracts keep the prior
  // "earned, awaiting collection" shape.
  const toInsert: {
    contractId: string
    facilityId: string
    rebateEarned: number
    rebateCollected: number
    payPeriodStart: Date
    payPeriodEnd: Date
    collectionDate: Date | null
    notes: string
    engineVersion: string
    engineWarnings: string | null
  }[] = cadenceBuckets
    .filter((b) => !preservedKeys.has(periodKey(b.periodStart, b.periodEnd)))
    .map((b) => {
      const noteBody =
        b.termCount > 1
          ? `${b.termCount} terms combined on $${b.totalSpend.toFixed(2)} (${b.label})`
          : `${b.label} · tier ${b.tierAchieved} @ ${b.rebatePercent}% on $${b.totalSpend.toFixed(2)}`
      return {
        contractId,
        facilityId: facilityId,
        rebateEarned: b.rebateEarned,
        rebateCollected: isTieIn ? b.rebateEarned : 0,
        payPeriodStart: b.periodStart,
        payPeriodEnd: b.periodEnd,
        collectionDate: isTieIn ? b.periodEnd : null,
        notes: `${AUTO_ACCRUAL_PREFIX} ${noteBody}`,
        engineVersion: ENGINE_VERSION,
        engineWarnings: null,
      }
    })

  // ─── Period-eval terms: ONE row per completed window (W1.W-B1) ───
  // Each annual/semi-annual/quarterly-eval term is bucketed on its own.
  // Windows align to the term's `effectiveStart` (fallback:
  // contract.effectiveDate). Incomplete windows (periodEnd > today) are
  // dropped so the "earned ≤ today" ledger filter stays honest.
  // `now` is already declared above (future-row purge, W1.Q).
  for (const origIdx of periodEvalIdx) {
    const term = termsWithTiers[origIdx]
    const config = termConfigs[origIdx]
    const termScope = { appliesTo: term.appliesTo, categories: term.categories }
    const termCategoryWhere = buildCategoryWhereClause(
      termScope,
      cogCategoryUniverse,
    )
    const series = buildSeries(cogRecords, termCategoryWhere)

    const windowAnchor = term.effectiveStart ?? contract.effectiveDate
    // bugs.rtfd 2026-06-13 #2: push date-only end bounds to end-of-day so
    // a period whose periodEnd is the SAME calendar day as the term/
    // contract end still counts as complete. Without this, an annual term
    // ending 2024-12-31 emits ZERO buckets — its window's periodEnd
    // (2024-12-31T23:59:59.999) > termWindowEnd (2024-12-31T00:00:00) and
    // `buildEvaluationPeriodAccruals` drops it as incomplete. The
    // threshold writer already does this (W1.W-B1); the spend writer's
    // period-eval path didn't, so any contract whose expiration aligns
    // with a period boundary lost its final (or only) window.
    const endOfDayUTC = (d: Date) =>
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)
    const termWindowEnd = term.effectiveEnd
      ? new Date(
          Math.min(now.getTime(), endOfDayUTC(term.effectiveEnd), endOfDayUTC(end)),
        )
      : new Date(Math.min(now.getTime(), endOfDayUTC(end)))

    // Bug #22 (2026-05-11, Vick): a contract with `spendBaseline > 0`
    // should pay rebate only on dollars ABOVE the baseline. Charles
    // 2026-05-25: the legacy `growth_rebate` termType was retired —
    // growth is now expressed as `growthOnly: true` on a plain
    // `spend_rebate`, which the engine routes through the same
    // baseline-above math.
    //
    // Rule: if `spendBaseline > 0`, apply baseline-above math for
    // tier evaluation. The bucket's reported `totalSpend` still shows
    // gross spend; the tier engine sees `max(0, periodSpend −
    // proRatedBaseline)`.
    // bugs.rtfd 2026-06-13 #1: subtract the baseline ONLY when the user
    // chose "Growth" (growthOnly). "From dollar one" earns on full
    // eligible spend even with a baseline set — the baseline is then a
    // tier threshold, not a reduction. (Was: subtract whenever
    // spendBaseline > 0, regardless of the dropdown.)
    const growthSubtract =
      config.growthOnly === true &&
      config.spendBaseline != null &&
      config.spendBaseline > 0
    const periodBuckets = buildEvaluationPeriodAccruals(
      series,
      config.tiers,
      config.method,
      config.evaluationPeriod,
      windowAnchor,
      {
        boundedUntil: termWindowEnd,
        spendBaseline: growthSubtract ? config.spendBaseline ?? null : null,
        growthBased: growthSubtract,
      },
    )

    for (const b of periodBuckets) {
      if (b.rebateEarned <= 0 && b.totalSpend <= 0) continue
      // Charles W1.W-C1: skip if a collected row already exists for this window.
      if (preservedKeys.has(periodKey(b.periodStart, b.periodEnd))) continue
      // bugs.rtfd 2026-06-13 ("not taking the 500K growth baseline into
      // account"): when a growth baseline was subtracted, the rate applied to
      // the qualifying (net) spend, not gross. Show that basis so the note
      // reconciles `rate × basis = earned` instead of citing gross spend.
      const baseClause =
        b.growthBaselineApplied > 0
          ? `$${b.qualifyingSpend.toFixed(2)} (gross $${b.totalSpend.toFixed(2)} − $${b.growthBaselineApplied.toFixed(2)} growth baseline)`
          : `$${b.totalSpend.toFixed(2)}`
      const noteBody = `${b.label} · tier ${b.tierAchieved} @ ${b.rebatePercent}% on ${baseClause} (${config.evaluationPeriod}-eval)`
      toInsert.push({
        contractId,
        facilityId: facilityId,
        rebateEarned: b.rebateEarned,
        rebateCollected: isTieIn ? b.rebateEarned : 0,
        payPeriodStart: b.periodStart,
        payPeriodEnd: b.periodEnd,
        collectionDate: isTieIn ? b.periodEnd : null,
        notes: `${AUTO_ACCRUAL_PREFIX} ${noteBody}`,
        engineVersion: ENGINE_VERSION,
        engineWarnings: null,
      })
    }
  }

  // Charles 2026-04-25: volume-rebate dispatcher. For terms whose
  // termType is "volume_rebate", run the volume engine (CPT-event
  // counting from Cases) alongside the spend writer's output. Each
  // path uses its own AUTO_*_PREFIX so they don't clobber each
  // other on re-run. Best-effort: a failure here doesn't block the
  // spend rows from persisting.
  let volumeInserted = 0
  let volumeEarned = 0
  // Charles 2026-04-25: volume bridge family — all CPT-occurrence
  // counting term types route through `recomputeVolumeAccrualForTerm`.
  //   - volume_rebate: classic tiered occurrence ladder
  //   - rebate_per_use: variant with one tier at threshold 0 ($/occ)
  //   - capitated_pricing_rebate: per-procedure rebate when the
  //     procedure-spend cap is reached. Same Cases.procedures
  //     data source; the tier ladder defines when the cap is hit.
  // Bug #17 (2026-05-08, Vick): the dispatcher previously required
  // `cptCodes.length > 0`, so a volume contract whose tiers gate on
  // line-item *quantity* (no procedures attached) silently produced
  // $0 earned with no rebate rows. Volume rebates can also be
  // expressed as "QTY of items used"; in that case the writer falls
  // back to summing COG-record `quantity` (filtered by the contract's
  // vendor + the term's category scope) and we keep the same tier
  // ladder + per-tier rebateType dispatch.
  const volumeTerms = contract.terms.filter(
    (t) =>
      (t.termType === "volume_rebate" ||
        t.termType === "rebate_per_use" ||
        t.termType === "capitated_pricing_rebate") &&
      t.tiers.length > 0,
  )
  if (volumeTerms.length > 0) {
    const { recomputeVolumeAccrualForTerm } = await import(
      "@/lib/contracts/recompute/volume"
    )
    for (const term of volumeTerms) {
      try {
        const r = await recomputeVolumeAccrualForTerm({
          contractId,
          facilityId: facilityId,
          contractEffectiveDate: contract.effectiveDate,
          contractExpirationDate: contract.expirationDate,
          isTieIn,
          term: {
            id: term.id,
            cptCodes: term.cptCodes,
            // Bug #17: COG-records fallback path needs to know the
            // contract's vendor + the term's category scope so it can
            // sum the right quantities.
            vendorId: contract.vendorId,
          vendorIds,
            categories: term.categories ?? [],
            appliesTo: term.appliesTo ?? null,
            // Bug 2026-05-20 (Vick): pass volumeType so the
            // purchase_order baseline path can dispatch on it.
            volumeType: term.volumeType ?? null,
            rebateMethod: term.rebateMethod ?? null,
            evaluationPeriod: term.evaluationPeriod ?? null,
            effectiveStart: term.effectiveStart ?? null,
            effectiveEnd: term.effectiveEnd ?? null,
            tiers: term.tiers,
          },
        })
        volumeInserted += r.inserted
        volumeEarned += r.sumEarned
      } catch (err) {
        console.warn(
          `[recomputeAccrualForContract] volume-accrual term ${term.id} failed:`,
          err,
        )
      }
    }
  }

  // Charles 2026-04-25: po_rebate dispatcher. Per-PO rebate counted
  // against PurchaseOrder rows tied to this contract's vendor.
  let poInserted = 0
  let poEarned = 0
  const poTerms = contract.terms.filter(
    (t) => t.termType === "po_rebate" && t.tiers.length > 0,
  )
  if (poTerms.length > 0) {
    const { recomputePoAccrualForTerm } = await import(
      "@/lib/contracts/recompute/po"
    )
    for (const term of poTerms) {
      try {
        const r = await recomputePoAccrualForTerm({
          contractId,
          vendorId: contract.vendorId,
          vendorIds,
          facilityId: facilityId,
          contractEffectiveDate: contract.effectiveDate,
          contractExpirationDate: contract.expirationDate,
          isTieIn,
          term: {
            id: term.id,
            rebateMethod: term.rebateMethod ?? null,
            evaluationPeriod: term.evaluationPeriod ?? null,
            effectiveStart: term.effectiveStart ?? null,
            effectiveEnd: term.effectiveEnd ?? null,
            tiers: term.tiers,
          },
        })
        poInserted += r.inserted
        poEarned += r.sumEarned
      } catch (err) {
        console.warn(
          `[recomputeAccrualForContract] po-accrual term ${term.id} failed:`,
          err,
        )
      }
    }
  }

  // Charles 2026-04-26 #55: carve_out dispatcher. Routes through the
  // canonical carve-out engine in lib/rebates/engine/carve-out.ts so
  // per-line carveOutPercent rates from ContractPricing are honored.
  // Pre-fix the spend writer ran tier math against full vendor spend,
  // ignoring per-line rates entirely.
  let carveOutInserted = 0
  let carveOutEarned = 0
  const carveOutDispatcherTerms = contract.terms.filter(
    (t) => t.termType === "carve_out",
  )
  if (carveOutDispatcherTerms.length > 0) {
    const { recomputeCarveOutAccrualForTerm } = await import(
      "@/lib/contracts/recompute/carve-out"
    )
    for (const term of carveOutDispatcherTerms) {
      try {
        const r = await recomputeCarveOutAccrualForTerm({
          contractId,
          vendorId: contract.vendorId,
          vendorIds,
          facilityId: facilityId,
          contractEffectiveDate: contract.effectiveDate,
          contractExpirationDate: contract.expirationDate,
          isTieIn,
          term: {
            id: term.id,
            evaluationPeriod: term.evaluationPeriod ?? null,
            effectiveStart: term.effectiveStart ?? null,
            effectiveEnd: term.effectiveEnd ?? null,
          },
        })
        carveOutInserted += r.inserted
        carveOutEarned += r.sumEarned
      } catch (err) {
        console.warn(
          `[recomputeAccrualForContract] carve-out-accrual term ${term.id} failed:`,
          err,
        )
      }
    }
  }

  // Charles 2026-04-25: payment_rebate via invoice bridge.
  // Counts qualifying invoices (matching vendor + facility + within
  // window + non-cancelled) per evaluation period. Tier ladder =
  // invoice counts; rebateValue = dollars per invoice at the
  // achieved tier.
  let invoiceInserted = 0
  let invoiceEarned = 0
  const invoiceTerms = contract.terms.filter(
    (t) => t.termType === "payment_rebate" && t.tiers.length > 0,
  )
  if (invoiceTerms.length > 0) {
    const { recomputeInvoiceAccrualForTerm } = await import(
      "@/lib/contracts/recompute/invoice"
    )
    for (const term of invoiceTerms) {
      try {
        const r = await recomputeInvoiceAccrualForTerm({
          contractId,
          vendorId: contract.vendorId,
          vendorIds,
          facilityId: facilityId,
          contractEffectiveDate: contract.effectiveDate,
          contractExpirationDate: contract.expirationDate,
          isTieIn,
          term: {
            id: term.id,
            rebateMethod: term.rebateMethod ?? null,
            evaluationPeriod: term.evaluationPeriod ?? null,
            effectiveStart: term.effectiveStart ?? null,
            effectiveEnd: term.effectiveEnd ?? null,
            tiers: term.tiers,
          },
        })
        invoiceInserted += r.inserted
        invoiceEarned += r.sumEarned
      } catch (err) {
        console.warn(
          `[recomputeAccrualForContract] invoice-accrual term ${term.id} failed:`,
          err,
        )
      }
    }
  }

  // Charles 2026-04-25: threshold-based dispatchers — compliance and
  // market-share rebates pay a flat tier dollar amount per evaluation
  // period when the contract-level metric crosses the threshold.
  // Both share the same bridge.
  let thresholdInserted = 0
  let thresholdEarned = 0
  const thresholdTerms = contract.terms.filter(
    (t) =>
      (t.termType === "compliance_rebate" || t.termType === "market_share") &&
      t.tiers.length > 0,
  )
  if (thresholdTerms.length > 0) {
    const { recomputeThresholdAccrualForTerm } = await import(
      "@/lib/contracts/recompute/threshold"
    )
    for (const term of thresholdTerms) {
      const metric: "complianceRate" | "currentMarketShare" =
        term.termType === "market_share"
          ? "currentMarketShare"
          : "complianceRate"
      // UNITS (audit-confirmed 2026-04-25): both contract columns are
      // `Decimal(5,2)` storing percent points 0-100 (the form writes a
      // 0-100 number directly via `setValueAs: Number(v)`), and tier
      // `spendMin` is also percent points. Pass through verbatim — the
      // bridge in recompute-threshold-accrual.ts compares them directly.
      let metricValue: number | null =
        metric === "currentMarketShare"
          ? contract.currentMarketShare === null ||
            contract.currentMarketShare === undefined
            ? null
            : Number(contract.currentMarketShare)
          : contract.complianceRate === null ||
              contract.complianceRate === undefined
            ? null
            : Number(contract.complianceRate)

      // Charles 2026-04-28: derive currentMarketShare dynamically from
      // computeCategoryMarketShare when the contract field isn't set,
      // so market_share terms can recompute without manual entry. Uses
      // the vendor's highest-spend category share as a stand-in;
      // category-scoped terms can pick a specific category in a future
      // revision. complianceRate has no derivable analog (it's a
      // workflow signal), so that path is unchanged.
      if (metric === "currentMarketShare" && metricValue == null) {
        try {
          const since = new Date()
          since.setMonth(since.getMonth() - 12)
          const cogRows = await prisma.cOGRecord.findMany({
            where: {
              facilityId,
              transactionDate: { gte: since },
            },
            select: {
              vendorId: true,
              category: true,
              extendedPrice: true,
              contractId: true,
            },
          })
          const contractIds = Array.from(
            new Set(
              cogRows
                .map((r) => r.contractId)
                .filter((v): v is string => !!v),
            ),
          )
          const contractCategoryRows =
            contractIds.length > 0
              ? await prisma.contract.findMany({
                  where: { id: { in: contractIds } },
                  select: {
                    id: true,
                    productCategory: { select: { name: true } },
                  },
                })
              : []
          const contractCategoryMap = new Map<string, string | null>(
            contractCategoryRows.map((c) => [
              c.id,
              c.productCategory?.name ?? null,
            ]),
          )
          const { computeCategoryMarketShare } = await import(
            "@/lib/contracts/market-share-filter"
          )
          if (contract.vendorId) {
            const result = computeCategoryMarketShare({
              rows: cogRows,
              contractCategoryMap,
              // #2: group-aware market-share numerator (helper accepts a set).
              vendorId: vendorIds,
            })
            const top = result.rows[0]
            if (top) metricValue = top.sharePct
          }
        } catch (err) {
          console.warn(
            `[recomputeAccrualForContract] currentMarketShare derivation failed for ${contractId}:`,
            err,
          )
        }
      }
      try {
        const r = await recomputeThresholdAccrualForTerm({
          contractId,
          facilityId: facilityId,
          contractEffectiveDate: contract.effectiveDate,
          contractExpirationDate: contract.expirationDate,
          metric,
          metricValue,
          isTieIn,
          term: {
            id: term.id,
            evaluationPeriod: term.evaluationPeriod ?? null,
            effectiveStart: term.effectiveStart ?? null,
            effectiveEnd: term.effectiveEnd ?? null,
            // Bug #21: market_share + percent_of_spend needs to fall
            // back to per-period vendor spend × percent. Thread the
            // contract's termType + vendor + category through so the
            // writer can fetch in-scope COG spend per bucket.
            termType: term.termType ?? null,
            vendorId: contract.vendorId,
          vendorIds,
            categoryName: contract.productCategory?.name ?? null,
            appliesTo: term.appliesTo ?? null,
            categories: term.categories ?? [],
            tiers: term.tiers,
            // bugs.rtfd 2026-06-13: growth baseline must apply to
            // market_share percent_of_spend rebates too (was spend-writer
            // only). 9% × (spend − $500K), not 9% × full spend.
            growthOnly: term.growthOnly ?? false,
            spendBaseline:
              term.spendBaseline === null || term.spendBaseline === undefined
                ? null
                : Number(term.spendBaseline),
          },
        })
        thresholdInserted += r.inserted
        thresholdEarned += r.sumEarned
      } catch (err) {
        console.warn(
          `[recomputeAccrualForContract] threshold-accrual term ${term.id} (${metric}) failed:`,
          err,
        )
      }
    }
  }

  if (
    toInsert.length === 0 &&
    volumeInserted === 0 &&
    poInserted === 0 &&
    thresholdInserted === 0 &&
    invoiceInserted === 0 &&
    carveOutInserted === 0
  ) {
    return {
      deleted: deleteResult.count,
      inserted: 0,
      sumEarned:
        volumeEarned +
        poEarned +
        thresholdEarned +
        invoiceEarned +
        carveOutEarned,
      volumeTermsMissingCpt,
      carveOutTermsMissingPricing,
    }
  }

  const createResult =
    toInsert.length > 0
      ? await prisma.rebate.createMany({ data: toInsert })
      : { count: 0 }

  // Re-read the auto-accrual total so the caller can render a real $
  // figure in a toast. Filtering on the notes prefix matches the same
  // set we delete/re-create above.
  const sumAgg = await prisma.rebate.aggregate({
    where: {
      contractId,
      notes: { startsWith: AUTO_ACCRUAL_PREFIX },
    },
    _sum: { rebateEarned: true },
  })
  const sumEarned =
    Number(sumAgg._sum.rebateEarned ?? 0) +
    volumeEarned +
    poEarned +
    thresholdEarned +
    invoiceEarned +
    carveOutEarned

  return {
    deleted: deleteResult.count,
    inserted:
      createResult.count +
      volumeInserted +
      poInserted +
      thresholdInserted +
      invoiceInserted +
      carveOutInserted,
    sumEarned,
    volumeTermsMissingCpt,
    carveOutTermsMissingPricing,
  }
}

// Local month-key helpers duplicated from `lib/contracts/accrual.ts` —
// the originals are not exported. Keep identical semantics (UTC-safe).
function monthKeyToDate(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month - 1, 1))
}

function monthKeyEndOfMonth(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month, 0))
}
