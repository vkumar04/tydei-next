/**
 * Reports hub — audit-trail PO coverage + contract-window helpers (pure).
 *
 * Shared by the facility action `getRebateCalculationAudit`
 * (`lib/actions/reports/audit-trail.ts`) and its vendor mirror
 * `getVendorRebateCalculationAudit`
 * (`lib/actions/vendor-reports/audit-trail.ts`). The two actions partition
 * PO lines into included-vs-excluded identically; this module is the one
 * place that math lives so the two surfaces can never drift.
 *
 * Kept framework-free (no Prisma import) so it can be unit-tested and so
 * the action layer only owns the tenant-scoped fetch.
 */
import {
  buildRebateCalculationAudit,
  type AuditContractInfo,
  type AuditTier,
  type AuditPurchase,
  type RebateCalcAudit,
} from "@/lib/reports/audit-trail"
import { applyTiers } from "@/lib/rebates/calculate"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"

/** One pricing-coverage window for a vendorItemNo (bounds optional). */
export interface CoverageEntry {
  effectiveDate: Date | null
  expirationDate: Date | null
}

/** Minimal pricing-item shape the coverage map is built from. */
export interface PricingItemForCoverage {
  vendorItemNo: string | null
  effectiveDate: Date | null
  expirationDate: Date | null
}

/**
 * Build the vendorItemNo → coverage-windows map from a contract's pricing
 * items. A purchase line is "on contract" iff its vendorItemNo matches a
 * pricing row AND the transaction date falls in one of the row's effective
 * windows (date bounds are optional).
 */
export function buildCoverageMap(
  pricingItems: PricingItemForCoverage[],
): Map<string, CoverageEntry[]> {
  const coverage = new Map<string, CoverageEntry[]>()
  for (const p of pricingItems) {
    if (!p.vendorItemNo) continue
    const entry: CoverageEntry = {
      effectiveDate: p.effectiveDate ?? null,
      expirationDate: p.expirationDate ?? null,
    }
    const existing = coverage.get(p.vendorItemNo)
    if (existing) existing.push(entry)
    else coverage.set(p.vendorItemNo, [entry])
  }
  return coverage
}

/** True when the item has a coverage window covering `date`. */
export function isCovered(
  coverage: Map<string, CoverageEntry[]>,
  vendorItemNo: string | null,
  date: Date,
): boolean {
  if (!vendorItemNo) return false
  const entries = coverage.get(vendorItemNo)
  if (!entries || entries.length === 0) return false
  const ms = date.getTime()
  return entries.some((e) => {
    if (e.effectiveDate && e.effectiveDate.getTime() > ms) return false
    if (e.expirationDate && e.expirationDate.getTime() < ms) return false
    return true
  })
}

/** True when `date` falls inside the contract's effective→expiration window. */
export function inContractWindow(
  contractStart: Date | null,
  contractEnd: Date | null,
  date: Date,
): boolean {
  const ms = date.getTime()
  if (contractStart && contractStart.getTime() > ms) return false
  if (contractEnd && contractEnd.getTime() < ms) return false
  return true
}

/** Minimal PO-line shape the partitioner reads. */
export interface PoLineForAudit {
  vendorItemNo: string | null
  extendedPrice: unknown
  purchaseOrder: {
    poNumber: string
    orderDate: Date
  }
}

/**
 * Partition PO lines into the `AuditPurchase[]` the audit builder consumes:
 * lines covered by contract pricing AND inside the contract date window are
 * included; everything else is excluded with a reason + category. Identical
 * logic on both the facility and vendor sides.
 */
export function buildAuditPurchases(
  poLines: PoLineForAudit[],
  coverage: Map<string, CoverageEntry[]>,
  contractStart: Date | null,
  contractEnd: Date | null,
): AuditPurchase[] {
  return poLines.map((line) => {
    const amount = Number(line.extendedPrice ?? 0)
    const date = line.purchaseOrder.orderDate
    const inWindow = inContractWindow(contractStart, contractEnd, date)
    const covered = isCovered(coverage, line.vendorItemNo, date)

    if (covered && inWindow) {
      return {
        poNumber: line.purchaseOrder.poNumber,
        date,
        amount,
      }
    }
    // Not covered — classify the exclusion reason.
    if (!inWindow) {
      return {
        poNumber: line.purchaseOrder.poNumber,
        date,
        amount,
        exclusionReason: "Purchase outside contract date window",
        exclusionCategory: "out_of_scope",
      }
    }
    return {
      poNumber: line.purchaseOrder.poNumber,
      date,
      amount,
      exclusionReason: "Item not on contract pricing list",
      // Canonical category name in the pure helper. Spec §4.0 calls this
      // "off_contract_item"; the helper's enum uses the shorter
      // "off_contract" alias.
      exclusionCategory: "off_contract" as const,
    }
  })
}

