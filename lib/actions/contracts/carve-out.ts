"use server"

/**
 * Carve-out rebate adapter + server action — roadmap W1.Z-A.
 *
 * Wires the tested `lib/rebates/engine/carve-out.ts` to the Prisma
 * data model. Reads ContractPricing rows with a non-null
 * carveOutPercent (Charles N17's column), builds a CarveOutConfig,
 * pulls COG purchases for the contract, and runs the engine.
 *
 * Return shape is the canonical engine's RebateResult with
 * `carveOutLines[]` — one result per carved-out SKU showing spend,
 * units, and line rebate. Zero-rate / zero-spend lines omitted
 * upstream by the engine.
 *
 * Reference: `docs/superpowers/specs/2026-04-20-canonical-rebate-engine-gap-design.md`
 * track W1.Z-A.
 */
import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { calculateCarveOut } from "@/lib/rebates/engine/carve-out"
import { zeroResult } from "@/lib/rebates/engine/types"
import type {
  CarveOutConfig,
  PeriodData,
  PurchaseRecord,
  RebateResult,
} from "@/lib/rebates/engine/types"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"
import { serialize } from "@/lib/serialize"

/** Term shape pulled by CARVE_OUT_TERM_SELECT. */
interface CarveOutTermLike {
  termType: string
  termName: string
  appliesTo: string | null
  categories: string[]
  tiers: Array<{ rebateValue: unknown; rebateType: string }>
}

/**
 * Returns the current carve-out rebate state for a contract. Callers:
 * the contract-detail Rebates tab (display), the dashboard carve-out
 * drill-down, and anywhere reporting wants the line-level breakdown.
 *
 * Semantics:
 *   - Pulls every `ContractPricing` row for the contract that has a
 *     non-null `carveOutPercent`. Each becomes a CarveOutLineConfig.
 *   - Pulls every matched COG record for the contract (matchStatus
 *     IN on_contract / price_variance) and wraps as PurchaseRecord.
 *   - Delegates to `calculateCarveOut` in the canonical engine.
 *
 * Returns `{ type: "CARVE_OUT", rebateEarned: 0, carveOutLines: [] }`
 * when the contract has no carve-out rows configured.
 */
export async function getCarveOutRebate(
  contractId: string,
): Promise<RebateResult> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: {
      id: true,
      vendorId: true,
      additionalVendorIds: true,
      facilityId: true,
      // Charles 2026-06-07: carve-out must only compute when the contract
      // genuinely has carve-out intent — i.e. a `carve_out` term. A pure
      // spend-rebate contract whose pricing file happened to carry
      // carveOutPercent values was showing a phantom carve-out rebate
      // card. Gate on the term's presence below.
      terms: { select: CARVE_OUT_TERM_SELECT },
    },
  })
  return _buildCarveOutRebate(contract, facility.id)
}

// Term fields needed to evaluate BOTH carve-out shapes: per-SKU
// (carveOutPercent pricing rows) and the spend-rebate carve_out term
// (a percent-of-spend tier scoped to a category) — Charles 2026-06-20.
const CARVE_OUT_TERM_SELECT = {
  termType: true,
  termName: true,
  appliesTo: true,
  categories: true,
  tiers: {
    select: { rebateValue: true, rebateType: true },
    orderBy: { tierNumber: "desc" as const },
    take: 1,
  },
} as const

/**
 * Vendor-scoped carve-out rebate read — 2026-06-09 facility→vendor feature
 * port. Same engine + scoping as the facility card; auth pivots on
 * `Contract.vendorId === session.vendor.id` like the other getVendor* reads.
 */
export async function getVendorCarveOutRebate(
  contractId: string,
): Promise<RebateResult> {
  const { vendor } = await requireVendor()
  const contract = await prisma.contract.findFirstOrThrow({
    where: { id: contractId, vendorId: vendor.id },
    select: {
      id: true,
      vendorId: true,
      additionalVendorIds: true,
      facilityId: true,
      terms: { select: CARVE_OUT_TERM_SELECT },
    },
  })
  return _buildCarveOutRebate(contract, contract.facilityId)
}

