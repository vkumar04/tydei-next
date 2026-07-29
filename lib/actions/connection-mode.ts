"use server"

import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { logAudit } from "@/lib/audit"
import type { ConnectionMode } from "@/lib/generated/prisma/client"

/**
 * Vendor 1-/2-way mode (Settings/Users feature).
 *
 * Mode lives on the `Connection` row (the facility–vendor pair). Only the
 * VENDOR side may change it. The ONE mode-gated read today is
 * `getFacilityActualsForVendor` (lib/actions/vendor-prospective.ts): facility
 * actuals flow to the vendor IFF an `accepted` connection exists with
 * `mode === "two_way"`.
 *
 * (A facility-side contract-flow gate, `vendorContractsVisibleToFacility`,
 * was defined here but never enforced by any surface — removed as dead code
 * 2026-07-03, Vick "remove them if they're not being used". If facility-side
 * gating is ever wanted, mirror the actuals gate's accepted+two_way where.)
 */

/**
 * Vendor sets the interaction mode for one of its facility connections.
 * Scoped to the caller's own vendor (no IDOR) and gated for read-only
 * users via `requireCanMutate`.
 */
export async function setConnectionMode(
  connectionId: string,
  mode: ConnectionMode,
): Promise<{ id: string; mode: ConnectionMode }> {
  await requireCanMutate()
  const { vendor } = await requireVendor()

  // Scope the update to the caller's own vendor — a vendor can only set
  // mode on connections where it is the vendor party.
  const result = await prisma.connection.updateMany({
    where: { id: connectionId, vendorId: vendor.id },
    data: { mode },
  })
  if (result.count === 0) throw new Error("Connection not found")
  return { id: connectionId, mode }
}

// ─── Vendor-level operating mode (Charles 2026-06-20) ──────────────
//
// A STANDALONE vendor (no facility connections) has no Connection to set a
// mode on, so it had no way to choose 1-way (own contracts + own COGs) vs
// 2-way. `Vendor.defaultMode` is that vendor-level choice. Null = derive from
// connections as before (pre-feature behavior). The COGS tab + the
// connection-flow gate read this when set.

/** Read the calling vendor's explicit operating mode (null = not chosen). */
export async function getVendorOperatingMode(): Promise<ConnectionMode | null> {
  const { vendor } = await requireVendor()
  const row = await prisma.vendor.findUnique({
    where: { id: vendor.id },
    select: { defaultMode: true },
  })
  return row?.defaultMode ?? null
}

/** The calling vendor sets its operating mode. Read-only-gated, own-vendor scoped. */
export async function setVendorOperatingMode(
  mode: ConnectionMode,
): Promise<{ mode: ConnectionMode }> {
  await requireCanMutate()
  const { vendor } = await requireVendor()
  await prisma.vendor.update({
    where: { id: vendor.id },
    data: { defaultMode: mode },
  })
  return { mode }
}

/**
 * Facility grants (or revokes) a vendor's permission to publish a contract
 * straight into its tenant, live, with no per-contract review.
 *
 * `requireFacility()`, deliberately — the mirror of `setConnectionMode` above,
 * which is vendor-only. The party that carries the risk owns the switch: an
 * auto-activated contract creates a live Contract row on THIS facility's tenant
 * and triggers a COG match-status recompute against ITS records. A vendor must
 * not be able to grant itself that, and until 2026-07-28 it effectively could —
 * the gate keyed off `Connection.mode`, which is vendor-settable and defaults to
 * `one_way`, so accepting any invite auto-granted publish rights.
 *
 * Scoped to the caller's own facility (no IDOR) and gated for read-only users.
 */
export async function setConnectionAutoActivate(
  connectionId: string,
  enabled: boolean,
): Promise<{ id: string; autoActivateContracts: boolean }> {
  await requireCanMutate()
  const { facility, user } = await requireFacility()

  // The facilityId predicate is the ownership check — a facility can only grant
  // this on a connection where it is the facility party.
  const result = await prisma.connection.updateMany({
    where: { id: connectionId, facilityId: facility.id },
    data: { autoActivateContracts: enabled },
  })
  if (result.count === 0) throw new Error("Connection not found")

  await logAudit({
    userId: user.id,
    action: enabled
      ? "connection.auto_activate.granted"
      : "connection.auto_activate.revoked",
    entityType: "connection",
    entityId: connectionId,
    metadata: { facilityId: facility.id },
  })

  return { id: connectionId, autoActivateContracts: enabled }
}
