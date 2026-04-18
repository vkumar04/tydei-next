/**
 * Contract duplicate prevention.
 *
 * Per docs/superpowers/specs/2026-04-18-platform-data-model-reconciliation.md §4.10.
 *
 * A new contract is a duplicate of an existing one when, for the same vendor
 * and contract type, an ACTIVE existing contract covers at least one of the
 * same facilities AND its effective window overlaps the new one's.
 *
 * This module is pure. Callers (typically `createContract` server actions)
 * pre-load the candidate contracts (including their facility ids resolved via
 * `ContractFacility` join + the contract's own `facilityId`) and pass them in.
 *
 * If a duplicate is found the action surfaces a typed error to the UI, which
 * displays: "An overlapping contract exists. [View existing]".
 */

import { datesOverlap, facilitiesOverlap } from "./date-range"

/**
 * Shape of an existing contract row as far as duplicate-checking cares.
 * `facilityIds` is the UNION of the contract's own `facilityId` (legacy
 * single-facility column) and every `ContractFacility.facilityId` row.
 */
export interface ContractForDuplicateCheck {
  id: string
  vendorId: string
  contractType: string
  status: string
  effectiveDate: Date
  expirationDate: Date | null
  facilityIds: string[]
}

/**
 * The payload for a proposed new contract. No `id` or `status` — a new
 * contract is always being created as active; the check answers "would
 * creating this shadow an existing active contract?".
 */
export interface NewContractInput {
  vendorId: string
  contractType: string
  effectiveDate: Date
  expirationDate: Date | null
  facilityIds: string[]
}

/**
 * Result of `isContractDuplicate`. When `isDuplicate` is true, `conflictId`
 * is the id of the FIRST matching existing contract (stable-ordered by the
 * caller; we preserve input order). `reason` is a short human-readable tag.
 */
export interface DuplicateCheckResult {
  isDuplicate: boolean
  conflictId?: string
  reason?: string
}

const ACTIVE_STATUS = "active"

const DUPLICATE_REASON =
  "Overlapping active contract for same vendor+type+facility+dates"

/**
 * Returns a duplicate verdict for a proposed new contract against a
 * pre-loaded list of existing contracts.
 *
 * Match criteria (ALL must hold for a candidate):
 *   1. Same `vendorId`
 *   2. Same `contractType`
 *   3. Candidate `status === "active"`
 *   4. Date ranges overlap (null expiration = indefinite future)
 *   5. At least one shared `facilityId`
 *
 * Returns `{ isDuplicate: false }` when no candidate matches, or
 * `{ isDuplicate: true, conflictId, reason }` with the first matching id.
 */
export function isContractDuplicate(
  input: NewContractInput,
  existing: ContractForDuplicateCheck[],
): DuplicateCheckResult {
  const candidates = existing.filter(
    (c) =>
      c.vendorId === input.vendorId &&
      c.contractType === input.contractType &&
      c.status === ACTIVE_STATUS &&
      datesOverlap(
        c.effectiveDate,
        c.expirationDate,
        input.effectiveDate,
        input.expirationDate,
      ) &&
      facilitiesOverlap(c.facilityIds, input.facilityIds),
  )

  if (candidates.length === 0) {
    return { isDuplicate: false }
  }

  return {
    isDuplicate: true,
    conflictId: candidates[0].id,
    reason: DUPLICATE_REASON,
  }
}
