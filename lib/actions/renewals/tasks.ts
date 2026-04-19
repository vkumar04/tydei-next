"use server"

/**
 * Renewals — persistent renewal-prep task checklist server actions.
 *
 * Reference: plans/2026-04-19-renewals-v0-parity.md §W1.6
 *
 * The checklist has 5 items defined by `generateRenewalTasks` in
 * `@/lib/renewals/engine`. Persistence is keyed by the stable `key`
 * string on each generated task — we upsert into `RenewalTask` rows so
 * users can mark items done across sessions.
 *
 * Auth: facility-scoped. The checklist's contract must be owned by (or
 * shared with) the caller's facility — enforced via
 * `contractOwnershipWhere`.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import {
  generateRenewalTasks,
  RENEWAL_TASK_KEYS,
  type RenewalTaskKey,
} from "@/lib/renewals/engine"

// ─── Types (returned to client) ──────────────────────────────────

/**
 * Merged view of a renewal task — combines the static label/order from
 * `generateRenewalTasks` with any persisted completion state.
 *
 * If the user hasn't touched a task yet, `persisted=false` and
 * `completed` reflects the auto-complete rules on `commitmentMet`.
 */
export interface RenewalTaskItem {
  /** Stable key — matches `generateRenewalTasks` + Prisma `taskKey`. */
  key: string
  /** Human-readable label. */
  task: string
  /** Whether the task is completed (persisted state wins over auto). */
  completed: boolean
  /** True when a RenewalTask row exists for this (contract, key). */
  persisted: boolean
  /** Completion audit — null when not persisted or not completed. */
  completedAt: Date | null
  completedById: string | null
  completedByName: string | null
}

// ─── List ────────────────────────────────────────────────────────

/**
 * Returns the 5-task checklist merged with any persisted rows.
 *
 * Persisted rows override the computed `completed` value from
 * `generateRenewalTasks(commitmentMet)`. Callers pass the contract's
 * current commitmentMet (0-100+) so the fallback matches the engine.
 */
export async function getRenewalTasks(
  contractId: string,
  commitmentMet: number = 0,
): Promise<RenewalTaskItem[]> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true },
  })
  if (!contract) return []

  const rows = await prisma.renewalTask.findMany({
    where: { contractId },
    include: {
      completer: { select: { id: true, name: true } },
    },
  })

  const rowByKey = new Map(rows.map((r) => [r.taskKey, r]))
  const template = generateRenewalTasks(commitmentMet)

  const merged: RenewalTaskItem[] = template.map((t) => {
    const row = rowByKey.get(t.key)
    if (!row) {
      return {
        key: t.key,
        task: t.task,
        completed: t.completed,
        persisted: false,
        completedAt: null,
        completedById: null,
        completedByName: null,
      }
    }
    return {
      key: t.key,
      task: t.task,
      completed: row.completed,
      persisted: true,
      completedAt: row.completedAt,
      completedById: row.completedBy,
      completedByName: row.completer?.name ?? null,
    }
  })

  return serialize(merged) as RenewalTaskItem[]
}

// ─── Toggle ──────────────────────────────────────────────────────

function isValidTaskKey(key: string): key is RenewalTaskKey {
  return (RENEWAL_TASK_KEYS as readonly string[]).includes(key)
}

/**
 * Upsert a RenewalTask row for (contractId, taskKey).
 *
 * When `completed=true` we stamp `completedBy`/`completedAt`; when
 * `completed=false` we clear them. Idempotent — calling twice with the
 * same value is a no-op at the DB level (beyond `updatedAt`).
 */
export async function toggleRenewalTask(input: {
  contractId: string
  taskKey: string
  completed: boolean
}): Promise<RenewalTaskItem> {
  const { facility, user } = await requireFacility()

  if (!isValidTaskKey(input.taskKey)) {
    throw new Error(`Unknown renewal task key: ${input.taskKey}`)
  }

  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { id: true },
  })
  if (!contract) {
    throw new Error("Contract not found")
  }

  const completedBy = input.completed ? user.id : null
  const completedAt = input.completed ? new Date() : null

  const row = await prisma.renewalTask.upsert({
    where: {
      contractId_taskKey: {
        contractId: input.contractId,
        taskKey: input.taskKey,
      },
    },
    create: {
      contractId: input.contractId,
      taskKey: input.taskKey,
      completed: input.completed,
      completedBy,
      completedAt,
    },
    update: {
      completed: input.completed,
      completedBy,
      completedAt,
    },
    include: {
      completer: { select: { id: true, name: true } },
    },
  })

  await logAudit({
    userId: user.id,
    action: input.completed
      ? "renewal.task_completed"
      : "renewal.task_uncompleted",
    entityType: "renewal_task",
    entityId: row.id,
    metadata: {
      contractId: input.contractId,
      taskKey: input.taskKey,
    },
  })

  // Look up the label from the generator template so the returned
  // item matches the shape the UI renders elsewhere.
  const template = generateRenewalTasks(0)
  const tpl = template.find((t) => t.key === input.taskKey)

  const item: RenewalTaskItem = {
    key: row.taskKey,
    task: tpl?.task ?? row.taskKey,
    completed: row.completed,
    persisted: true,
    completedAt: row.completedAt,
    completedById: row.completedBy,
    completedByName: row.completer?.name ?? null,
  }

  return serialize(item) as RenewalTaskItem
}
