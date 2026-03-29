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

export async function getFacilityProfile(facilityId: string): Promise<FacilityProfile> {
  await requireFacility()

  const facility = await prisma.facility.findUniqueOrThrow({
    where: { id: facilityId },
    include: { healthSystem: { select: { name: true } } },
  })

  return {
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
  }
}

export async function updateFacilityProfile(
  facilityId: string,
  input: UpdateFacilityProfileInput
): Promise<void> {
  await requireFacility()
  const data = updateFacilityProfileSchema.parse(input)

  await prisma.facility.update({
    where: { id: facilityId },
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

export async function getVendorProfile(vendorId: string): Promise<VendorProfile> {
  await requireVendor()

  const vendor = await prisma.vendor.findUniqueOrThrow({
    where: { id: vendorId },
  })

  return {
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
  }
}

export async function updateVendorProfile(
  vendorId: string,
  input: UpdateVendorProfileInput
): Promise<void> {
  await requireVendor()
  const data = updateVendorProfileSchema.parse(input)

  await prisma.vendor.update({
    where: { id: vendorId },
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

export async function getTeamMembers(organizationId: string): Promise<TeamMember[]> {
  await requireAuth()

  const members = await prisma.member.findMany({
    where: { organizationId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: "asc" },
  })

  return members.map((m) => ({
    id: m.id,
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    role: m.role,
    createdAt: m.createdAt.toISOString(),
  }))
}

export async function inviteTeamMember(input: {
  organizationId: string
  email: string
  role: string
}): Promise<void> {
  const session = await requireAuth()

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
  await requireAuth()
  await prisma.member.delete({ where: { id: memberId } })
}

export async function updateTeamMemberRole(
  memberId: string,
  role: string
): Promise<void> {
  await requireAuth()
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

export async function getFeatureFlags(facilityId: string): Promise<FeatureFlagData> {
  await requireFacility()

  const flags = await prisma.featureFlag.findUnique({
    where: { facilityId },
  })

  return {
    purchaseOrdersEnabled: flags?.purchaseOrdersEnabled ?? true,
    aiAgentEnabled: flags?.aiAgentEnabled ?? true,
    vendorPortalEnabled: flags?.vendorPortalEnabled ?? true,
    advancedReportsEnabled: flags?.advancedReportsEnabled ?? true,
    caseCostingEnabled: flags?.caseCostingEnabled ?? true,
  }
}

export async function updateFeatureFlags(
  facilityId: string,
  flags: Partial<FeatureFlagData>
): Promise<void> {
  await requireFacility()

  await prisma.featureFlag.upsert({
    where: { facilityId },
    create: { facilityId, ...flags },
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

  return members.map((m) => {
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
  })
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
