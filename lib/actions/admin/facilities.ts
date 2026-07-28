"use server"

import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import { requireAdmin } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import type { AdminCreateFacilityInput, AdminUpdateFacilityInput } from "@/lib/validators/admin"
import { serialize } from "@/lib/serialize"

// ─── Types ───────────────────────────────────────────────────────

export interface AdminFacilityRow {
  id: string
  name: string
  type: string
  city: string | null
  state: string | null
  beds: number | null
  status: string
  healthSystemName: string | null
  userCount: number
  contractCount: number
  createdAt: string
  /** False when the tenant has no Organization, so it cannot have users. */
  canHaveUsers: boolean
}

// ─── List Facilities ────────────────────────────────────────────

export async function adminGetFacilities(input: {
  search?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ facilities: AdminFacilityRow[]; total: number }> {
  await requireAdmin()
  const { search, status, page = 1, pageSize = 20 } = input

  const where: Record<string, unknown> = {}
  if (search) where.name = { contains: search, mode: "insensitive" }
  if (status) where.status = status

  const [facilities, total] = await Promise.all([
    prisma.facility.findMany({
      where,
      include: {
        healthSystem: { select: { name: true } },
        _count: { select: { contracts: true } },
        organization: { include: { _count: { select: { members: true } } } },
      },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.facility.count({ where }),
  ])

  return serialize({
    facilities: facilities.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      // See adminGetVendors — no Organization means no users.
      canHaveUsers: f.organizationId !== null,
      city: f.city,
      state: f.state,
      beds: f.beds,
      status: f.status,
      healthSystemName: f.healthSystem?.name ?? null,
      userCount: f.organization?._count?.members ?? 0,
      contractCount: f._count.contracts,
      createdAt: f.createdAt.toISOString(),
    })),
    total,
  })
}

// ─── Create Facility ────────────────────────────────────────────

/**
 * Every tenant needs an Organization, because that is what `Member` links a
 * user to. Creating a Facility or Vendor without one produces a tenant that
 * can never have a single user — silently, until someone tries to invite one.
 *
 * Production shows how easily that happens: 1 of 2 facilities and 199 of 200
 * vendors had no organization (audit 2026-07-26). Most of those vendors are
 * catalog rows rather than tenants, which is fine — but the ones created
 * through this UI are meant to be real, and were dead on arrival.
 *
 * Slug must be unique; derive from the name and disambiguate on collision.
 */
async function provisionOrganization(
  tx: Prisma.TransactionClient,
  name: string,
): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"

  for (let attempt = 0; attempt < 25; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`
    const clash = await tx.organization.findUnique({
      where: { slug },
      select: { id: true },
    })
    if (clash) continue
    const org = await tx.organization.create({ data: { name, slug } })
    return org.id
  }
  throw new Error(
    `Could not derive a unique organization slug from "${name}". Rename it slightly.`,
  )
}

export async function adminCreateFacility(input: AdminCreateFacilityInput) {
  const session = await requireAdmin()

  // Organization + tenant row land together — a tenant with no organization
  // cannot have users at all (see provisionOrganization).
  const facility = await prisma.$transaction(async (tx) => {
    const organizationId = await provisionOrganization(tx, input.name)
    return tx.facility.create({ data: { ...input, organizationId } })
  })

  await logAudit({
    userId: session.user.id,
    action: "facility.created",
    entityType: "facility",
    entityId: facility.id,
    metadata: { name: facility.name },
  })

  return serialize(facility)
}

// ─── Update Facility ────────────────────────────────────────────

export async function adminUpdateFacility(id: string, input: AdminUpdateFacilityInput) {
  await requireAdmin()

  const facility = await prisma.facility.update({ where: { id }, data: input })
  return serialize(facility)
}

// ─── Delete Facility ────────────────────────────────────────────

/**
 * Deleting a facility is not a clean operation, so this refuses rather than
 * letting the database decide the outcome (audit 2026-07-26).
 *
 * The FK rules split three ways:
 *   RESTRICT  cog_record, case_record, invoice, rebate, payment, credit,
 *             purchase_order, pricing_file, payor_contract, connection,
 *             surgeon_usage, report_schedule, file_import, feature_flag
 *             -> the delete throws a raw Prisma FK error, which surfaced to
 *                the operator as an unhandled server-action failure.
 *   SET NULL  contract, contract_period, pending_contract, alert, ai_credit
 *             -> WORSE: if the delete does go through, contracts are silently
 *                orphaned (facilityId -> NULL) and drop out of every
 *                facility-scoped query while still existing.
 *   CASCADE   contract_facility, facility_assignment, proposal_evaluation,
 *             rebate_insight_cache/flag, vendor_name_mapping
 *
 * So: count what is attached, and give the operator a specific reason instead
 * of a stack trace or silent data loss.
 */
export async function adminDeleteFacility(id: string) {
  const session = await requireAdmin()

  const [contracts, cogRecords, cases, invoices] = await Promise.all([
    prisma.contract.count({ where: { facilityId: id } }),
    prisma.cOGRecord.count({ where: { facilityId: id } }),
    prisma.case.count({ where: { facilityId: id } }),
    prisma.invoice.count({ where: { facilityId: id } }),
  ])

  const blocking = [
    contracts && `${contracts} contract(s)`,
    cogRecords && `${cogRecords} COG record(s)`,
    cases && `${cases} case(s)`,
    invoices && `${invoices} invoice(s)`,
  ].filter(Boolean) as string[]

  if (blocking.length > 0) {
    throw new Error(
      `This facility still has ${blocking.join(", ")}. Deleting it would ` +
        `orphan or destroy that data. Move or remove it first.`,
    )
  }

  const target = await prisma.facility.findUnique({
    where: { id },
    select: { name: true },
  })

  await prisma.facility.delete({ where: { id } })

  await logAudit({
    userId: session.user.id,
    action: "facility.deleted",
    entityType: "facility",
    entityId: id,
    metadata: { name: target?.name },
  })
}

/**
 * Every facility, unpaginated, for the user-creation Access picker — the
 * counterpart to `adminGetVendorOptions`. Facilities happen to fit inside the
 * default page size today, which is exactly why the identical pagination bug
 * went unnoticed on this side; do not rely on that staying true.
 */
export async function adminGetFacilityOptions(): Promise<
  { id: string; name: string; canHaveUsers: boolean }[]
> {
  await requireAdmin()
  const facilities = await prisma.facility.findMany({
    select: { id: true, name: true, organizationId: true },
    orderBy: { name: "asc" },
  })
  return facilities.map((f) => ({
    id: f.id,
    name: f.name,
    canHaveUsers: f.organizationId !== null,
  }))
}
