/**
 * Alert synthesis + persistence core (subsystem-4 pipeline, extracted
 * 2026-06-09 renewals+alerts audit H4).
 *
 * Loads the synthesizer inputs for ONE facility, applies the pure rules
 * engine (`synthesizeAlertsForFacility`), and persists the delta
 * (create new / resolve stale) atomically.
 *
 * Lives outside `lib/actions/` (NOT a "use server" file) so it can be
 * invoked from three trust contexts without exposing a facilityId-taking
 * server action to the client RPC surface:
 *   1. The facility server action `synthesizeAndPersistAlerts()`
 *      (lib/actions/alerts.ts) — session-scoped, audit-logged.
 *   2. The COG import pipeline (lib/actions/cog-import.ts) — fired
 *      fire-and-forget after recompute, same pattern as
 *      refreshContractMetricsForVendor.
 *   3. The cron sweep (app/api/cron/synthesize-alerts/route.ts) —
 *      CRON_SECRET-gated, runs every facility.
 */

import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import { logAudit } from "@/lib/audit"
import {
  synthesizeAlertsForFacility,
  type SynthBundle,
  type SynthCogRecord,
  type SynthContract,
  type SynthContractPeriod,
  type SynthExistingAlert,
  type SynthTier,
} from "@/lib/alerts/synthesizer"
import { resolveExpiringWindowDays } from "@/lib/alerts/expiring-window"
import { computeBundleStatus } from "@/lib/contracts/bundle-compute"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"
import { deriveBundleShortfalls } from "@/lib/contracts/bundle-shortfalls"
import { hasSpendDollarTierLadder } from "@/lib/contracts/tier-metric"

export interface SynthesizePersistResult {
  created: number
  resolved: number
}

/**
 * Synthesize fresh alerts from live contract + COG + accrual state for
 * `facilityId`, persist new alerts, and resolve any alerts whose
 * underlying condition has cleared.
 *
 * @param opts.auditUserId — when present (session contexts), an audit
 *   row is written. System contexts (cron) omit it: `AuditLog.userId`
 *   is a required user reference, so there's no honest value to write.
 */
