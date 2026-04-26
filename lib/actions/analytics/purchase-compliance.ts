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

export interface ComplianceReport {
  totalPurchases: number
  compliantPurchases: number
  complianceRatePct: number
  criticalCount: number
  warningCount: number
  byType: Record<string, number>
  audits: PurchaseAudit[]
}

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

  // Pull COG in window.
  const cog = await prisma.cOGRecord.findMany({
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
    take: input.limit ?? 500,
    orderBy: { transactionDate: "desc" },
  })

  const audits: PurchaseAudit[] = []
  let compliantCount = 0
  let criticalCount = 0
  let warningCount = 0
  const byType: Record<string, number> = {}

  for (const r of cog) {
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
                : v.band === "minor_overcharge" ||
                    v.band === "minor_discount"
                  ? "WARNING"
                  : "ACCEPTABLE"
            if (severity !== "ACCEPTABLE") {
              const direction =
                v.band.includes("overcharge") ? "overcharge" : "discount"
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

    const isCompliant = violations.every((v) => v.severity !== "CRITICAL")
    if (isCompliant) compliantCount += 1
    for (const v of violations) {
      if (v.severity === "CRITICAL") criticalCount += 1
      if (v.severity === "WARNING") warningCount += 1
      byType[v.type] = (byType[v.type] ?? 0) + 1
    }

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

  return serialize({
    totalPurchases: cog.length,
    compliantPurchases: compliantCount,
    complianceRatePct:
      cog.length > 0
        ? Math.round((compliantCount / cog.length) * 1000) / 10
        : 100,
    criticalCount,
    warningCount,
    byType,
    audits,
  })
}
