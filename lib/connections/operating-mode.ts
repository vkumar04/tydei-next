/**
 * Canonical vendor↔facility operating-mode resolution.
 *
 * Until now this derivation existed ONLY as client state in
 * components/vendor/settings/vendor-settings-client.tsx:86-97, so no server
 * action could read it — which is why `createPendingContract` hardcoded
 * `status: "submitted"` regardless of mode. This module is the one place that
 * owns the precedence, so the settings banner and the contract-creation branch
 * can never disagree.
 *
 * Precedence (mirrors the settings UI exactly):
 *   1. a Connection row for THIS (vendor, facility) pair → its `mode`
 *   2. `Vendor.defaultMode` when explicitly set
 *   3. derived — any accepted two_way Connection ⇒ two_way, else one_way
 *
 * Charles 2026-07-27: "if it is set up for 1 way on a facility it does not need
 * to submit a contract it just becomes active after creating it." Note he says
 * "on a facility" — per-pair. The data model supports both: `Connection.mode`
 * is per vendor↔facility, `Vendor.defaultMode` is vendor-global. Rule 1 is the
 * per-facility answer; rules 2-3 cover a standalone vendor with no connections
 * at all, which is the case in his screenshots (Active 0 / Pending 0 / Sent 0).
 */

import type {
  ConnectionMode,
  ConnectionStatus,
} from "@/lib/generated/prisma/enums"
import { prisma } from "@/lib/db"

export type OperatingModeSource =
  | "connection"
  | "vendorDefault"
  | "derived"

export interface ResolvedOperatingMode {
  mode: ConnectionMode
  source: OperatingModeSource
  /**
   * True when an explicit Connection row exists for this exact
   * (vendor, facility) pair. Auto-activation against a NAMED facility requires
   * this — a vendor-global default must never be enough to write a live
   * contract onto a facility the vendor has no relationship with.
   */
  hasConnectionForFacility: boolean
  /**
   * Status of that pair Connection row (`null` when there is none).
   *
   * Charles 2026-07-27: `hasConnectionForFacility` alone is NOT a
   * relationship — `sendConnectionInvite` (lib/actions/connections.ts) lets any
   * authenticated vendor user mint a `status: "pending"`, `mode: "one_way"`
   * Connection row against ANY facility, matched by name off the wire. So the
   * row's mere existence would have let a vendor invite-then-auto-activate a
   * live contract onto an unconsenting facility's tenant. Auto-activation
   * therefore requires `accepted` — see `canAutoActivate`. Mode PRECEDENCE is
   * unchanged (rule 1 still honors whatever row exists) so the settings banner
   * keeps reading exactly as before.
   */
  connectionStatus: ConnectionStatus | null
  /**
   * Has the FACILITY granted this vendor permission to publish a contract
   * straight into its tenant, live, with no per-contract review?
   * (`Connection.autoActivateContracts`.) False when there is no pair row.
   */
  autoActivateGranted: boolean
}

export async function resolveOperatingMode(input: {
  vendorId: string
  facilityId?: string | null
}): Promise<ResolvedOperatingMode> {
  const { vendorId, facilityId } = input

  const [pairConnection, vendor, acceptedTwoWay] = await Promise.all([
    facilityId
      ? prisma.connection.findFirst({
          where: { vendorId, facilityId },
          select: { mode: true, status: true, autoActivateContracts: true },
        })
      : Promise.resolve(null),
    prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { defaultMode: true },
    }),
    prisma.connection.findFirst({
      where: { vendorId, status: "accepted", mode: "two_way" },
      select: { id: true },
    }),
  ])

  if (pairConnection) {
    return {
      mode: pairConnection.mode,
      source: "connection",
      hasConnectionForFacility: true,
      connectionStatus: pairConnection.status,
      autoActivateGranted: pairConnection.autoActivateContracts,
    }
  }

  if (vendor?.defaultMode) {
    return {
      mode: vendor.defaultMode,
      source: "vendorDefault",
      hasConnectionForFacility: false,
      connectionStatus: null,
      autoActivateGranted: false,
    }
  }

  return {
    mode: acceptedTwoWay ? "two_way" : "one_way",
    source: "derived",
    hasConnectionForFacility: false,
    connectionStatus: null,
    autoActivateGranted: false,
  }
}

/**
 * Whether a vendor-created contract may skip facility review and land ACTIVE.
 *
 * Split by whether the contract names a facility, because the two cases put the
 * risk on completely different parties:
 *
 *   NO facility  → the contract is the vendor's own record. Nobody else's tenant
 *                  is touched, so a standalone vendor self-serves freely. This
 *                  is the case the schema means by "nothing flows to the
 *                  facility", and it is what Charles asked for.
 *
 *   A facility   → a live Contract row lands on THAT facility's tenant and
 *                  `recomputeMatchStatusesForVendor` rewrites its COG match
 *                  statuses. The facility carries that risk, so the facility
 *                  must have granted it: `Connection.autoActivateContracts`,
 *                  default false, settable only through a requireFacility()
 *                  action.
 *
 * `mode` deliberately does NOT gate this (2026-07-28). It used to, and that was
 * backwards: `Connection.mode` is `@default(one_way)` as a FAIL-SECURE posture —
 * "do not share this facility's actuals with the vendor yet" — so keying
 * auto-activation off one_way made the most restrictive setting silently the
 * most permissive one on an unrelated axis, and every newly accepted connection
 * granted publish rights by default. mode answers "does the facility's data flow
 * out?"; this answers "may the vendor write in?". Two questions, two flags.
 *
 * The accepted-status requirement is retained on top of the grant, not replaced
 * by it: `sendConnectionInvite` is vendor-callable and mints a `pending` row
 * against a facility matched BY NAME off the wire, so a pending row proves
 * nothing. Both conditions are required; do not relax either.
 */
export function canAutoActivate(
  resolved: ResolvedOperatingMode,
  facilityId: string | null | undefined,
): boolean {
  // The vendor's own contract — no other tenant involved.
  if (!facilityId) return true
  return (
    resolved.hasConnectionForFacility &&
    resolved.connectionStatus === "accepted" &&
    resolved.autoActivateGranted
  )
}
