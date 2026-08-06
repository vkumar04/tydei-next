// Merged-list row model + pure status mapper for the facility contracts
// list (contracts-list-closure §4.0). Extracted from lib/actions/contracts.ts
// during the F5 decomposition: a "use server" module may only export async
// functions, so the type and its pure helper live here instead.

export type MergedContract = {
  id: string // stable row id (prefixed to avoid collision across sources)
  contractId: string | null // real Contract.id when source=system, null for pending
  name: string
  source: "system" | "vendor"
  status:
    | "active"
    | "expired"
    | "expiring"
    | "pending"
    | "draft"
    | "rejected"
    | "revision_requested"
  vendor: { id: string; name: string }
  contractType: string
  facilityId: string | null
  facilities: string[]
  effectiveDate: Date | null
  expirationDate: Date | null
  totalValue: number
  score: number | null
}

/**
 * Translate a PendingContractStatus to the unified status enum
 * used by the merged list. `approved` is promoted to `active` because
 * once approved, a pending row has already become a real Contract and
 * wouldn't appear in this list anyway; we treat the edge case defensively.
 * `withdrawn` is filtered out upstream.
 */
export function mapPendingStatus(
  status:
    | "draft"
    | "submitted"
    | "approved"
    | "rejected"
    | "revision_requested"
    | "withdrawn",
): MergedContract["status"] | null {
  switch (status) {
    case "submitted":
      return "pending"
    case "approved":
      return "active"
    case "rejected":
      return "rejected"
    case "revision_requested":
      return "revision_requested"
    case "draft":
      return "draft"
    case "withdrawn":
      return null // hide
  }
}