async function _buildCarveOutRebate(
  contract: {
    id: string
    vendorId: string | null
    additionalVendorIds: string[]
    terms: CarveOutTermLike[]
  },
  facilityId: string | null,
): Promise<RebateResult> {
  // Term-gate: no `carve_out` term → no carve-out, regardless of whatever
  // carveOutPercent values the pricing rows carry. Return the canonical
  // empty result (same shape as the no-lines short-circuit below) without
  // scanning pricing/COG.
  const hasCarveOutTerm = contract.terms.some(
    (t) => t.termType === "carve_out",
  )
  if (!hasCarveOutTerm) {
    const empty = calculateCarveOut(
      { type: "CARVE_OUT", lines: [] },
      { purchases: [], totalSpend: 0, periodLabel: "no carve-out term" },
    )
    return serialize(empty)
  }

  // Bug 3 (Vick 2026-06-02): grouped (tie-in) carve-out contracts span
  // several vendors. The accrual WRITER (recompute/carve-out.ts) already
  // counts the full vendor set, but this on-the-fly READ scoped to the
  // primary vendor only — so the carve-out rebate read low/"wrong" for a
  // grouped contract while the persisted Rebate rows said otherwise. Use
  // the canonical contractVendorIds() so read and writer agree.
  const vendorIds = contractVendorIds(contract)

  const [pricingItems, cogRecords] = await Promise.all([
    prisma.contractPricing.findMany({
      where: {
        contractId: contract.id,
        carveOutPercent: { not: null },
      },
      select: {
        vendorItemNo: true,
        carveOutPercent: true,
      },
    }),
    prisma.cOGRecord.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        OR: [
          { contractId: contract.id },
          ...(vendorIds.length
            ? [{ contractId: null, vendorId: { in: vendorIds } }]
            : []),
        ],
        matchStatus: { in: ["on_contract", "price_variance"] },
      },
      select: {
        vendorItemNo: true,
        quantity: true,
        unitCost: true,
        extendedPrice: true,
        transactionDate: true,
        category: true,
      },
    }),
  ])

  const lines: CarveOutConfig["lines"] = pricingItems
    .filter((p) => p.carveOutPercent !== null)
    .map((p) => ({
      referenceNumber: p.vendorItemNo,
      rateType: "PERCENT_OF_SPEND" as const,
      rebatePercent: Number(p.carveOutPercent),
    }))

  // No per-SKU carveOutPercent rows. Before returning empty, handle the
  // SPEND-REBATE carve-out shape Charles flagged 2026-06-20 ("a Carve out
  // with a spend rebate … not sure where the calculations for the carve out
  // are … does not seem like enough"): a `carve_out` term whose tier is
  // percent-of-spend, scoped to a category, with NO per-SKU pricing lines.
  // The per-SKU engine can't price it (it has no reference numbers), so the
  // card showed $0. Compute it from category-scoped matched COG spend.
  if (lines.length === 0) {
    const carveOutTerm = contract.terms.find((t) => t.termType === "carve_out")
    const topTier = carveOutTerm?.tiers?.[0]
    if (carveOutTerm && topTier && topTier.rebateType === "percent_of_spend") {
      // percent_of_spend stores a FRACTION (0.02 = 2%); applied directly to
      // dollar spend it is NOT scaled ×100 (CLAUDE.md rebate-units caveat).
      const fraction = Number(topTier.rebateValue)
      const scopedCategories =
        carveOutTerm.appliesTo === "specific_category"
          ? carveOutTerm.categories.map(canonicalizeCategoryName)
          : null
      const inScope = (cat: string | null) =>
        scopedCategories === null ||
        scopedCategories.includes(canonicalizeCategoryName(cat ?? ""))
      const spend = cogRecords
        .filter((r) => inScope(r.category))
        .reduce((s, r) => s + Number(r.extendedPrice ?? 0), 0)
      if (fraction > 0 && spend > 0) {
        const rebateEarned = spend * fraction
        const result = zeroResult("CARVE_OUT", null)
        result.rebateEarned = rebateEarned
        // eligibleSpend = the carved-out spend basis (engine: Σ line
        // totalSpend). The performance card reads it for the "eligible spend"
        // figure AND gates the effective-rate line on `eligibleSpend > 0`, so
        // without this the rebate showed with "$0 eligible spend" and NO rate
        // — the exact number Charles needs to judge whether the carve-out is
        // "enough." Effective rate then renders as rebateEarned / spend.
        result.eligibleSpend = spend
        result.carveOutLines = [
          {
            referenceNumber: carveOutTerm.termName || "Carve-out (spend rebate)",
            rateType: "PERCENT_OF_SPEND",
            totalSpend: spend,
            totalUnits: 0,
            lineRebate: rebateEarned,
          },
        ]
        return serialize(result)
      }
    }
    const empty = calculateCarveOut(
      { type: "CARVE_OUT", lines: [] },
      { purchases: [], totalSpend: 0, periodLabel: "no carve-out lines" },
    )
    return serialize(empty)
  }

  const purchases: PurchaseRecord[] = cogRecords
    .filter(
      (r): r is typeof r & { vendorItemNo: string } =>
        r.vendorItemNo !== null,
    )
    .map((r) => ({
      referenceNumber: r.vendorItemNo,
      productCategory: r.category,
      quantity: r.quantity,
      unitPrice: Number(r.unitCost),
      extendedPrice: Number(r.extendedPrice ?? 0),
      purchaseDate: r.transactionDate,
    }))

  const totalSpend = purchases.reduce((s, p) => s + p.extendedPrice, 0)
  const periodData: PeriodData = {
    purchases,
    totalSpend,
    periodLabel: null,
  }

  const config: CarveOutConfig = { type: "CARVE_OUT", lines }
  const result = calculateCarveOut(config, periodData)
  return serialize(result)
}
