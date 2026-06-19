"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import type { ConnectionMode } from "@/lib/generated/prisma/client"

/**
 * Vendor 1-/2-way mode + the contract-flow gate (Settings/Users feature).
 *
 * Mode lives on the `Connection` row (the facility–vendor pair). Only the
 * VENDOR side may change it. The single gate
 * `vendorContractsVisibleToFacility` decides which vendors' contracts a
 * facility may receive: visible IFF an `accepted` connection exists AND its
 * `mode === "two_way"`. One-way connections never surface vendor contracts
 * to the facility (the vendor self-serves them in isolation).
 */

export interface VendorVisibility {
  /** Vendor ids whose contracts may flow to this facility. */
  vendorIds: string[]
  /** Division ids on those two-way connections (for division-aware gates). */
  vendorDivisionIds: string[]
}

/**
 * The contract-flow gate. Returns the vendor (and division) ids that have
 * an accepted, two-way connection with `facilityId`. A facility surface
 * that includes vendor-originated contracts must AND-in
 * `vendorId ∈ vendorIds`.
 */
export async function vendorContractsVisibleToFacility(
  facilityId: string,
): Promise<VendorVisibility> {
  const rows = await prisma.connection.findMany({
    where: { facilityId, status: "accepted", mode: "two_way" },
    select: { vendorId: true, vendorDivisionId: true },
  })
  return {
    vendorIds: [...new Set(rows.map((r) => r.vendorId))],
    vendorDivisionIds: [
      ...new Set(rows.map((r) => r.vendorDivisionId).filter((d): d is string => !!d)),
    ],
  }
}

/** Read the mode the calling vendor has set for a given connection. */
export async function getConnectionMode(connectionId: string): Promise<ConnectionMode> {
  const { vendor } = await requireVendor()
  const conn = await prisma.connection.findFirst({
    where: { id: connectionId, vendorId: vendor.id },
    select: { mode: true },
  })
  if (!conn) throw new Error("Connection not found")
  return conn.mode
}

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
