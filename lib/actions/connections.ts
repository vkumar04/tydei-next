"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import type { ConnectionStatus, ConnectionMode } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"

/**
 * Resolve the caller's session to their facility/vendor identity by
 * looking up their Member row and its organization. Used by
 * `getConnections` and `sendConnectionInvite` to derive scope from
 * the SESSION rather than trusting client-supplied ids.
 *
 * Charles audit Iter4-B1/B2: pre-fix both actions accepted scope
 * (`facilityId` / `vendorId` for read; `fromType` / `fromId` /
 * `fromName` for write) directly from the wire under requireAuth()
 * only — Stryker user could enumerate the entire Connection table
 * by calling `getConnections({})` and could mint a Connection row
 * that appeared to originate from Lighthouse. Both surfaces now
 * derive their scope from this helper instead.
 */
async function resolveCallerOrgIdentity(userId: string): Promise<
  | {
      kind: "facility"
      facilityId: string
      facilityName: string
    }
  | {
      kind: "vendor"
      vendorId: string
      vendorName: string
    }
  | null
> {
  const member = await prisma.member.findFirst({
    where: { userId },
    include: {
      organization: { include: { facility: true, vendor: true } },
    },
  })
  const facility = member?.organization?.facility
  if (facility) {
    return {
      kind: "facility",
      facilityId: facility.id,
      facilityName: facility.name,
    }
  }
  const vendor = member?.organization?.vendor
  if (vendor) {
    return { kind: "vendor", vendorId: vendor.id, vendorName: vendor.name }
  }
  return null
}

export interface ConnectionData {
  id: string
  facilityId: string
  facilityName: string
  vendorId: string
  vendorName: string
  status: ConnectionStatus
  /** 1-way (vendor keeps contracts private) vs 2-way (contracts flow to the facility). */
  mode: ConnectionMode
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
  // Charles audit Iter4-B1 (BLOCKER): pre-fix the where clause was
  // built directly from input under requireAuth() only — passing
  // `{}` returned every Connection on the platform, and passing a
  // foreign tenant's id returned that tenant's connections. Scope
  // is now derived from the session; the input fields for
  // facilityId/vendorId are deliberately ignored. The `status`
  // filter is fine to pass through (it's a row-level filter, not
  // a tenant boundary).
  const session = await requireAuth()
  const identity = await resolveCallerOrgIdentity(session.user.id)
  // A caller with no facility/vendor org membership (e.g. a platform admin
  // who navigated to a tenant settings surface) simply has no connections
  // to show. Returning [] keeps this read from throwing an unhandled
  // Server-Components render error (the digest toast Charles saw) — the
  // tenant-scoping boundary is still enforced for callers that DO have an
  // identity below.
  if (!identity) return []
  const { status } = input
  const scopeWhere =
    identity.kind === "facility"
      ? { facilityId: identity.facilityId }
      : { vendorId: identity.vendorId }
  const where = {
    ...scopeWhere,
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
    mode: c.mode,
    inviteType: c.inviteType,
    invitedByEmail: c.invitedByEmail,
    invitedAt: c.invitedAt.toISOString(),
    respondedAt: c.respondedAt?.toISOString() ?? null,
    message: c.message,
  })))
}

// ─── Send Connection Invite ──────────────────────────────────────

export async function sendConnectionInvite(input: {
  // Charles audit Iter4-B2 (BLOCKER): the previous shape accepted
  // `fromType` / `fromId` / `fromName` from the wire and let
  // Medtronic's user mint a Connection row that appeared to
  // originate from Lighthouse. Those three fields are now ignored
  // (kept on the type only for back-compat with the existing client
  // hook signature) and the invite's origin is derived from the
  // caller's session.
  fromType?: "facility" | "vendor"
  fromId?: string
  fromName?: string
  toEmail: string
  toName: string
  message?: string
}): Promise<ConnectionData> {
  const session = await requireAuth()
  await requireCanMutate()
  const identity = await resolveCallerOrgIdentity(session.user.id)
  if (!identity) {
    throw new Error(
      "Not authorized: caller is not a member of any facility or vendor org",
    )
  }

  const inviteType =
    identity.kind === "facility" ? "facility_to_vendor" : "vendor_to_facility"

  // For a facility inviting a vendor, we need to find or create the vendor
  // For now, create a placeholder connection
  let facilityId: string
  let facilityName: string
  let vendorId: string
  let vendorName: string

  if (identity.kind === "facility") {
    facilityId = identity.facilityId
    facilityName = identity.facilityName
    // The invite dialog collects a vendor NAME (not an email), so match by
    // name (case-insensitive) first, then fall back to contactEmail when a
    // real email was supplied. Previously this only matched a fabricated
    // `contact@<name>.com` email that almost never existed, so every invite
    // threw "Vendor not found" (Charles: "who does this invite go to?").
    const trimmedName = input.toName?.trim() ?? ""
    const vendor = await prisma.vendor.findFirst({
      where: {
        OR: [
          ...(trimmedName
            ? [{ name: { equals: trimmedName, mode: "insensitive" as const } }]
            : []),
          ...(input.toEmail ? [{ contactEmail: input.toEmail }] : []),
        ],
      },
    })
    vendorId = vendor?.id ?? ""
    vendorName = vendor?.name ?? trimmedName
    if (!vendorId) {
      throw new Error(
        `No vendor named "${trimmedName || input.toEmail}" is on the platform yet. Ask them to register, then resend the invite.`,
      )
    }
  } else {
    vendorId = identity.vendorId
    vendorName = identity.vendorName
    // Match the facility by NAME (case-insensitive) — the invite dialog
    // collects a facility name, not an email (previously this only matched a
    // fabricated `admin@<name>.com` member email that almost never existed).
    const trimmedName = input.toName?.trim() ?? ""
    const facility = await prisma.facility.findFirst({
      where: {
        OR: [
          ...(trimmedName
            ? [{ name: { equals: trimmedName, mode: "insensitive" as const } }]
            : []),
          ...(input.toEmail
            ? [
                {
                  organization: {
                    members: { some: { user: { email: input.toEmail } } },
                  },
                },
              ]
            : []),
        ],
      },
    })
    facilityId = facility?.id ?? ""
    facilityName = facility?.name ?? trimmedName
    if (!facilityId) {
      throw new Error(
        `No facility named "${trimmedName || input.toEmail}" is on the platform yet. Ask them to register, then resend the invite.`,
      )
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
    mode: connection.mode,
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
  await requireCanMutate()
  await assertCallerOnConnection(session.user.id, connectionId)

  await prisma.connection.update({
    where: { id: connectionId },
    data: { status: "accepted", respondedAt: new Date() },
  })
}

export async function rejectConnection(connectionId: string): Promise<void> {
  const session = await requireAuth()
  await requireCanMutate()
  await assertCallerOnConnection(session.user.id, connectionId)

  await prisma.connection.update({
    where: { id: connectionId },
    data: { status: "rejected", respondedAt: new Date() },
  })
}

export async function removeConnection(connectionId: string): Promise<void> {
  const session = await requireAuth()
  await requireCanMutate()
  await assertCallerOnConnection(session.user.id, connectionId)
  await prisma.connection.delete({ where: { id: connectionId } })
}
