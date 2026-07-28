"use server"

/**
 * Charles audit suggestion (v0-port): per-purchase compliance audit.
 * Walks COG records in a date range and emits a violations list per
 * purchase per the 5-check audit defined in v0 doc §5.
 *
 * Checks:
 *   1. Vendor is on contract (active, in-period)
 *   2. Purchase date in contract period
 *   3. Item on contract (ContractPricing.vendorItemNo lookup)
 *   4. Price variance vs contract price (band per v0CogPriceVarianceBand)
 *   5. Quantity ≤ contract max (when set; tydei doesn't carry this yet)
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import { v0CogPriceVarianceBand } from "@/lib/v0-spec/cog"
import { withTelemetry } from "@/lib/actions/analytics/_telemetry"

export interface ComplianceViolation {
  type:
    | "OFF_CONTRACT_VENDOR"
    | "OUT_OF_PERIOD"
    | "UNAPPROVED_ITEM"
    | "PRICE_VARIANCE"
  severity: "ACCEPTABLE" | "WARNING" | "CRITICAL"
  message: string
  details?: Record<string, unknown>
}

export interface PurchaseAudit {
  cogId: string
  vendorId: string | null
  vendorName: string | null
  vendorItemNo: string | null
  transactionDate: string
  unitCost: number
  quantity: number
  isCompliant: boolean
  violations: ComplianceViolation[]
}

/**
 * ─── Scope contract (READ THIS BEFORE CHANGING ANY FIELD BELOW) ───
 *
 * `totalPurchases` / `compliantPurchases` / `complianceRatePct` /
 * `criticalCount` / `warningCount` / `byType` are computed over EVERY COG
 * row in the facility+window — never over the returned `audits` array.
 * `audits` is a display SAMPLE (most recent first, capped at
 * `auditSampleLimit`); `auditSampleTruncated` says so out loud.
 *
 * This split exists because the card used to read
 * "<compliant> of 500 purchases" and a rate of `compliant / 500` for any
 * facility+range with more than 500 rows — an arbitrary recency-ordered
 * sample presented as the facility's audit, with the Critical/Warning
 * counts flat-lining at the cap. Never derive a headline number from
 * `audits.length`.
 *
 * Disclosing the cap is HALF the fix — every consumer must render
 * `auditSampleTruncated` / `auditSampleLimit` / `scanTruncated`, and must
 * not re-slice `audits` on top of them without saying so. A cap nobody
 * displays is the same silent truncation, one layer down. See
 * `buildAuditSampleNotice` in
 * `components/facility/reports/compliance-report-client.tsx`.
 *
 * One more scope trap for consumers: when `scanTruncated` is true,
 * `totalPurchases` is NOT the window's row count — it is the scanned
 * prefix. Any copy that reads "<totalPurchases> purchases in this
 * window" has to change wording in that branch, or the page swaps one
 * silent truncation for a mislabelled one.
 */
export interface ComplianceReport {
  totalPurchases: number
  compliantPurchases: number
  complianceRatePct: number
  criticalCount: number
  warningCount: number
  byType: Record<string, number>
  /** Display sample only — see the scope contract above. */
  audits: PurchaseAudit[]
  /** Max rows `audits` may carry (the `limit` input, clamped). */
  auditSampleLimit: number
  /** True when the window holds more purchases than `audits` shows. */
  auditSampleTruncated: boolean
  /**
   * Runaway guard tripped: the window held more than SCAN_ROW_CEILING
   * rows and the totals above cover only the first SCAN_ROW_CEILING.
   * Expected to be false; surfaced (rather than silent) so a facility
   * that ever hits it can be told its audit is partial.
   */
  scanTruncated: boolean
}

/**
 * Rows pulled per round trip while walking the window. Only the counters
 * and the (capped) audit sample survive each chunk, so peak memory is
 * bounded by SCAN_CHUNK + auditSampleLimit rows regardless of window size.
 */
const SCAN_CHUNK = 2_000

/**
 * Runaway guard, NOT a scope cap: cursor pagination over a real table
 * always terminates well before this. It exists so a pathological loop
 * can't pin a server worker, and when it trips the report says so via
 * `scanTruncated` instead of quietly shrinking the denominator.
 */
