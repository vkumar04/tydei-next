import type { POStatus } from "@/lib/generated/prisma/client"

/**
 * Canonical PO status flow (2026-06-09 audit H4) — the SINGLE source of
 * truth for which status transitions are legal. Server actions validate
 * against it (`updatePOStatus`) and every menu/button that offers a
 * transition derives its options from it. Do not hand-roll a parallel
 * transition map in a component.
 *
 * Flow: draft → pending → approved → sent → completed.
 *   - draft → sent is a deliberate "submit directly to vendor" shortcut
 *     (the create form's Submit button and the list-row "Send to Vendor"
 *     action both use it).
 *   - cancelled is reachable from any non-terminal status.
 *   - completed / cancelled are terminal.
 */
export const PO_STATUS_FLOW: Record<POStatus, POStatus[]> = {
  draft: ["pending", "sent", "cancelled"],
  pending: ["approved", "cancelled"],
  approved: ["sent", "cancelled"],
  sent: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
}

/** All real POStatus values, in lifecycle order (drives filter dropdowns). */
export const PO_STATUSES = Object.keys(PO_STATUS_FLOW) as POStatus[]

export function isPOStatus(value: string): value is POStatus {
  return value in PO_STATUS_FLOW
}

export function canTransitionPOStatus(from: POStatus, to: POStatus): boolean {
  return PO_STATUS_FLOW[from]?.includes(to) ?? false
}
