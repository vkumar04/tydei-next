"use server"

import { headers } from "next/headers"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth-server"
import {
  requireAuth,
  requireFacility,
  requireVendor,
} from "@/lib/actions/auth"
import {
  notificationPreferencesSchema,
  updateFacilityProfileSchema,
  updateVendorProfileSchema,
  type UpdateFacilityProfileInput,
  type UpdateVendorProfileInput,
  type NotificationPreferences,
} from "@/lib/validators/settings"
import { parseNotificationPrefs } from "@/lib/notifications/prefs"
import { serialize } from "@/lib/serialize"
import { rateLimit } from "@/lib/rate-limit"
import { requireCan } from "@/lib/actions/auth-permissions"
import { ACCESS_TIERS, type AccessTier } from "@/lib/auth/permissions"

/** Invitations per organization per hour (mail-cannon guard). */
const INVITE_LIMIT_PER_HOUR = 20


// Access tier (Settings/Users feature). Only a Super user may change a
// member's tier (gated by requireCan("members.manage")). Mirrors the
// owner-protection discipline used for org roles.
const accessTierSchema = z.enum(ACCESS_TIERS as unknown as [AccessTier, ...AccessTier[]])

// ─── Role enums (Charles audit C2/C3) ─────────────────────────────
//
// Better-auth's organization plugin recognizes "owner" / "admin" /
// "member". Owner is reserved for the creator-of-org path and must
// NEVER be assignable via invite or role-update — that's how a vendor
// admin chained-displaced the legitimate owner in the audit. The
// invite/update enums are intentionally narrow (admin | member) to
// keep the privilege ceiling below "owner".
const inviteRoleSchema = z.enum(["admin", "member"])
const updateRoleSchema = z.enum(["admin", "member"])

const inviteTeamMemberInputSchema = z.object({
  organizationId: z.string().min(1),
  email: z.email(),
  role: inviteRoleSchema,
})

// `subRole` is concatenated into the stored role with a colon
// (`"admin:owner"`). Reject any character that could escape the
// shape we read back in `getVendorTeamMembers` (split on `:`).
const safeRoleSegment = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, "Role segments must be alphanumeric")

const inviteVendorTeamMemberInputSchema = z.object({
  organizationId: z.string().min(1),
  email: z.email(),
  role: inviteRoleSchema,
  subRole: safeRoleSegment,
})

// Vendor orgs store sub-roles as `"<base>:<sub>"` (e.g. "admin:owner").
// Every role comparison in this file must look at the BASE segment —
// raw `===` / Prisma `in` comparisons silently miss sub-roled members
// (same class as the category/vendor canonical-name bugs).
function baseRoleSegment(role: string): string {
  return role.includes(":") ? (role.split(":")[0] ?? role) : role
}

async function assertNotLastAdmin(
  organizationId: string,
  targetMemberId: string,
): Promise<void> {
  // Count current admins/owners. If the member being demoted/removed
  // is one of them and they're the only one, refuse — otherwise the
  // org would be bricked (no one left to manage members or invites).
  // The caller already passed assertCallerCanManage for organizationId,
  // and the post-fetch `target.organizationId !== organizationId`
  // equality check bounds this read to that gated org.
  // auth-scope-scanner-skip: post-fetch org equality check below.
  const target = await prisma.member.findUnique({
    where: { id: targetMemberId },
    select: { role: true, organizationId: true },
  })
  if (!target || target.organizationId !== organizationId) return
  const targetBase = baseRoleSegment(target.role)
  if (targetBase !== "admin" && targetBase !== "owner") return

  // 2026-06-09 settings audit: a raw `role IN ('admin','owner')` count
  // missed vendor sub-roled admins ("admin:owner"), so vendor orgs had
  // NO last-admin protection (their lone "admin:x" never matched the
  // target early-return) AND multi-admin vendor orgs false-blocked
  // removals (count 0 <= 1). Compare base segments in JS instead.
  const members = await prisma.member.findMany({
    where: { organizationId },
    select: { role: true },
  })
  const adminCount = members.filter((m) =>
    ["admin", "owner"].includes(baseRoleSegment(m.role)),
  ).length
  if (adminCount <= 1) {
    throw new Error("Cannot remove the last admin of this organization")
  }
}

// ─── Facility Profile ────────────────────────────────────────────

export interface FacilityProfile {
  id: string
  name: string
  type: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  beds: number | null
  organizationId: string | null
  healthSystemName: string | null
}