const SCAN_ROW_CEILING = 200_000

/** Default cap on the returned audit-row sample (not on the math). */
const DEFAULT_AUDIT_SAMPLE = 500
const MAX_AUDIT_SAMPLE = 5_000

export async function evaluatePurchaseCompliance(input: {
  fromDate: string // YYYY-MM-DD
  toDate: string
  limit?: number
}): Promise<ComplianceReport> {
  return withTelemetry(
    "evaluatePurchaseCompliance",
    { fromDate: input.fromDate, toDate: input.toDate },
    () => _evaluatePurchaseComplianceImpl(input),
  )
}

async function _evaluatePurchaseComplianceImpl(input: {
  fromDate: string
  toDate: string
  limit?: number
}): Promise<ComplianceReport> {
  const { facility } = await requireFacility()

  const from = new Date(input.fromDate)
  const to = new Date(input.toDate)

  // Pull active contracts + their pricing in scope.
  const contracts = await prisma.contract.findMany({
    where: {
      ...contractsOwnedByFacility(facility.id),
      status: "active",
    },
    select: {
      id: true,
      vendorId: true,
      effectiveDate: true,
      expirationDate: true,
      pricingItems: {
        select: { vendorItemNo: true, unitPrice: true },
      },
    },
  })
  const contractsByVendor = new Map<string, typeof contracts>()
  for (const c of contracts) {
    const arr = contractsByVendor.get(c.vendorId) ?? []
    arr.push(c)
    contractsByVendor.set(c.vendorId, arr)
  }

  // `limit` is client-supplied, so a non-finite value has to be replaced
  // rather than clamped — `Math.min(MAX, NaN)` is NaN, which would leave
  // `auditSampleLimit: NaN` in the payload and render "NaN" inside the
  // truncation notice that now reads this field.
  const requestedLimit =
    typeof input.limit === "number" && Number.isFinite(input.limit)
      ? input.limit
      : DEFAULT_AUDIT_SAMPLE
  const auditSampleLimit = Math.max(
    0,
    Math.min(MAX_AUDIT_SAMPLE, Math.trunc(requestedLimit)),
  )

  const audits: PurchaseAudit[] = []
  let totalPurchases = 0
  let compliantCount = 0
  let criticalCount = 0
  let warningCount = 0
  let scanTruncated = false
  const byType: Record<string, number> = {}

  // Walk EVERY COG row in the window via keyset pagination. The audit
  // sample stops filling at `auditSampleLimit`; the counters above do
  // not — the compliance rate's denominator is the whole window, which
  // is the only denominator the "Compliance Rate" card can honestly use.
  let cursorId: string | undefined
  for (;;) {
    const chunk = await prisma.cOGRecord.findMany({
      where: {
        facilityId: facility.id,
        transactionDate: { gte: from, lte: to },
      },
      select: {
        id: true,
        vendorId: true,
        vendorName: true,
        vendorItemNo: true,
        unitCost: true,
        quantity: true,
        transactionDate: true,
      },
      // `id` breaks ties so the cursor is stable across chunks (many COG
      // rows share a transactionDate — a date-only column). Verified
      // against the seeded facility 2026-07-28: paging this window in
      // chunks returns each row exactly once and totals to `count()`.
      orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
      take: SCAN_CHUNK,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    })
    if (chunk.length === 0) break

    for (const r of chunk) {
      totalPurchases += 1
      const { violations, isCompliant } = auditPurchase(r, contractsByVendor)

      if (isCompliant) compliantCount += 1
      for (const v of violations) {
        if (v.severity === "CRITICAL") criticalCount += 1
        if (v.severity === "WARNING") warningCount += 1
        byType[v.type] = (byType[v.type] ?? 0) + 1
      }

      if (audits.length < auditSampleLimit) {
        audits.push({
          cogId: r.id,
          vendorId: r.vendorId,
          vendorName: r.vendorName,
          vendorItemNo: r.vendorItemNo,
          transactionDate: r.transactionDate.toISOString(),
          unitCost: Number(r.unitCost),
          quantity: r.quantity,
          isCompliant,
          violations,
        })
      }
    }

    if (chunk.length < SCAN_CHUNK) break
    if (totalPurchases >= SCAN_ROW_CEILING) {
      scanTruncated = true
      console.error("[evaluatePurchaseCompliance] scan ceiling hit", {
        facilityId: facility.id,
        fromDate: input.fromDate,
        toDate: input.toDate,
        scanned: totalPurchases,
      })
      break
    }
    cursorId = chunk[chunk.length - 1].id
  }

  return serialize({
    totalPurchases,
    compliantPurchases: compliantCount,
    complianceRatePct:
      totalPurchases > 0
        ? Math.round((compliantCount / totalPurchases) * 1000) / 10
        : 100,
    criticalCount,
    warningCount,
    byType,
    audits,
    auditSampleLimit,
    auditSampleTruncated: totalPurchases > audits.length,
    scanTruncated,
  })
}

