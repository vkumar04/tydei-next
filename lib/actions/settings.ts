"use server"

import { prisma } from "@/lib/db"
import { requireAuth, requireFacility, requireVendor } from "@/lib/actions/auth"
import {
  updateFacilityProfileSchema,
  updateVendorProfileSchema,
  type UpdateFacilityProfileInput,
  type UpdateVendorProfileInput,
  type NotificationPreferences,
} from "@/lib/validators/settings"
import { serialize } from "@/lib/serialize"

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
  const { vendor } = await requireVendor()
  const data = updateVendorProfileSchema.parse(input)

  await prisma.vendor.update({
    where: { id: vendor.id },
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

const DEFAULT_PREFS: NotificationPreferences = {
  expiringContracts: true,
  tierThresholds: true,
  rebateDue: true,
  paymentDue: true,
  offContract: true,
  pricingErrors: true,
  compliance: true,
  emailEnabled: true,
  inAppEnabled: true,
}

export async function getNotificationPreferences(
  entityId: string
): Promise<NotificationPreferences> {
  await requireAuth()

  // Try to find organization linked to facility or vendor
  const facility = await prisma.facility.findUnique({
    where: { id: entityId },
    select: { organization: { select: { metadata: true } } },
  })

  const vendor = !facility
    ? await prisma.vendor.findUnique({
        where: { id: entityId },
        select: { organization: { select: { metadata: true } } },
      })
    : null

  const metadata = facility?.organization?.metadata ?? vendor?.organization?.metadata
  if (!metadata) return DEFAULT_PREFS

  try {
    const parsed = JSON.parse(String(metadata))
    return { ...DEFAULT_PREFS, ...parsed.notificationPrefs }
  } catch {
    return DEFAULT_PREFS
  }
}

export async function updateNotificationPreferences(
  entityId: string,
  prefs: NotificationPreferences
): Promise<void> {
  await requireAuth()

  const facility = await prisma.facility.findUnique({
    where: { id: entityId },
    select: { organizationId: true, organization: { select: { metadata: true } } },
  })

  const vendor = !facility
    ? await prisma.vendor.findUnique({
        where: { id: entityId },
        select: { organizationId: true, organization: { select: { metadata: true } } },
      })
    : null

  const orgId = facility?.organizationId ?? vendor?.organizationId
  if (!orgId) return

  const existing = facility?.organization?.metadata ?? vendor?.organization?.metadata
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(String(existing ?? "{}"))
  } catch {
    /* ignore */
  }

  parsed.notificationPrefs = prefs

  await prisma.organization.update({
    where: { id: orgId },
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
): Promise<void> {
  const { role } = await assertCallerIsMember(userId, organizationId)
  if (role !== "owner" && role !== "admin") {
    throw new Error("Not authorized: requires admin or owner role")
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
    createdAt: m.createdAt.toISOString(),
  })))
}

export async function inviteTeamMember(input: {
  organizationId: string
  email: string
  role: string
}): Promise<void> {
  const session = await requireAuth()
  await assertCallerCanManage(session.user.id, input.organizationId)

  await prisma.invitation.create({
    data: {
      organizationId: input.organizationId,
      email: input.email,
      role: input.role,
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      inviterId: session.user.id,
    },
  })
}

export async function removeTeamMember(memberId: string): Promise<void> {
  const session = await requireAuth()
  const target = await prisma.member.findUniqueOrThrow({
    where: { id: memberId },
    select: { organizationId: true },
  })
  await assertCallerCanManage(session.user.id, target.organizationId)
  await prisma.member.delete({ where: { id: memberId } })
}

export async function updateTeamMemberRole(
  memberId: string,
  role: string
): Promise<void> {
  const session = await requireAuth()
  const target = await prisma.member.findUniqueOrThrow({
    where: { id: memberId },
    select: { organizationId: true },
  })
  await assertCallerCanManage(session.user.id, target.organizationId)
  await prisma.member.update({ where: { id: memberId }, data: { role } })
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

export async function updateFeatureFlags(
  _facilityId: string,
  flags: Partial<FeatureFlagData>
): Promise<void> {
  const { facility } = await requireFacility()

  await prisma.featureFlag.upsert({
    where: { facilityId: facility.id },
    create: { facilityId: facility.id, ...flags },
    update: flags,
  })
}

// ─── Vendor Team (with sub-roles) ────────────────────────────────

export interface VendorTeamMember extends TeamMember {
  subRole: string | null
}

export async function getVendorTeamMembers(
  organizationId: string
): Promise<VendorTeamMember[]> {
  await requireVendor()

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
  const session = await requireAuth()

  await prisma.invitation.create({
    data: {
      organizationId: input.organizationId,
      email: input.email,
      role: `${input.role}:${input.subRole}`,
      status: "pending",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      inviterId: session.user.id,
    },
  })
}
