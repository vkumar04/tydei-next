/**
 * Alerts — bulk action planners.
 *
 * Reference: docs/superpowers/specs/2026-04-18-alerts-rewrite.md §4.4
 *
 * Pure planners: given a set of selected alerts + a target action,
 * return the subset that can legally be processed plus per-alert
 * rationale for any that can't. The server action layer consumes this
 * plan to execute updates + show feedback to the user.
 */
import {
  canTransition,
  buildTransitionPatch,
  type AlertStatusValue,
  type StatusTransitionPatch,
} from "./status-workflow"

export interface AlertForBulkAction {
  id: string
  status: AlertStatusValue
}

export type BulkAlertAction = "mark_read" | "resolve" | "dismiss"

export interface BulkActionResultItem {
  alertId: string
  /** The Prisma update patch to apply. */
  patch: StatusTransitionPatch
}

export interface SkippedAlertItem {
  alertId: string
  currentStatus: AlertStatusValue
  reason: string
}

export interface BulkActionPlan {
  action: BulkAlertAction
  toUpdate: BulkActionResultItem[]
  skipped: SkippedAlertItem[]
}

const ACTION_TO_STATUS: Record<BulkAlertAction, AlertStatusValue> = {
  mark_read: "read",
  resolve: "resolved",
  dismiss: "dismissed",
}

/**
 * Build an execution plan for a bulk action. Alerts that can't legally
 * transition are surfaced in `skipped` with a reason string (not an
 * error — bulk UX surfaces "3 of 5 updated" + a hover for the rest).
 */
export function planBulkAction(input: {
  action: BulkAlertAction
  alerts: AlertForBulkAction[]
  now?: Date
}): BulkActionPlan {
  const targetStatus = ACTION_TO_STATUS[input.action]
  const now = input.now ?? new Date()

  const toUpdate: BulkActionResultItem[] = []
  const skipped: SkippedAlertItem[] = []

  for (const alert of input.alerts) {
    const check = canTransition({ from: alert.status, to: targetStatus })
    if (!check.allowed) {
      skipped.push({
        alertId: alert.id,
        currentStatus: alert.status,
        reason: check.reason ?? "Transition not allowed",
      })
      continue
    }
    toUpdate.push({
      alertId: alert.id,
      patch: buildTransitionPatch(targetStatus, now),
    })
  }

  return { action: input.action, toUpdate, skipped }
}

/**
 * Summary counts for a bulk plan — useful for toast messages.
 */
export function summarizeBulkPlan(plan: BulkActionPlan): {
  totalSelected: number
  willUpdate: number
  willSkip: number
} {
  return {
    totalSelected: plan.toUpdate.length + plan.skipped.length,
    willUpdate: plan.toUpdate.length,
    willSkip: plan.skipped.length,
  }
}
