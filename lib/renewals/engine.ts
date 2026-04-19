/**
 * Shared calculation engine for contract renewals.
 *
 * Pure functions only — no Prisma imports, no I/O, no synthesis of unknown
 * data. Consumers (server actions, components) feed it real data loaded
 * elsewhere.
 *
 * Spec: docs/superpowers/specs/2026-04-18-renewals-rewrite.md §§4, 13, 14, 15.
 */

/** Renewal status classification (spec §4). */
export type RenewalStatus = "critical" | "warning" | "upcoming" | "ok"

/**
 * Classify a contract's renewal status by days-until-expiration.
 *
 * Thresholds (spec §4):
 *   ≤30  → critical (includes already-expired / negative values)
 *   ≤90  → warning
 *   ≤180 → upcoming
 *   else → ok
 */
export function classifyRenewalStatus(daysUntilExpiration: number): RenewalStatus {
  if (daysUntilExpiration <= 30) return "critical"
  if (daysUntilExpiration <= 90) return "warning"
  if (daysUntilExpiration <= 180) return "upcoming"
  return "ok"
}

/**
 * One year of real performance for a contract (spec §13).
 *
 * Compliance is nullable — when the underlying `ContractPeriod` has no
 * recorded compliance rate we report `null` rather than synthesizing a
 * value.
 */
export interface PerformanceHistoryRow {
  year: number
  spend: number
  rebate: number
  compliance: number | null
}

/** Input shape for {@link generateNegotiationPoints}. */
export interface NegotiationPointsInput {
  /** Commitment met as a percentage (0-100+, where 100 means met). */
  commitmentMet: number
  /** Current market-share value, or null when not tracked. */
  currentMarketShare: number | null
  /** Market-share commitment, or null when not set. */
  marketShareCommitment: number | null
  /** Currently active tier on the contract. */
  currentTier: number
  /** Highest tier defined on the contract. */
  maxTier: number
}

/**
 * Rule-based renewal negotiation points (spec §15).
 *
 * Always include rules 4 and 5. Conditionally include 1, 2, 3 — emitted in
 * numeric priority order (1, 2, 3) before the always-include trailers
 * (4, 5). No duplicates.
 */
export function generateNegotiationPoints(input: NegotiationPointsInput): string[] {
  const {
    commitmentMet,
    currentMarketShare,
    marketShareCommitment,
    currentTier,
    maxTier,
  } = input

  const points: string[] = []

  // (1) Strong performance — leverage for better rates
  if (commitmentMet >= 100) {
    points.push("Strong performance — leverage for better rates")
  }

  // (2) Market share exceeded — negotiate tier advancement
  if (
    currentMarketShare !== null &&
    marketShareCommitment !== null &&
    currentMarketShare >= marketShareCommitment
  ) {
    points.push("Market share exceeded — negotiate tier advancement")
  }

  // (3) Dynamic tier-advancement copy
  if (currentTier < maxTier) {
    points.push(`Advance from Tier ${currentTier} to Tier ${maxTier}`)
  }

  // (4) & (5) always included, in order
  points.push("Review pricing on top 10 SKUs vs market rates")
  points.push("Consider multi-year agreement for rate lock")

  return points
}

/** Item in the renewal task checklist. */
export interface RenewalTask {
  id: string
  /** Stable key used by persistence (matches `RenewalTask.taskKey` in Prisma). */
  key: string
  task: string
  completed: boolean
}

/**
 * Stable task-key constants. Persisted rows in `renewal_task` reference
 * these — do NOT rename without a data migration.
 */
export const RENEWAL_TASK_KEYS = [
  "review-performance",
  "analyze-market-pricing",
  "prepare-negotiation-strategy",
  "draft-renewal-terms",
  "schedule-renewal-meeting",
] as const

export type RenewalTaskKey = (typeof RENEWAL_TASK_KEYS)[number]

/**
 * Generate the renewal prep checklist (spec §14).
 *
 * 5 tasks with stable `key` strings used for persistence. Task 1 auto-
 * completes when `commitmentMet >= 80`; task 2 auto-completes when
 * `commitmentMet >= 90`. Tasks 3-5 are manual only — they always start
 * `completed: false`.
 */
export function generateRenewalTasks(commitmentMet: number): RenewalTask[] {
  return [
    {
      id: "task-1",
      key: "review-performance",
      task: "Review current performance data",
      completed: commitmentMet >= 80,
    },
    {
      id: "task-2",
      key: "analyze-market-pricing",
      task: "Analyze market pricing trends",
      completed: commitmentMet >= 90,
    },
    {
      id: "task-3",
      key: "prepare-negotiation-strategy",
      task: "Prepare negotiation strategy",
      completed: false,
    },
    {
      id: "task-4",
      key: "draft-renewal-terms",
      task: "Draft renewal terms",
      completed: false,
    },
    {
      id: "task-5",
      key: "schedule-renewal-meeting",
      task: "Schedule renewal meeting",
      completed: false,
    },
  ]
}
