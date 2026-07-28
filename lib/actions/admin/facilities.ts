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

/** Mirrors ADMIN_TENANT_PAGE_SIZE in lib/actions/admin/vendors.ts — a
 *  `"use server"` file cannot export a non-async binding, so the two consoles
 *  each own their copy. The client never sends a pageSize; it reads this back
 *  off the response. */
const ADMIN_TENANT_PAGE_SIZE = 20
const ADMIN_TENANT_MAX_PAGE_SIZE = 200

export async function adminGetFacilities(input: {
  search?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{
  facilities: AdminFacilityRow[]
  /**
   * Facilities matching the search — NOT the length of `facilities`. The
   * denominator of the page range, and the only number here that moves when
   * the operator types.
   */
  total: number
  /**
   * The console's whole scope: every facility, ignoring the search. THIS is the
   * "Total Facilities" card, and the scope every stat below shares.
   */
  catalogTotal: number
  /** Of the catalog, the ones whose `status` is "active". Whole-scope. */
  activeTotal: number
  /** Members of the catalog's Organizations — the `userCount` column, summed. */
  userTotal: number
  /** Contracts belonging to the catalog — the `contractCount` column, summed. */
  contractTotal: number
  /** The page actually served, clamped into range — not the one asked for. */
  page: number
  pageSize: number
  pageCount: number
  /** The search actually applied, so the caption can describe THESE rows. */
  search: string
}> {
  await requireAdmin()
  const search = input.search?.trim() ?? ""
  const status = input.status
  const pageSize = Math.min(
    Math.max(Math.trunc(input.pageSize ?? ADMIN_TENANT_PAGE_SIZE), 1),
    ADMIN_TENANT_MAX_PAGE_SIZE,
  )

  // Base filter (everything but the search) vs. the searched filter — see
  // adminGetVendors. `catalogTotal` is the console's whole scope, `total` the
  // subset the search matched; conflating them makes the caption's "(of N
  // total)" quietly agree with whatever is typed in the box.
  const baseWhere: Prisma.FacilityWhereInput = {}
  if (status) baseWhere.status = status

  const where: Prisma.FacilityWhereInput = search
    ? { ...baseWhere, name: { contains: search, mode: "insensitive" } }
    : baseWhere

  /**
   * EVERY stat below is computed over `baseWhere` — the console's whole scope —
   * and none of them over the returned page OR over the search box. See
   * adminGetVendors for both rounds of the incident: first a stat row summed
   * over `take: 20`, then the same row computed inside the search, so typing a
   * vendor name rewrote four cards labelled "Total …" to describe the one row
   * that matched. The page range is where a search-scoped count belongs.
   *
   * One `groupBy` carries two cards: the totals sum to the catalog and the
   * "active" bucket is the Active card, so no separate `count()` is needed.
   *
   * The Active card is NOT the vendor console's dropped "Active" card in
   * disguise, and was re-checked on 2026-07-28 before being kept.
   * `Facility.status` is `@default("active")` like `Vendor.status`, but unlike
   * it the column has a real writer: lib/billing/stripe-webhook.ts flips a
   * facility to "inactive" on `customer.subscription.deleted` and on any
   * non-active subscription update. So a facility reading "Inactive" means
   * something specific (its subscription lapsed), which is why the card and the
   * Status column both survive. What it does NOT mean is "someone reviewed
   * this": a facility with no Stripe subscription at all is born active and
   * stays there, and both production facilities are active for that reason.
   *
   * Users and contracts live on other models, so they are counted THROUGH the
   * same facility filter. `isNot: null` is load-bearing on both: Organization
   * and Contract each have a nullable facility, and members of a *vendor* org
   * (or a contract orphaned by a facility delete, `facilityId -> NULL`) must
   * not land in a facility-scoped number.
   */
  const [statusGroups, searchMatchTotal, userTotal, contractTotal] =
    await Promise.all([
      prisma.facility.groupBy({ by: ["status"], _count: true, where: baseWhere }),
      // Only a second round trip when a search narrows the rows.
      search ? prisma.facility.count({ where }) : undefined,
      prisma.member.count({
        where: { organization: { facility: { is: baseWhere, isNot: null } } },
      }),
      prisma.contract.count({
        where: { facility: { is: baseWhere, isNot: null } },
      }),
    ])

  const catalogTotal = statusGroups.reduce((sum, g) => sum + g._count, 0)
  const activeTotal = statusGroups.find((g) => g.status === "active")?._count ?? 0
  const total = searchMatchTotal ?? catalogTotal

  // Rows AFTER the count so the page can be clamped into range first — see
  // adminGetVendors.
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(Math.trunc(input.page ?? 1), 1), pageCount)

  const facilities = await prisma.facility.findMany({
    where,
    include: {
      healthSystem: { select: { name: true } },
      _count: { select: { contracts: true } },
      organization: { include: { _count: { select: { members: true } } } },
    },
    orderBy: { name: "asc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

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
    catalogTotal,
    activeTotal,
    userTotal,
    contractTotal,
    page,
    pageSize,
    pageCount,
    search,
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