type ContractsByVendor = Map<
  string,
  Array<{
    effectiveDate: Date
    expirationDate: Date
    pricingItems: Array<{ vendorItemNo: string | null; unitPrice: unknown }>
  }>
>

type CogRowForAudit = {
  vendorId: string | null
  vendorItemNo: string | null
  unitCost: unknown
  transactionDate: Date
}

/** The 5-check audit for ONE purchase. Pure — no I/O, no counters. */
function auditPurchase(
  r: CogRowForAudit,
  contractsByVendor: ContractsByVendor,
): { violations: ComplianceViolation[]; isCompliant: boolean } {
  const violations: ComplianceViolation[] = []

  const vid = r.vendorId
  const vendorContracts = vid ? contractsByVendor.get(vid) ?? [] : []
  const inPeriod = vendorContracts.filter(
    (c) =>
      new Date(c.effectiveDate) <= r.transactionDate &&
      new Date(c.expirationDate) >= r.transactionDate,
  )

  // 1. Off-contract vendor
  if (vendorContracts.length === 0) {
    violations.push({
      type: "OFF_CONTRACT_VENDOR",
      severity: "CRITICAL",
      message: "Purchase from a vendor with no active contract",
    })
  } else if (inPeriod.length === 0) {
    // 2. Out of period
    violations.push({
      type: "OUT_OF_PERIOD",
      severity: "CRITICAL",
      message: "Purchase date outside contract period",
    })
  } else {
    // 3. Unapproved item — vendor is on contract but item isn't.
    const itemNo = r.vendorItemNo
    const onContract = inPeriod.some((c) =>
      c.pricingItems.some((p) => p.vendorItemNo === itemNo),
    )
    if (!onContract && itemNo) {
      violations.push({
        type: "UNAPPROVED_ITEM",
        severity: "WARNING",
        message: `Item ${itemNo} not listed on the contract`,
      })
    }
    // 4. Price variance
    if (itemNo) {
      for (const c of inPeriod) {
        const matched = c.pricingItems.find((p) => p.vendorItemNo === itemNo)
        if (matched) {
          const v = v0CogPriceVarianceBand(
            Number(r.unitCost),
            Number(matched.unitPrice),
          )
          const severity: ComplianceViolation["severity"] =
            v.band === "significant_overcharge" ||
            v.band === "significant_discount"
              ? "CRITICAL"
              : v.band === "minor_overcharge" || v.band === "minor_discount"
                ? "WARNING"
                : "ACCEPTABLE"
          if (severity !== "ACCEPTABLE") {
            const direction = v.band.includes("overcharge")
              ? "overcharge"
              : "discount"
            violations.push({
              type: "PRICE_VARIANCE",
              severity,
              message: `Price variance ${v.variancePct.toFixed(1)}% (${direction})`,
              details: {
                contractPrice: Number(matched.unitPrice),
                actualPrice: Number(r.unitCost),
                variancePct: v.variancePct,
                band: v.band,
              },
            })
          }
          break
        }
      }
    }
  }

  return {
    violations,
    isCompliant: violations.every((v) => v.severity !== "CRITICAL"),
  }
}
