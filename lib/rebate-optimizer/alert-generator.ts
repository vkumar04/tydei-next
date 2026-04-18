/**
 * Rebate Optimizer — alert generator.
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-optimizer-rewrite.md
 *
 * PURE function. Produces human-readable `RebateAlert` text for surfaces
 * like the dashboard and alerts page when a contract is close to, or past,
 * a tier threshold. This is distinct from the opportunity-detection engine
 * in `./engine.ts` — that engine ranks opportunities by ROI, whereas this
 * module narrates *alerts* for end-users ("you're close", "you're missing
 * out", etc.).
 *
 * Callers pre-shape each contract into `ContractForAlert` — this module
 * does not touch Prisma, vendors, or tier ladders directly. All inputs are
 * plain numbers plus the labels we want rendered.
 *
 * Alert rules (see spec):
 *   - `at_tier_threshold`        → high severity — `pctToGo <= 5` AND
 *                                  `monthsToReach <= 3`.
 *   - `approaching_next_tier`    → medium severity — `pctToGo <= 20` AND
 *                                  NOT already in the at-threshold bucket
 *                                  (the buckets are mutually exclusive).
 *   - `missed_tier_opportunity`  → high severity — contract expiring within
 *                                  90 days AND current velocity can't reach
 *                                  the next tier before expiration.
 *   - `tier_achieved`            → NOT implemented in this pass. Emitting
 *                                  this alert requires historical context
 *                                  (did they cross the threshold this
 *                                  period?) that only the caller has. TODO:
 *                                  add a `recentlyCrossedTierName` hint on
 *                                  `ContractForAlert` and surface it here.
 *
 * A single contract can emit multiple alerts — e.g. `approaching_next_tier`
 * + `missed_tier_opportunity` when they're close but running out of runway.
 * The returned array is sorted by severity descending (high → medium →
 * low), with contract name as the tiebreaker for deterministic output.
 */

import { formatCurrency } from "@/lib/formatting"

// ─── Public types ─────────────────────────────────────────────────

export type RebateAlertKind =
  | "approaching_next_tier"
  | "at_tier_threshold"
  | "missed_tier_opportunity"
  | "tier_achieved"

export interface ContractForAlert {
  id: string
  name: string
  vendorName: string
  currentSpend: number
  currentTierName: string | null
  nextTierName: string | null
  nextTierThreshold: number | null
  additionalRebateIfReached: number | null
  daysUntilExpiration: number
  monthlySpendRate: number
}

export interface RebateAlert {
  kind: RebateAlertKind
  contractId: string
  contractName: string
  title: string
  message: string
  severity: "low" | "medium" | "high"
  /** Dollar amount referenced in the alert (e.g. potential rebate). */
  valueReference: number | null
}

// ─── Internal helpers ─────────────────────────────────────────────

const SEVERITY_RANK: Record<RebateAlert["severity"], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

// ─── Public entrypoint ────────────────────────────────────────────

/**
 * Generate human-readable tier-proximity + missed-opportunity alerts for
 * the given contracts. Returns a flat array sorted by severity desc,
 * contract name asc.
 */
export function generateRebateAlerts(
  contracts: ContractForAlert[],
): RebateAlert[] {
  const alerts: RebateAlert[] = []

  for (const contract of contracts) {
    // No next tier → already at top tier → no alert.
    if (
      contract.nextTierThreshold === null ||
      contract.nextTierName === null
    ) {
      continue
    }

    const spendToGo = contract.nextTierThreshold - contract.currentSpend

    // Already across the threshold (e.g. staged data, rounding) — the
    // optimizer flags this as "at max" or no-op; nothing for this module
    // to narrate.
    if (spendToGo <= 0) continue

    const pctToGo = (spendToGo / contract.nextTierThreshold) * 100
    const monthsToReach =
      contract.monthlySpendRate > 0
        ? spendToGo / contract.monthlySpendRate
        : Number.POSITIVE_INFINITY

    const additionalRebate = contract.additionalRebateIfReached ?? 0

    // ── at_tier_threshold (mutually exclusive with approaching) ──────
    const isAtThreshold = pctToGo <= 5 && monthsToReach <= 3
    if (isAtThreshold) {
      alerts.push({
        kind: "at_tier_threshold",
        contractId: contract.id,
        contractName: contract.name,
        title: `${contract.name} is at the ${contract.nextTierName} threshold`,
        message: `Spend ${formatCurrency(spendToGo)} more to earn ${formatCurrency(additionalRebate)} additional rebate`,
        severity: "high",
        valueReference: additionalRebate,
      })
    } else if (pctToGo <= 20) {
      // ── approaching_next_tier ─────────────────────────────────────
      alerts.push({
        kind: "approaching_next_tier",
        contractId: contract.id,
        contractName: contract.name,
        title: `${contract.name} approaching ${contract.nextTierName} tier`,
        message: `Spend ${formatCurrency(spendToGo)} more to earn ${formatCurrency(additionalRebate)} additional rebate`,
        severity: "medium",
        valueReference: additionalRebate,
      })
    }

    // ── missed_tier_opportunity ──────────────────────────────────────
    // Contract expiring within 90 days AND velocity insufficient to reach
    // the next tier before expiration. A contract can emit this alongside
    // approaching / at-threshold — they describe different things (how
    // close vs. whether runway remains).
    const expiringSoon =
      contract.daysUntilExpiration <= 90 && contract.daysUntilExpiration >= 0
    const monthsRemaining = contract.daysUntilExpiration / 30
    const cantReachInTime = monthsToReach > monthsRemaining
    if (expiringSoon && cantReachInTime) {
      alerts.push({
        kind: "missed_tier_opportunity",
        contractId: contract.id,
        contractName: contract.name,
        title: `${contract.name} won't reach ${contract.nextTierName} before expiration`,
        message: `Leaving ${formatCurrency(additionalRebate)} rebate on the table — consider renewal or bulk order`,
        severity: "high",
        valueReference: additionalRebate,
      })
    }
  }

  alerts.sort((a, b) => {
    const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    if (severityDelta !== 0) return severityDelta
    return a.contractName.localeCompare(b.contractName)
  })

  return alerts
}
