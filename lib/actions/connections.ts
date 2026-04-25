"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import type { ConnectionStatus } from "@prisma/client"
import { serialize } from "@/lib/serialize"

export interface ConnectionData {
  id: string
  facilityId: string
  facilityName: string
  vendorId: string
  vendorName: string
  status: ConnectionStatus
  inviteType: string
  invitedByEmail: string
  invitedAt: string
  respondedAt: string | null
  message: string | null
}

// ─── Get Connections ─────────────────────────────────────────────

export async function getConnections(input: {
  facilityId?: string
  vendorId?: string
  status?: ConnectionStatus
}): Promise<ConnectionData[]> {
  await requireAuth()

  const { facilityId, vendorId, status } = input
  const where = {
    ...(facilityId ? { facilityId } : {}),
    ...(vendorId ? { vendorId } : {}),
    ...(status ? { status } : {}),
  }

  const connections = await prisma.connection.findMany({
    where,
    orderBy: { invitedAt: "desc" },
  })

  return serialize(connections.map((c) => ({
    id: c.id,
    facilityId: c.facilityId,
    facilityName: c.facilityName,
    vendorId: c.vendorId,
    vendorName: c.vendorName,
    status: c.status,
    inviteType: c.inviteType,
    invitedByEmail: c.invitedByEmail,
    invitedAt: c.invitedAt.toISOString(),
    respondedAt: c.respondedAt?.toISOString() ?? null,
    message: c.message,
  })))
}

// ─── Send Connection Invite ──────────────────────────────────────

export async function sendConnectionInvite(input: {
  fromType: "facility" | "vendor"
  fromId: string
  fromName: string
  toEmail: string
  toName: string
  message?: string
}): Promise<ConnectionData> {
  const session = await requireAuth()

  const inviteType =
    input.fromType === "facility" ? "facility_to_vendor" : "vendor_to_facility"

  // For a facility inviting a vendor, we need to find or create the vendor
  // For now, create a placeholder connection
  let facilityId: string
  let facilityName: string
  let vendorId: string
  let vendorName: string

  if (input.fromType === "facility") {
    facilityId = input.fromId
    facilityName = input.fromName
    // Look up vendor by email
    const vendor = await prisma.vendor.findFirst({
      where: { contactEmail: input.toEmail },
    })
    vendorId = vendor?.id ?? ""
    vendorName = vendor?.name ?? input.toName
    if (!vendorId) {
      throw new Error("Vendor not found with that email")
    }
  } else {
    vendorId = input.fromId
    vendorName = input.fromName
    const facility = await prisma.facility.findFirst({
      where: {
        organization: { members: { some: { user: { email: input.toEmail } } } },
      },
    })
    facilityId = facility?.id ?? ""
    facilityName = facility?.name ?? input.toName
    if (!facilityId) {
      throw new Error("Facility not found with that email")
    }
  }

  const connection = await prisma.connection.create({
    data: {
      facilityId,
      facilityName,
      vendorId,
      vendorName,
      status: "pending",
      inviteType: inviteType as "facility_to_vendor" | "vendor_to_facility",
      invitedBy: session.user.id,
      invitedByEmail: session.user.email,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      message: input.message,
    },
  })

  return serialize({
    id: connection.id,
    facilityId: connection.facilityId,
    facilityName: connection.facilityName,
    vendorId: connection.vendorId,
    vendorName: connection.vendorName,
    status: connection.status,
    inviteType: connection.inviteType,
    invitedByEmail: connection.invitedByEmail,
    invitedAt: connection.invitedAt.toISOString(),
    respondedAt: null,
    message: connection.message,
  })
}

// ─── Accept / Reject / Remove ────────────────────────────────────

/**
 * Charles audit round-8 BLOCKER: connection mutations must verify the
 * caller is one of the two parties (facility OR vendor) on the row.
 * Pre-fix any authenticated user could accept/reject/delete arbitrary
 * connections, corrupting the partnership graph and potentially
 * granting data-sharing scopes.
 */
async function assertCallerOnConnection(
  userId: string,
  connectionId: string,
): Promise<void> {
  const connection = await prisma.connection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { facilityId: true, vendorId: true },
  })
  const member = await prisma.member.findFirst({
    where: { userId },
    include: { organization: { include: { facility: true, vendor: true } } },
  })
  const callerFacilityId = member?.organization?.facility?.id
  const callerVendorId = member?.organization?.vendor?.id
  if (
    connection.facilityId !== callerFacilityId &&
    connection.vendorId !== callerVendorId
  ) {
    throw new Error("Not authorized: not a party to this connection")
  }
}

export async function acceptConnection(connectionId: string): Promise<void> {
  const session = await requireAuth()
  await assertCallerOnConnection(session.user.id, connectionId)

  await prisma.connection.update({
    where: { id: connectionId },
    data: { status: "accepted", respondedAt: new Date() },
  })
}

export async function rejectConnection(connectionId: string): Promise<void> {
  const session = await requireAuth()
  await assertCallerOnConnection(session.user.id, connectionId)

  await prisma.connection.update({
    where: { id: connectionId },
    data: { status: "rejected", respondedAt: new Date() },
  })
}

export async function removeConnection(connectionId: string): Promise<void> {
  const session = await requireAuth()
  await assertCallerOnConnection(session.user.id, connectionId)
  await prisma.connection.delete({ where: { id: connectionId } })
}