export async function getFacilityProfile(_facilityId?: string): Promise<FacilityProfile> {
  const { facility: sessionFacility } = await requireFacility()

  // auth-scope-scanner-skip: id is the session facility's own id.
  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: sessionFacility.id },
    include: { healthSystem: { select: { name: true } } },
  })

  return serialize({
    id: facility.id,
    name: facility.name,
    type: facility.type,
    address: facility.address,
    city: facility.city,
    state: facility.state,
    zip: facility.zip,
    beds: facility.beds,
    organizationId: facility.organizationId,
    healthSystemName: facility.healthSystem?.name ?? null,
  })
}

export async function updateFacilityProfile(
  _facilityId: string,
  input: UpdateFacilityProfileInput
): Promise<void> {
  const { facility } = await requireFacility()
  // Settings write — Super only (Advanced/User blocked even via direct call).
  await requireCan("settings.manage")
  const data = updateFacilityProfileSchema.parse(input)

  await prisma.facility.update({
    where: { id: facility.id },
    data: {
      name: data.name,
      type: data.type,
      address: data.address,
      city: data.city,
      state: data.state,
      zip: data.zip,
      beds: data.beds,
    },
  })
}

// ─── Vendor Profile ──────────────────────────────────────────────

export interface VendorProfile {
  id: string
  name: string
  displayName: string | null
  logoUrl: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  website: string | null
  address: string | null
  division: string | null
  organizationId: string | null
}

export async function getVendorProfile(_vendorId?: string): Promise<VendorProfile> {
  const { vendor: sessionVendor } = await requireVendor()

  // auth-scope-scanner-skip: id is the session vendor's own id.
  const vendor = await prisma.vendor.findUniqueOrThrow({
    where: { id: sessionVendor.id },
  })

  return serialize({
    id: vendor.id,
    name: vendor.name,
    displayName: vendor.displayName,
    logoUrl: vendor.logoUrl,
    contactName: vendor.contactName,
    contactEmail: vendor.contactEmail,
    contactPhone: vendor.contactPhone,
    website: vendor.website,
    address: vendor.address,
    division: vendor.division,
    organizationId: vendor.organizationId,
  })
}

export async function updateVendorProfile(
  _vendorId: string,
  input: UpdateVendorProfileInput
): Promise<void> {
  // Charles audit M1 + 2026-06-09 settings audit: Vendor is a SHARED
  // row, so writes are restricted — pre-M1-fix any vendor user could
  // overwrite contactEmail to intercept facility→vendor invites. The
  // M1 stopgap (requireAdmin only) also broke the vendor settings
  // Organization tab for every vendor user. Final shape:
  //   - platform admin (UserRole "admin") may update any vendor by id
  //     (admin console path), OR
  //   - a vendor-org member whose BASE member role is owner/admin may
  //     update their OWN session vendor — the client-supplied id is
  //     ignored on this path.
  // Settings write — Super only (Advanced/User blocked even via direct call).
  await requireCan("settings.manage")
  const data = updateVendorProfileSchema.parse(input)
  const session = await requireAuth()
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })

  let targetVendorId: string
  if (user?.role === "admin") {
    // Platform admin manages all vendors by design.
    // auth-scope-scanner-skip: requireAuth + UserRole "admin" gate above.
    const vendor = await prisma.vendor.findUniqueOrThrow({
      where: { id: _vendorId },
      select: { id: true },
    })
    targetVendorId = vendor.id
  } else {
    if (user?.role !== "vendor") {
      throw new Error("Not authorized: requires admin or vendor organization admin")
    }
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id },
      select: {
        role: true,
        organization: { select: { vendor: { select: { id: true } } } },
      },
    })
    const sessionVendor = member?.organization?.vendor
    if (!sessionVendor) {
      throw new Error("Not authorized: caller is not a member of a vendor organization")
    }
    const base = baseRoleSegment(member.role)
    if (base !== "owner" && base !== "admin") {
      throw new Error("Not authorized: requires admin or owner role")
    }
    targetVendorId = sessionVendor.id
  }

  // auth-scope-scanner-skip: targetVendorId is either admin-gated or the
  // caller's own session vendor (see branch above).
  await prisma.vendor.update({
    where: { id: targetVendorId },
    data: {
      name: data.name,
      displayName: data.displayName || null,
      logoUrl: data.logoUrl || null,
      contactName: data.contactName || null,
      contactEmail: data.contactEmail || null,
      contactPhone: data.contactPhone || null,
      website: data.website || null,
      address: data.address || null,
      division: data.division || null,
    },
  })
}

