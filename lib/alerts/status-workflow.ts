/**
 * Alerts — status workflow helpers.
 *
 * Reference: docs/superpowers/specs/2026-04-18-alerts-rewrite.md §4.4
 *
 * Pure functions — no DB, no side effects. Encapsulates the legal
 * status transition rules so server actions in subsystem 4 (and the UI
 * in subsystem 2) can rely on one source of truth.
 */

export type AlertStatusValue = "new_alert" | "read" | "resolved" | "dismissed"

/**
 * Which transitions are allowed per current status. Dismiss is always
 * terminal (no transitions out). Resolved → dismissed is allowed (archive
 * acknowledged alerts). Read ↔ new_alert is NOT allowed (once read, stays
 * read until resolved or dismissed).
 */
const ALLOWED_TRANSITIONS: Record<AlertStatusValue, AlertStatusValue[]> = {
  new_alert: ["read", "resolved", "dismissed"],
  read: ["resolved", "dismissed"],
  resolved: ["dismissed"],
  dismissed: [],
}

export interface TransitionAttempt {
  from: AlertStatusValue
  to: AlertStatusValue
}

export interface TransitionResult {
  allowed: boolean
  reason?: string
}

export function canTransition({
  from,
  to,
}: TransitionAttempt): TransitionResult {
  if (from === to) {
    return { allowed: false, reason: "no-op transition (from == to)" }
  }
  const allowed = ALLOWED_TRANSITIONS[from].includes(to)
  return allowed
    ? { allowed: true }
    : {
        allowed: false,
        reason: `Cannot transition from "${from}" to "${to}"`,
      }
}

/**
 * Given a list of alert statuses, return only those that can legally
 * transition to the target status (filter out already-there or
 * illegal transitions). Used by bulk actions to pre-filter the set
 * before writing.
 */
export function filterTransitionable<
  T extends { status: AlertStatusValue; id: string },
>(alerts: T[], to: AlertStatusValue): T[] {
  return alerts.filter((a) => canTransition({ from: a.status, to }).allowed)
}

/**
 * Compute the timestamp-field updates that should accompany a status
 * transition. Which field is set depends on the destination:
 *   → read: set readAt
 *   → resolved: set resolvedAt
 *   → dismissed: set dismissedAt
 */
export interface StatusTransitionPatch {
  status: AlertStatusValue
  readAt?: Date | null
  resolvedAt?: Date | null
  dismissedAt?: Date | null
}

export function buildTransitionPatch(
  to: AlertStatusValue,
  now: Date = new Date(),
): StatusTransitionPatch {
  switch (to) {
    case "read":
      return { status: to, readAt: now }
    case "resolved":
      return { status: to, resolvedAt: now }
    case "dismissed":
      return { status: to, dismissedAt: now }
    case "new_alert":
      // Resetting to new_alert is disallowed per canTransition, but the
      // pure patch builder still handles it defensively — clear all
      // stamps. Callers should guard upstream.
      return { status: to, readAt: null, resolvedAt: null, dismissedAt: null }
  }
}