export async function runAlertSynthesisForFacility(
  facilityId: string,
  opts?: { auditUserId?: string },
): Promise<SynthesizePersistResult> {
  // Load the minimal columns each input shape needs.
  const [
    cogRows,
    contractRows,
    periodRows,
    existingRows,
    bundleRows,
    alertSettingsRows,
  ] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: { facilityId },
      select: {
        id: true,
        poNumber: true,
        vendorId: true,
        vendorName: true,
        inventoryNumber: true,
        inventoryDescription: true,
        unitCost: true,
        quantity: true,
        extendedPrice: true,
        contractPrice: true,
        matchStatus: true,
        transactionDate: true,
      },
    }),
    prisma.contract.findMany({
      where: { facilityId },
      select: {
        id: true,
        name: true,
        status: true,
        expirationDate: true,
        annualValue: true,
        vendorId: true,
        vendor: { select: { name: true } },
        terms: {
          select: {
            termType: true,
            tiers: {
              select: {
                tierNumber: true,
                spendMin: true,
                spendMax: true,
                rebateValue: true,
                rebateType: true,
              },
            },
          },
        },
        periods: {
          orderBy: { periodEnd: "desc" },
          take: 1,
          select: { totalSpend: true },
        },
      },
    }),
    prisma.contractPeriod.findMany({
      where: { facilityId },
      select: {
        id: true,
        contractId: true,
        periodStart: true,
        periodEnd: true,
        rebateEarned: true,
        rebateCollected: true,
        contract: {
          select: {
            name: true,
            vendorId: true,
            vendor: { select: { name: true } },
          },
        },
      },
    }),
    prisma.alert.findMany({
      where: {
        facilityId,
        status: { in: ["new_alert", "read"] },
      },
      select: {
        id: true,
        alertType: true,
        contractId: true,
        vendorId: true,
        metadata: true,
        status: true,
      },
    }),
    prisma.tieInBundle.findMany({
      where: {
        primaryContract: {
          OR: [
            { facilityId },
            { contractFacilities: { some: { facilityId } } },
          ],
        },
      },
      include: {
        primaryContract: {
          select: { id: true, name: true },
        },
        members: {
          include: {
            contract: { select: { id: true, name: true } },
          },
        },
      },
    }),
    // RenewalAlertSettings is user-scoped; synthesis is facility-scoped.
    // Load every facility-org member's settings row and fold them into
    // one effective expiring_contract window (see
    // lib/alerts/expiring-window.ts for the union semantics).
    prisma.renewalAlertSettings.findMany({
      where: {
        user: {
          members: {
            some: { organization: { facility: { id: facilityId } } },
          },
        },
      },
      select: {
        expirationAlertDays: true,
        renewalReminderDaysBefore: true,
      },
    }),
  ])

  const cogRecords: SynthCogRecord[] = cogRows.map((r) => ({
    id: r.id,
    poNumber: r.poNumber,
    vendorId: r.vendorId,
    vendorName: r.vendorName,
    inventoryNumber: r.inventoryNumber,
    inventoryDescription: r.inventoryDescription,
    unitCost: Number(r.unitCost),
    quantity: r.quantity,
    extendedPrice: r.extendedPrice === null ? null : Number(r.extendedPrice),
    contractPrice: r.contractPrice === null ? null : Number(r.contractPrice),
    matchStatus: r.matchStatus,
    transactionDate: r.transactionDate,
  }))

  const contracts: SynthContract[] = contractRows.map((c) => {
    // Audit M7: the synthesizer consumes ONE tier ladder per contract
    // (SynthContract.tiers), and that ladder is compared against
    // CURRENT SPEND (dollars). Flat-mapping every term's tiers mixed
    // term types (market_share % thresholds, volume counts, carve-out
    // placeholder tiers) into one bogus dollar ladder. Gate with the
    // canonical `hasSpendDollarTierLadder` (CLAUDE.md invariants table)
    // and pick the FIRST qualifying term — contracts with multiple
    // spend-dollar ladders are rare, and a single coherent ladder beats
    // a merged incoherent one.
    const ladderTerm = c.terms.find((t) => hasSpendDollarTierLadder(t))
    const tiers: SynthTier[] = ladderTerm
      ? ladderTerm.tiers.map((tier) => ({
          tierNumber: tier.tierNumber,
          spendMin: Number(tier.spendMin),
          spendMax: tier.spendMax === null ? null : Number(tier.spendMax),
          // Charles 2026-04-25: scale at the boundary so alert payloads
          // carry display-percent (3 = 3%), not raw fraction (0.03). The
          // synthesizer ships `tier_rebate` in alert metadata that's
          // rendered directly as "X%" in the UI.
          rebateValue: toDisplayRebateValue(
            String(tier.rebateType ?? "percent_of_spend"),
            Number(tier.rebateValue),
          ),
          // Audit M8: rendering hint for the alert detail UI (% vs $).
          rebateType: String(tier.rebateType ?? "percent_of_spend"),
        }))
      : []
    const currentSpend =
      c.periods.length > 0 ? Number(c.periods[0].totalSpend) : 0
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      expirationDate: c.expirationDate,
      annualValue: Number(c.annualValue),
      vendorId: c.vendorId,
      vendorName: c.vendor?.name ?? "Unknown vendor",
      currentSpend,
      tiers,
    }
  })

  const contractPeriods: SynthContractPeriod[] = periodRows.map((p) => ({
    id: p.id,
    contractId: p.contractId,
    contractName: p.contract?.name ?? "Unknown contract",
    vendorId: p.contract?.vendorId ?? "",
    vendorName: p.contract?.vendor?.name ?? "Unknown vendor",
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    rebateEarned: Number(p.rebateEarned),
    rebateCollected: Number(p.rebateCollected),
  }))

  const existingAlerts: SynthExistingAlert[] = existingRows.map((a) => ({
    id: a.id,
    alertType: a.alertType,
    contractId: a.contractId,
    vendorId: a.vendorId,
    metadata: (a.metadata ?? {}) as Record<string, unknown>,
    status: a.status,
  }))

  // Resolve each bundle's shortfall summary via the canonical reducer
  // — same code path the dashboard shortfall card uses, so
  // tie_in_at_risk alerts and the card can never disagree on who's
  // below minimum.
  //
  // Short-circuit: skip the compute call for bundles whose members
  // have no minimum spend configured. The at-risk rule requires a
  // non-zero minimum to fire, so computing their status would be
  // wasted work — this scales linearly with bundle count and used to
  // be the slowest part of alert generation on facilities with 50+
  // bundles.
  const bundles: SynthBundle[] = []
  for (const b of bundleRows) {
    const anyMinimum = b.members.some(
      (m) => m.minimumSpend != null && Number(m.minimumSpend) > 0,
    )
    if (!anyMinimum) continue
    const status = await computeBundleStatus(prisma, b.id, facilityId)
    if (!status) continue
    const result = deriveBundleShortfalls({
      bundleId: b.id,
      bundleLabel: b.primaryContract.name,
      members: b.members.map((m) => ({
        contractId: m.contractId,
        vendorId: m.vendorId,
        minimumSpend: m.minimumSpend == null ? null : Number(m.minimumSpend),
        contractName: m.contract?.name ?? null,
        vendorName: null,
      })),
      status,
    })
    bundles.push({
      bundleId: b.id,
      bundleLabel: b.primaryContract.name,
      primaryContractId: b.primaryContractId,
      complianceMode: b.complianceMode,
      members: result.members.map((m) => ({
        entityId: m.entityId,
        entityName: m.entityName,
        currentSpend: m.currentSpend,
        minimumSpend: m.minimumSpend,
      })),
    })
  }

  const result = synthesizeAlertsForFacility({
    facilityId,
    cogRecords,
    contracts,
    contractPeriods,
    paymentSchedules: [],
    bundles,
    existingAlerts,
    expiringWindowDays: resolveExpiringWindowDays(alertSettingsRows),
  })

  const now = new Date()

  if (result.toCreate.length > 0 || result.toResolve.length > 0) {
    await prisma.$transaction([
      ...result.toCreate.map((a) =>
        prisma.alert.create({
          data: {
            portalType: a.portalType,
            alertType: a.alertType,
            title: a.title,
            description: a.description,
            severity: a.severity,
            facilityId: a.facilityId,
            contractId: a.contractId ?? null,
            vendorId: a.vendorId ?? null,
            actionLink: a.actionLink ?? null,
            metadata: a.metadata as Prisma.InputJsonValue,
          },
        }),
      ),
      ...result.toResolve.map((id) =>
        prisma.alert.update({
          // Resolve targets come from the existing-alert load above,
          // which is already scoped to this facility.
          where: { id },
          data: { status: "resolved", resolvedAt: now },
        }),
      ),
    ])
  }

  if (opts?.auditUserId) {
    await logAudit({
      userId: opts.auditUserId,
      action: "alerts.synthesized",
      entityType: "alert",
      metadata: {
        created: result.toCreate.length,
        resolved: result.toResolve.length,
      },
    })
  }

  return {
    created: result.toCreate.length,
    resolved: result.toResolve.length,
  }
}