// ─── Notification Preferences (stored as metadata on Organization) ─
//
// 2026-06-09 settings audit BLOCKER: both actions previously took
// `entityId` (a facility or vendor id) from CLIENT input under
// requireAuth() only — any authenticated user could read AND overwrite
// any other tenant's notification prefs (and, because the update
// round-trips the whole Organization.metadata JSON, race-clobber other
// metadata keys). Scope now derives from the session member's org (same
// pattern as ai-credits' sessionTenant); the entityId params are
// ignored. Server-internal by-entity reads live in
// lib/notifications/prefs.ts (used by the email pipeline).

async function sessionOrganization(): Promise<{
  organizationId: string
  metadata: string | null
} | null> {
  const session = await requireAuth()
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    select: {
      organizationId: true,
      organization: { select: { metadata: true } },
    },
  })
  if (!member?.organizationId) return null
  return {
    organizationId: member.organizationId,
    metadata: member.organization?.metadata ?? null,
  }
}

export async function getNotificationPreferences(
  /** @deprecated 2026-06-09 audit: ignored — derived from session. */
  _entityId?: string
): Promise<NotificationPreferences> {
  const org = await sessionOrganization()
  return parseNotificationPrefs(org?.metadata)
}

export async function updateNotificationPreferences(
  /** @deprecated 2026-06-09 audit: ignored — derived from session. */
  _entityId: string,
  prefs: NotificationPreferences
): Promise<void> {
  // Zod-parse so arbitrary JSON can't be injected into org metadata.
  const parsedPrefs = notificationPreferencesSchema.parse(prefs)
  await requireCan("settings.manage")
  const org = await sessionOrganization()
  if (!org) return

  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(String(org.metadata ?? "{}"))
  } catch {
    /* ignore */
  }

  parsed.notificationPrefs = parsedPrefs

  // auth-scope-scanner-skip: org id comes from the session member row.
  await prisma.organization.update({
    where: { id: org.organizationId },
    data: { metadata: JSON.stringify(parsed) },
  })
}

// ─── Team Members ────────────────────────────────────────────────

export interface TeamMember {
  id: string
  userId: string
  name: string
  email: string
  image: string | null
  role: string
  /** Settings/Users access tier (super | advanced | user). */
  accessTier: AccessTier
  createdAt: string
}

/**
 * Charles audit round-8: every team-management action must verify the
 * caller is in the target organization (and admin/owner for write
 * actions). Pre-fix: any authenticated user could enumerate any org's
 * members, invite themselves to any org, delete any member from any
 * org, or escalate any member's role — all by guessing/learning IDs.
 */
async function assertCallerIsMember(
  userId: string,
  organizationId: string,
): Promise<{ role: string }> {
  const callerMember = await prisma.member.findFirst({
    where: { userId, organizationId },
    select: { role: true },
  })
  if (!callerMember) {
    throw new Error("Not authorized: not a member of this organization")
  }
  return callerMember
}
async function assertCallerCanManage(
  userId: string,
  organizationId: string,
): Promise<{ role: string }> {
  const { role } = await assertCallerIsMember(userId, organizationId)
  // Base-segment compare so vendor sub-roled admins ("admin:owner")
  // can manage their org — raw === locked them out pre-2026-06-09.
  const base = baseRoleSegment(role)
  if (base !== "owner" && base !== "admin") {
    throw new Error("Not authorized: requires admin or owner role")
  }
  return { role }
}

/**
 * 2026-06-09 settings audit: an org ADMIN must not be able to remove or
 * demote the org OWNER (that's how an admin could displace the owner —
 * the C2/C3 fixes blocked owner *assignment* but not owner *takedown*).
 * Only an owner may act on an owner.
 */
function assertOwnerProtected(targetRole: string, callerRole: string): void {
  if (
    baseRoleSegment(targetRole) === "owner" &&
    baseRoleSegment(callerRole) !== "owner"
  ) {
    throw new Error("Not authorized: only the owner can modify the owner")
  }
}

