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
          select: { mode: true, status: true },
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
    }
  }

  if (vendor?.defaultMode) {
    return {
      mode: vendor.defaultMode,
      source: "vendorDefault",
      hasConnectionForFacility: false,
      connectionStatus: null,
    }
  }

  return {
    mode: acceptedTwoWay ? "two_way" : "one_way",
    source: "derived",
    hasConnectionForFacility: false,
    connectionStatus: null,
  }
}

/**
 * Whether a vendor-created contract may skip facility review and land ACTIVE.
 *
 * Two conditions, both required:
 *   - the resolved mode is one_way (nobody is going to review it), AND
 *   - the contract does not name a facility the vendor has no ACCEPTED
 *     Connection with.
 *
 * That second condition is the tenant-isolation guard. The vendor "New
 * Contract" facility picker used to offer every active facility in the system,
 * so without it a vendor in one_way mode could mint a LIVE contract attributed
 * to any facility — a cross-tenant write. A standalone one_way vendor still
 * gets the behavior Charles asked for; the contract is simply its own
 * (facilityId null) rather than silently attached to someone else's tenant.
 *
 * Charles 2026-07-27, tightened during the auto-activation build: the check is
 * `status === "accepted"`, not merely "a row exists". `sendConnectionInvite` is
 * a vendor-callable action that creates a `pending` / `one_way` row against a
 * facility matched BY NAME off the wire, with no facility consent — so
 * "a row exists" was forgeable in one call, and invite-then-create would have
 * written a live contract into an unconsenting facility's tenant. An accepted
 * row is the only state the counterparty actually signs off on
 * (`acceptConnection`). This is strictly narrower than the existence check;
 * do not relax it back.
 */
export function canAutoActivate(
  resolved: ResolvedOperatingMode,
  facilityId: string | null | undefined,
): boolean {
  if (resolved.mode !== "one_way") return false
  if (!facilityId) return true
  return (
    resolved.hasConnectionForFacility && resolved.connectionStatus === "accepted"
  )
}
