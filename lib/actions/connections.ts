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
  /**
   * Resolved id of the counterparty, from the dialog's typeahead
   * (`searchConnectionTargets`). Preferred over `toName`: a name is ambiguous
   * — "Lighthouse" matches two facilities — and picking the wrong one creates a
   * connection with the wrong tenant. Falls back to exact name matching when
   * absent so existing callers keep working.
   */
  toId?: string
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
    // Prefer the id the typeahead resolved — a name alone is ambiguous.
    // auth-scope-scanner-skip: the invite TARGET is intentionally unscoped — an
    // invite exists precisely to reach a counterparty you have no relationship
    // with yet, so there is no ownership predicate to apply. Safety comes from
    // three places instead: (1) the invite's ORIGIN is derived from the session
    // via resolveCallerOrgIdentity and can never be supplied from the wire
    // (Charles audit Iter4-B2); (2) the row is created `pending`, which grants
    // nothing; (3) acceptConnection is recipient-only, so the sender cannot
    // accept its own invite and manufacture an accepted connection. Changing
    // any of those three makes this line unsafe.
    const vendor = input.toId
      // auth-scope-scanner-skip: invite target is unscoped BY DESIGN — see the
      // three-part justification directly above.
      ? await prisma.vendor.findUnique({ where: { id: input.toId } })
      : await prisma.vendor.findFirst({
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
        `No vendor matches "${trimmedName || input.toEmail}" exactly. Pick one from the suggestions as you type — the name has to match in full, so a partial name like "Lighthouse" will not resolve on its own. If they are genuinely not on the platform yet, ask them to register and resend.`,
      )
    }
  } else {
    vendorId = identity.vendorId
    vendorName = identity.vendorName
    // Match the facility by NAME (case-insensitive) — the invite dialog
    // collects a facility name, not an email (previously this only matched a
    // fabricated `admin@<name>.com` member email that almost never existed).
    const trimmedName = input.toName?.trim() ?? ""
    // Prefer the id the typeahead resolved — see the note on `toId`.
    // auth-scope-scanner-skip: the invite TARGET is intentionally unscoped — an
    // invite exists precisely to reach a counterparty you have no relationship
    // with yet, so there is no ownership predicate to apply. Safety comes from
    // three places instead: (1) the invite's ORIGIN is derived from the session
    // via resolveCallerOrgIdentity and can never be supplied from the wire
    // (Charles audit Iter4-B2); (2) the row is created `pending`, which grants
    // nothing; (3) acceptConnection is recipient-only, so the sender cannot
    // accept its own invite and manufacture an accepted connection. Changing
    // any of those three makes this line unsafe.
    const facility = input.toId
      // auth-scope-scanner-skip: invite target is unscoped BY DESIGN — see the
      // three-part justification directly above.
      ? await prisma.facility.findUnique({ where: { id: input.toId } })
      : await prisma.facility.findFirst({
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
        `No facility matches "${trimmedName || input.toEmail}" exactly. Pick one from the suggestions as you type — the name has to match in full, so a partial name like "Lighthouse" will not resolve on its own. If they are genuinely not on the platform yet, ask them to register and resend.`,
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
      // Fail-secure: a new connection shares NO facility actuals until the
      // vendor explicitly opts into two_way (setConnectionMode). Explicit here
      // so the default is visible at the call site, not just the schema.
      mode: "one_way",
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

/**
 * Charles 2026-07-27 (found while wiring one-way auto-activation): accepting
 * is RECIPIENT-ONLY. `assertCallerOnConnection` allows either party, which is
 * right for reject/remove but let the INVITER accept its own invite — so a
 * vendor could `sendConnectionInvite` at a facility it picked by name and then
 * `acceptConnection` itself, manufacturing an "accepted" relationship with no
 * facility consent. `canAutoActivate` (lib/connections/operating-mode.ts)
 * treats an accepted one_way row as permission to write a LIVE contract onto
 * that facility's tenant, so self-accept was a cross-tenant write in two
 * calls. The invited side is the one named by `inviteType`.
 */
async function assertCallerIsInviteRecipient(
  userId: string,
  connectionId: string,
): Promise<{ facilityId: string; vendorId: string }> {
  const member = await prisma.member.findFirst({
    where: { userId },
    include: { organization: { include: { facility: true, vendor: true } } },
  })
  const callerFacilityId = member?.organization?.facility?.id
  const callerVendorId = member?.organization?.vendor?.id

  // The row is read ALREADY NARROWED to the caller's own tenant, so the
  // ownership decision lives in the where clause rather than in a post-fetch
  // comparison the scanner (and a future reader) can't see. The inviteType
  // check below then narrows "a party" to "the INVITED party".
  const connection = callerFacilityId
    ? await prisma.connection.findFirst({
        where: { id: connectionId, facilityId: callerFacilityId },
        select: { facilityId: true, vendorId: true, inviteType: true },
      })
    : callerVendorId
      ? await prisma.connection.findFirst({
          where: { id: connectionId, vendorId: callerVendorId },
          select: { facilityId: true, vendorId: true, inviteType: true },
        })
      : null
  if (!connection) {
    throw new Error("Not authorized: not a party to this connection")
  }
  const callerIsRecipient =
    connection.inviteType === "vendor_to_facility"
      ? connection.facilityId === callerFacilityId
      : connection.vendorId === callerVendorId
  if (!callerIsRecipient) {
    throw new Error(
      "Not authorized: only the invited party can accept this connection",
    )
  }
  return { facilityId: connection.facilityId, vendorId: connection.vendorId }
}

export async function acceptConnection(connectionId: string): Promise<void> {
  const session = await requireAuth()
  await requireCanMutate()
  const { facilityId, vendorId } = await assertCallerIsInviteRecipient(
    session.user.id,
    connectionId,
  )

  // Both party ids come from the recipient-scoped read above, so the write can
  // only ever land on the row that was authorized. `status: "pending"` is the
  // third clause on purpose: without it, accept re-opens a `rejected` or
  // `expired` invite, and an accepted row is what `canAutoActivate`
  // (lib/connections/operating-mode.ts) treats as permission for a vendor to
  // write a LIVE contract into this facility's tenant.
  const accepted = await prisma.connection.updateMany({
    where: { id: connectionId, facilityId, vendorId, status: "pending" },
    data: {
      status: "accepted",
      respondedAt: new Date(),
      respondedBy: session.user.id,
    },
  })
  if (accepted.count !== 1) {
    throw new Error(
      "This invitation is no longer pending — ask the other party to send a new one.",
    )
  }
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

export interface ConnectionInviteTarget {
  id: string
  name: string
}

/**
 * Typeahead for the "Invite to Connect" dialog.
 *
 * Charles 2026-07-28: "invites not working... I like that on the facility side to
 * send an invite they just need to use an alias name instead of an email."
 *
 * The name-based flow is the right UX; the matching behind it was not.
 * `sendConnectionInvite` resolved the counterparty with exact case-insensitive
 * NAME EQUALITY, so "Lighthouse" threw `No facility named "Lighthouse" is on the
 * platform yet` even though "Lighthouse Surgical Center" exists. Every
 * abbreviation, extra word or stray character failed.
 *
 * A looser string match is NOT the fix. "Lighthouse" matches BOTH "Lighthouse
 * Surgical Center" and "Lighthouse Community Hospital" — a `contains` fallback
 * would have silently connected the vendor to whichever row Postgres returned
 * first, i.e. a cross-tenant connection chosen by accident. The caller has to
 * pick a specific row, so this returns candidates and the dialog sends an id.
 *
 * Returns the OPPOSITE side from the caller: a vendor searches facilities, a
 * facility searches vendors. Disclosure is deliberately bounded — a query of at
 * least two characters, substring-matched, capped at 10 — so this narrows to
 * what the user is already looking for rather than dumping either catalog.
 */
export async function searchConnectionTargets(
  query: string,
): Promise<ConnectionInviteTarget[]> {
  const session = await requireAuth()
  const identity = await resolveCallerOrgIdentity(session.user.id)
  if (!identity) return []

  const q = query.trim()
  if (q.length < 2) return []

  const select = { id: true, name: true } as const
  const where = { name: { contains: q, mode: "insensitive" as const } }
  const rows =
    identity.kind === "vendor"
      ? await prisma.facility.findMany({
          where,
          select,
          orderBy: { name: "asc" },
          take: 10,
        })
      : await prisma.vendor.findMany({
          where,
          select,
          orderBy: { name: "asc" },
          take: 10,
        })
  return rows
}