export async function getTeamMembers(organizationId: string): Promise<TeamMember[]> {
  const session = await requireAuth()
  await assertCallerIsMember(session.user.id, organizationId)

  const members = await prisma.member.findMany({
    where: { organizationId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  return serialize(members.map((m) => ({
    id: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    role: m.role,
    accessTier: m.accessTier,
    createdAt: m.createdAt.toISOString(),
  })))
}

export async function inviteTeamMember(input: {
  organizationId: string
  email: string
  role: string
}): Promise<void> {
  // Migrated to better-auth's `auth.api.createInvitation`. The
  // beforeCreateInvitation hook in lib/auth-server.ts re-validates
  // the role enum (admin|member, never owner) — our local zod parse
  // here is the front-line defense; the hook is the platform-wide
  // belt that fires even when callers reach the API directly.
  // assertCallerCanManage remains in place so cross-org C1-style
  // probes are caught BEFORE we cross into better-auth's surface.
  const parsed = inviteTeamMemberInputSchema.parse(input)
  const session = await requireAuth()
  await requireCan("members.manage")
  await assertCallerCanManage(session.user.id, parsed.organizationId)
  // Invitations now SEND EMAIL (sendInvitationEmail wired 2026-07-26), so an
  // authenticated Super could use this as a mail cannon. Cap per org.
  const { success: withinInviteLimit } = rateLimit(
    `invite:${parsed.organizationId}`,
    INVITE_LIMIT_PER_HOUR,
    60 * 60_000,
  )
  if (!withinInviteLimit) {
    throw new Error(
      "Too many invitations sent in the last hour — please try again later.",
    )
  }


  await auth.api.createInvitation({
    body: {
      email: parsed.email,
      role: parsed.role,
      organizationId: parsed.organizationId,
    },
    headers: await headers(),
  })
}

export async function removeTeamMember(memberId: string): Promise<void> {
  const session = await requireAuth()
  // auth-scope-scanner-skip: assertCallerCanManage(target.organizationId) below.
  const target = await prisma.member.findUniqueOrThrow({
    where: { id: memberId },
    select: { organizationId: true, role: true },
  })
  await requireCan("members.manage")
  const caller = await assertCallerCanManage(session.user.id, target.organizationId)
  // 2026-06-09 settings audit: an admin cannot remove the owner.
  assertOwnerProtected(target.role, caller.role)
  // Charles audit C3: prevent bricking the org by removing the last admin.
  await assertNotLastAdmin(target.organizationId, memberId)
  await prisma.member.delete({ where: { id: memberId } })
}

export async function updateTeamMemberRole(
  memberId: string,
  role: string
): Promise<void> {
  // Charles audit C3: zod enum prevents an admin from self-promoting
  // to "owner" or being demoted to a string the UI can't render.
  const parsedRole = updateRoleSchema.parse(role)
  const session = await requireAuth()
  // auth-scope-scanner-skip: assertCallerCanManage(target.organizationId) below.
  const target = await prisma.member.findUniqueOrThrow({
    where: { id: memberId },
    select: { organizationId: true, role: true },
  })
  await requireCan("members.manage")
  const caller = await assertCallerCanManage(session.user.id, target.organizationId)
  // 2026-06-09 settings audit: an admin cannot demote the owner.
  assertOwnerProtected(target.role, caller.role)
  // If the new role is non-admin, ensure we're not demoting the last admin.
  if (parsedRole !== "admin") {
    await assertNotLastAdmin(target.organizationId, memberId)
  }
  await prisma.member.update({
    where: { id: memberId },
    data: { role: parsedRole },
  })
}

/**
 * Settings/Users feature: change a member's access tier
 * (super | advanced | user). Super-only — `requireCan("members.manage")`
 * passes for Super tier only. Still org-scoped (caller must manage the
 * target's org) and owner-protected (an admin cannot retier the owner).
 */
export async function updateMemberAccessTier(
  memberId: string,
  tier: string,
): Promise<void> {
  const parsedTier = accessTierSchema.parse(tier)
  const session = await requireAuth()
  // Super-tier capability gate (read-only/advanced callers throw here).
  await requireCan("members.manage")
  // auth-scope-scanner-skip: assertCallerCanManage(target.organizationId) below.
  const target = await prisma.member.findUniqueOrThrow({
    where: { id: memberId },
    select: { organizationId: true, role: true },
  })
  const caller = await assertCallerCanManage(session.user.id, target.organizationId)
  assertOwnerProtected(target.role, caller.role)
  await prisma.member.update({
    where: { id: memberId },
    data: { accessTier: parsedTier },
  })
}

// ─── Feature Flags ───────────────────────────────────────────────

export interface FeatureFlagData {
  purchaseOrdersEnabled: boolean
  aiAgentEnabled: boolean
  vendorPortalEnabled: boolean
  advancedReportsEnabled: boolean
  caseCostingEnabled: boolean
}

export async function getFeatureFlags(_facilityId?: string): Promise<FeatureFlagData> {
  const { facility } = await requireFacility()

  const flags = await prisma.featureFlag.findUnique({
    where: { facilityId: facility.id },
  })

  return serialize({
    purchaseOrdersEnabled: flags?.purchaseOrdersEnabled ?? true,
    aiAgentEnabled: flags?.aiAgentEnabled ?? true,
    vendorPortalEnabled: flags?.vendorPortalEnabled ?? true,
    advancedReportsEnabled: flags?.advancedReportsEnabled ?? true,
    caseCostingEnabled: flags?.caseCostingEnabled ?? true,
  })
}

// Zod-strip so unknown keys from the wire can't reach the Prisma write
// (Prisma throws an opaque 500 on unknown args; stripping is safer).
const featureFlagsUpdateSchema = z.object({
  purchaseOrdersEnabled: z.boolean().optional(),
  aiAgentEnabled: z.boolean().optional(),
  vendorPortalEnabled: z.boolean().optional(),
  advancedReportsEnabled: z.boolean().optional(),
  caseCostingEnabled: z.boolean().optional(),
})

export async function updateFeatureFlags(
  _facilityId: string,
  flags: Partial<FeatureFlagData>
): Promise<void> {
  const { facility } = await requireFacility()
  await requireCan("settings.manage")
  const parsed = featureFlagsUpdateSchema.parse(flags)

  await prisma.featureFlag.upsert({
    where: { facilityId: facility.id },
    create: { facilityId: facility.id, ...parsed },
    update: parsed,
  })
}

// ─── Vendor Team (with sub-roles) ────────────────────────────────

export interface VendorTeamMember extends TeamMember {
  subRole: string | null
}

export async function getVendorTeamMembers(
  organizationId: string
): Promise<VendorTeamMember[]> {
  // Charles audit B3: a vendor session alone is not enough — confirm
  // the caller is a member of the org they're querying. Pre-fix,
  // Stryker could pass Medtronic's organizationId and read its roster.
  const session = await requireVendor()
  await assertCallerIsMember(session.user.id, organizationId)

  const members = await prisma.member.findMany({
    where: { organizationId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  return serialize(members.map((m) => {
    // Sub-role is stored in the role field as "role:subRole"
    const [role, subRole] = m.role.includes(":") ? m.role.split(":") : [m.role, null]
    return {
      id: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
      role: role ?? m.role,
      subRole: subRole ?? null,
      accessTier: m.accessTier,
      createdAt: m.createdAt.toISOString(),
    }
  }))
}

export async function inviteVendorTeamMember(input: {
  organizationId: string
  email: string
  role: string
  subRole: string
}): Promise<void> {
  // Charles audit C1: pre-fix this had only requireAuth — Stryker's
  // vendor user successfully created an invitation row in Medtronic's
  // org with `role: "admin:owner"`. Now we (a) zod-validate the role
  // segments to block colon-injection / role inflation, and (b) gate
  // on assertCallerCanManage so foreign organizationId is rejected.
  const parsed = inviteVendorTeamMemberInputSchema.parse(input)
  const session = await requireAuth()
  await requireCan("members.manage")
  await assertCallerCanManage(session.user.id, parsed.organizationId)
  // Invitations now SEND EMAIL (sendInvitationEmail wired 2026-07-26), so an
  // authenticated Super could use this as a mail cannon. Cap per org.
  const { success: withinInviteLimit } = rateLimit(
    `invite:${parsed.organizationId}`,
    INVITE_LIMIT_PER_HOUR,
    60 * 60_000,
  )
  if (!withinInviteLimit) {
    throw new Error(
      "Too many invitations sent in the last hour — please try again later.",
    )
  }


  // Sub-role is concatenated into the stored role with a colon — the
  // beforeCreateInvitation hook splits on `:` and validates the base
  // segment ("admin" | "member"), so the colon-injection vector
  // (`subRole: "owner:owner"`) is rejected by the local zod schema
  // here AND the platform hook.
  // better-auth's TS narrows `role` to the default-roles union; the
  // runtime body schema is `z.string()`. Cast through the narrow
  // type so vendor sub-roles round-trip — the hook validates the
  // base segment regardless of TS shape.
  const concatenatedRole = `${parsed.role}:${parsed.subRole}` as "admin" | "member"
  await auth.api.createInvitation({
    body: {
      email: parsed.email,
      role: concatenatedRole,
      organizationId: parsed.organizationId,
    },
    headers: await headers(),
  })
}
