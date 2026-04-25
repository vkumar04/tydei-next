"use server"

/**
 * Reports hub — Calculation audit trail data action.
 *
 * Assembles the full "how was this rebate computed" payload for the
 * Calculations tab. The math + grouping live in a pure helper
 * (`lib/reports/audit-trail.ts`); this file loads the Prisma rows,
 * partitions POs into included vs excluded based on contract pricing
 * coverage + contract date window, derives the current tier name, and
 * hands the shaped input to the builder.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.0
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import { applyTiers } from "@/lib/rebates/calculate"
import {
  buildRebateCalculationAudit,
  type AuditContractInfo,
  type AuditTier,
  type AuditPurchase,
  type RebateCalcAudit,
} from "@/lib/reports/audit-trail"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"

/**
 * Return the full audit trail for a single contract, scoped to the
 * caller's active facility.
 *
 * Ownership is enforced by `contractOwnershipWhere` — a facility that
 * doesn't own (and isn't shared on) this contract will hit a NotFound.
 */
export async function getRebateCalculationAudit(
  contractId: string,
): Promise<RebateCalcAudit> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    include: {
      vendor: { select: { id: true, name: true } },
      terms: {
        orderBy: { effectiveStart: "asc" },
        include: {
          tiers: { orderBy: { tierNumber: "asc" } },
        },
      },
      pricingItems: {
        select: {
          vendorItemNo: true,
          effectiveDate: true,
          expirationDate: true,
        },
      },
    },
  })

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
    maxSpend: t.spendMax === null || t.spendMax === undefined
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
  // A purchase line is "on contract" iff its vendorItemNo matches a
  // pricing row on this contract AND the transaction date falls in the
  // pricing row's effective window (date bounds are optional).
  type CoverageEntry = {
    effectiveDate: Date | null
    expirationDate: Date | null
  }
  const coverage = new Map<string, CoverageEntry[]>()
  for (const p of contract.pricingItems) {
    if (!p.vendorItemNo) continue
    const entry: CoverageEntry = {
      effectiveDate: p.effectiveDate ?? null,
      expirationDate: p.expirationDate ?? null,
    }
    const existing = coverage.get(p.vendorItemNo)
    if (existing) existing.push(entry)
    else coverage.set(p.vendorItemNo, [entry])
  }

  const contractStart = contract.effectiveDate
  const contractEnd = contract.expirationDate

  function isCovered(vendorItemNo: string | null, date: Date): boolean {
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

  function inContractWindow(date: Date): boolean {
    const ms = date.getTime()
    if (contractStart && contractStart.getTime() > ms) return false
    if (contractEnd && contractEnd.getTime() < ms) return false
    return true
  }

  // ─── PO lines for this vendor + facility ──────────────────────
  const poLines = await prisma.pOLineItem.findMany({
    where: {
      purchaseOrder: {
        facilityId: facility.id,
        vendorId: contract.vendorId,
      },
    },
    include: {
      purchaseOrder: {
        select: { poNumber: true, orderDate: true },
      },
    },
  })

  const purchases: AuditPurchase[] = poLines.map((line) => {
    const amount = Number(line.extendedPrice ?? 0)
    const date = line.purchaseOrder.orderDate
    const inWindow = inContractWindow(date)
    const covered = isCovered(line.vendorItemNo, date)

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

  // ─── Current tier — look up by eligible spend ─────────────────
  const eligibleSpend = purchases.reduce(
    (s, p) => (p.exclusionReason ? s : s + p.amount),
    0,
  )
  let currentTierName = auditTiers[0]?.name ?? "Tier 1"
  if (tierRows.length > 0) {
    const { tierAchieved } = applyTiers(eligibleSpend, tierRows.map((t) => ({
      tierNumber: t.tierNumber,
      spendMin: t.spendMin,
      spendMax: t.spendMax,
      rebateValue: t.rebateValue,
    })))
    // `applyTiers` returns 1-based tierNumber. Map to our audit tier names.
    const matchTier = tierRows.find((t) => t.tierNumber === tierAchieved)
      ?? tierRows[tierAchieved - 1]
    if (matchTier) {
      const idx = tierRows.indexOf(matchTier)
      currentTierName =
        matchTier.tierName?.trim() ||
        `Tier ${matchTier.tierNumber ?? idx + 1}`
    }
  }

  const audit = buildRebateCalculationAudit({
    contract: auditContract,
    tiers: auditTiers,
    currentTierName,
    purchases,
  })

  return serialize(audit)
}