/** Numeric-ish field that may arrive as Prisma Decimal / number / string. */
type NumericLike = { toString(): string } | number | string | null | undefined

/** Minimal ContractTier shape the audit core reads. */
export interface TierForAudit {
  tierName: string | null
  tierNumber: number
  spendMin: NumericLike
  spendMax: NumericLike
  rebateValue: NumericLike
  rebateType: string | null
}

/** Minimal Contract shape (the audit `include` result) the core reads. */
export interface ContractForAudit {
  id: string
  name: string
  contractType: string
  effectiveDate: Date
  expirationDate: Date
  vendor: { name: string }
  terms: Array<{ tiers: TierForAudit[] }>
  pricingItems: PricingItemForCoverage[]
}

/**
 * Pure core for the rebate calculation audit. Given the already-loaded
 * (and explicitly tenant-scoped) contract + its PO lines, build the
 * byte-identical `RebateCalcAudit` both the facility and vendor actions
 * return. The action layer owns ONLY the gate + scoped fetch; all
 * shaping/math lives here so the two surfaces can never drift.
 */
export function buildRebateCalcAudit(
  contract: ContractForAudit,
  poLines: PoLineForAudit[],
): RebateCalcAudit {
  // ─── Contract metadata ────────────────────────────────────────
  const auditContract: AuditContractInfo = {
    id: contract.id,
    name: contract.name,
    vendor: contract.vendor.name,
    type: contract.contractType,
    effectiveDate: contract.effectiveDate,
    expirationDate: contract.expirationDate,
  }

  // ─── Tiers (from the first / primary term) ────────────────────
  const primaryTerm = contract.terms[0]
  const tierRows = primaryTerm?.tiers ?? []
  const auditTiers: AuditTier[] = tierRows.map((t, i) => ({
    name: t.tierName?.trim() || `Tier ${t.tierNumber ?? i + 1}`,
    minSpend: Number(t.spendMin ?? 0),
    maxSpend:
      t.spendMax === null || t.spendMax === undefined
        ? null
        : Number(t.spendMax),
    // Charles 2026-04-25: scale fraction → percent at the boundary so the
    // audit's `(spend × rate) / 100` math (and the downstream
    // tier-progress projection that consumes these values) gets percent
    // semantics, not raw fraction. Without this the audit reports
    // gross rebate 100x too small.
    rebateRate: toDisplayRebateValue(
      String(t.rebateType ?? "percent_of_spend"),
      Number(t.rebateValue ?? 0),
    ),
  }))

  // ─── Contract pricing coverage map ────────────────────────────
  const coverage = buildCoverageMap(contract.pricingItems)
  const contractStart = contract.effectiveDate
  const contractEnd = contract.expirationDate

  // ─── PO lines → audit purchases ───────────────────────────────
  const purchases = buildAuditPurchases(
    poLines,
    coverage,
    contractStart,
    contractEnd,
  )

  // ─── Current tier — look up by eligible spend ─────────────────
  const eligibleSpend = purchases.reduce(
    (s, p) => (p.exclusionReason ? s : s + p.amount),
    0,
  )
  let currentTierName = auditTiers[0]?.name ?? "Tier 1"
  if (tierRows.length > 0) {
    const { tierAchieved } = applyTiers(
      eligibleSpend,
      tierRows.map((t) => ({
        tierNumber: t.tierNumber,
        spendMin: t.spendMin as number,
        spendMax: t.spendMax as number,
        rebateValue: t.rebateValue as number,
      })),
    )
    // `applyTiers` returns 1-based tierNumber. Map to our audit tier names.
    const matchTier =
      tierRows.find((t) => t.tierNumber === tierAchieved) ??
      tierRows[tierAchieved - 1]
    if (matchTier) {
      const idx = tierRows.indexOf(matchTier)
      currentTierName =
        matchTier.tierName?.trim() ||
        `Tier ${matchTier.tierNumber ?? idx + 1}`
    }
  }

  return buildRebateCalculationAudit({
    contract: auditContract,
    tiers: auditTiers,
    currentTierName,
    purchases,
  })
}
