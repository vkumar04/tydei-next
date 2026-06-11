/**
 * "Last Action" date resolution for the vendor "My Contracts" list
 * (bugs.rtfd 2026-06-11 B4: "Need submission date column or status
 * change date for when actions happen here").
 *
 * Resolved at the row-mapping boundary (vendor-contract-list.tsx),
 * NOT inline in the column cell, so the rule lives in one place:
 *
 * - PendingContract submissions: the facility's review decision
 *   (`reviewedAt`) if one happened, else the vendor's submission
 *   time (`submittedAt`). Both fields already exist on the model —
 *   no schema change.
 * - Real Contract rows: Prisma's `@updatedAt`. It's the most honest
 *   field on the row — there is no persisted approval/status-change
 *   timestamp on Contract, and `updatedAt` is by definition the last
 *   time anything acted on the row (approval created it; edits and
 *   recomputes touch it).
 *
 * Inputs may be Date objects (client-constructed) or ISO strings
 * (serialized over the server-action boundary) — both are normalized.
 */

export type LastActionSource =
  | {
      kind: "pending"
      reviewedAt: string | Date | null | undefined
      submittedAt: string | Date
    }
  | {
      kind: "contract"
      updatedAt: string | Date
    }

export function resolveLastActionAt(row: LastActionSource): Date {
  const raw =
    row.kind === "pending" ? (row.reviewedAt ?? row.submittedAt) : row.updatedAt
  return raw instanceof Date ? raw : new Date(raw)
}
