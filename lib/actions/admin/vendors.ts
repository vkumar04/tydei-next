"use server"

import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import { requireAdmin } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import type { AdminCreateVendorInput, AdminUpdateVendorInput } from "@/lib/validators/admin"
import { serialize } from "@/lib/serialize"

// ─── Types ───────────────────────────────────────────────────────

export interface AdminVendorRow {
  id: string
  name: string
  code: string | null
  contactName: string | null
  contactEmail: string | null
  status: string
  tier: string
  contractCount: number
  repCount: number
  createdAt: string
  /** False when the tenant has no Organization, so it cannot have users. */
  canHaveUsers: boolean
}

// ─── List Vendors ───────────────────────────────────────────────

/**
 * Rows per page for the admin consoles. The server owns this number: the
 * client sends only a page, and reads `pageSize`/`pageCount` back off the
 * response, so there is exactly one definition of "a page".
 */
const ADMIN_TENANT_PAGE_SIZE = 20
/** Upper bound on a client-supplied pageSize, so nobody asks for the table. */
const ADMIN_TENANT_MAX_PAGE_SIZE = 200

export async function adminGetVendors(input: {
  search?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{
  vendors: AdminVendorRow[]
  /**
   * Vendors matching the search — NOT the length of `vendors`. This is the
   * denominator of the page range ("of N vendors"), and the only number here
   * that moves when the operator types.
   */
  total: number
  /**
   * The console's whole scope: every vendor, ignoring the search. THIS is what
   * the "Total Vendors" card shows, and the scope every stat below shares.
   */
  catalogTotal: number
  /**
   * Active vendors with an Organization — exactly the rows the Status column
   * badges "Onboarded" (vendor-columns.tsx). Whole-scope, like `catalogTotal`.
   */
  onboardedTotal: number
  /**
   * Divisions ("reps") belonging to the vendors in scope — the `repCount`
   * column summed over the CATALOG, not over the search or the page.
   */
  repTotal: number
  /** Contracts belonging to the vendors in scope — the `contractCount` column, summed. */
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

  // The filter the search runs INSIDE, kept separate from the search itself so
  // the two counts below are each attributable to one scope (same split as
  // `getVendorList` in lib/actions/vendors.ts). Fold them together and
  // `catalogTotal` silently becomes "vendors matching the search", which is a
  // narrower set than the sentence beside it claims.
  const baseWhere: Prisma.VendorWhereInput = {}
  if (status) baseWhere.status = status

  // Search runs in Postgres over every vendor in scope — never over the page
  // the client happens to be holding, which is the entire point of paging.
  const where: Prisma.VendorWhereInput = search
    ? { ...baseWhere, name: { contains: search, mode: "insensitive" } }
    : baseWhere

  /**
   * EVERY stat below is computed over `baseWhere` — the console's whole scope —
   * and none of them over the returned page OR over the search box.
   *
   * Two rounds of this bug, both the same shape one level down:
   *   2026-07-27  the stat row reduced over `vendors` (pageSize 20), so it read
   *               "20 Total Vendors" against 200 real rows. Only the first card
   *               was fixed, which was worse: one true 200 lent authority to a
   *               Sales Reps and Total Contracts figure still summed over 20.
   *   2026-07-28  the totals moved to the server but were computed over `where`,
   *               i.e. INSIDE the search. Typing "stryker" turned the card row
   *               into "1 Total Vendors / 1 Onboarded / 0 Sales Reps" — three
   *               numbers describing one matched row under four unqualified
   *               "Total …" labels. The page range says what the search matched
   *               ("of 1 vendor matching “stryker”"); the cards must not also
   *               quietly become the search, or nothing on the screen still
   *               answers "how many vendors are there".
   *
   * `search` therefore buys ONE extra round trip — the count that drives paging
   * — instead of narrowing all four stats. Same number of queries as before,
   * pointed at the scope each number claims.
   *
   * One `groupBy` carries both vendor cards: `_count._all` per status sums to
   * the catalog, and `_count.organizationId` (a NULLABLE column, so `_count`
   * counts non-null values) is "has an Organization". Splitting by `status`
   * costs nothing and lets "Onboarded" mean exactly what the Status column
   * badges "Onboarded" — active AND organization-backed — rather than a second,
   * looser definition of the same word one row up the page.
   *
   * `status` deliberately gets no card of its own: it is `@default("active")`
   * that ingestion never sets, so it reports 200 of 200 (see vendor-columns.tsx).
   */
  const [statusGroups, searchMatchTotal, repTotal, contractTotal] =
    await Promise.all([
      prisma.vendor.groupBy({
        by: ["status"],
        _count: { _all: true, organizationId: true },
        where: baseWhere,
      }),
      // Only a second round trip when a search narrows the rows; without one
      // the two scopes are the same number by definition.
      search ? prisma.vendor.count({ where }) : undefined,
      prisma.vendorDivision.count({ where: { vendor: { is: baseWhere } } }),
      prisma.contract.count({ where: { vendor: { is: baseWhere } } }),
    ])

  const catalogTotal = statusGroups.reduce((sum, g) => sum + g._count._all, 0)
  const onboardedTotal =
    statusGroups.find((g) => g.status === "active")?._count.organizationId ?? 0
  const total = searchMatchTotal ?? catalogTotal

  /**
   * The rows come AFTER the count, not alongside it, because the page has to be
   * clamped into range before it can be read. Deleting the last vendor on the
   * last page, or narrowing the search, otherwise strands the operator on an
   * empty page that the pager still says exists.
   */
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(Math.trunc(input.page ?? 1), 1), pageCount)

  const vendors = await prisma.vendor.findMany({
    where,
    include: { _count: { select: { contracts: true, divisions: true } } },
    orderBy: { name: "asc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  return serialize({
    vendors: vendors.map((v) => ({
      id: v.id,
      name: v.name,
      code: v.code,
      // A tenant with no Organization cannot have Members, so it cannot have
      // users. Surfaced so the Access picker can disable it with a reason
      // rather than failing at submit (audit 2026-07-26).
      canHaveUsers: v.organizationId !== null,
      contactName: v.contactName,
      contactEmail: v.contactEmail,
      status: v.status,
      tier: v.tier,
      contractCount: v._count.contracts,
      repCount: v._count.divisions,
      createdAt: v.createdAt.toISOString(),
    })),
    total,
    catalogTotal,
    onboardedTotal,
    repTotal,
    contractTotal,
    page,
    pageSize,
    pageCount,
    search,
  })
}

// ─── Create Vendor ──────────────────────────────────────────────

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

export async function adminCreateVendor(input: AdminCreateVendorInput) {
  const session = await requireAdmin()

  // Organization + tenant row land together — a tenant with no organization
  // cannot have users at all (see provisionOrganization).
  const vendor = await prisma.$transaction(async (tx) => {
    const organizationId = await provisionOrganization(tx, input.name)
    return tx.vendor.create({ data: { ...input, organizationId } })
  })

  await logAudit({
    userId: session.user.id,
    action: "vendor.created",
    entityType: "vendor",
    entityId: vendor.id,
    metadata: { name: vendor.name },
  })

  return serialize(vendor)
}

// ─── Update Vendor ──────────────────────────────────────────────

export async function adminUpdateVendor(id: string, input: AdminUpdateVendorInput) {
  await requireAdmin()

  const vendor = await prisma.vendor.update({ where: { id }, data: input })
  return serialize(vendor)
}

// ─── Delete Vendor ──────────────────────────────────────────────

/**
 * Same shape as adminDeleteFacility (audit 2026-07-26). Vendor FKs split:
 *   RESTRICT  contract, invoice, purchase_order, pricing_file, connection,
 *             vendor_cog_record  -> raw Prisma FK error reached the operator
 *   SET NULL  cog_record, alert, ai_credit, file_import, product_benchmark,
 *             vendor_name_mapping -> silently orphans COG spend, which then
 *             stops attributing to any vendor
 *   CASCADE   pending_contract, vendor_division
 */
export async function adminDeleteVendor(id: string) {
  const session = await requireAdmin()

  const [contracts, cogRecords, invoices, pos] = await Promise.all([
    prisma.contract.count({ where: { vendorId: id } }),
    prisma.cOGRecord.count({ where: { vendorId: id } }),
    prisma.invoice.count({ where: { vendorId: id } }),
    prisma.purchaseOrder.count({ where: { vendorId: id } }),
  ])

  const blocking = [
    contracts && `${contracts} contract(s)`,
    cogRecords && `${cogRecords} COG record(s)`,
    invoices && `${invoices} invoice(s)`,
    pos && `${pos} purchase order(s)`,
  ].filter(Boolean) as string[]

  if (blocking.length > 0) {
    throw new Error(
      `This vendor still has ${blocking.join(", ")}. Deleting it would ` +
        `orphan or destroy that data. Move or remove it first.`,
    )
  }

  const target = await prisma.vendor.findUnique({
    where: { id },
    select: { name: true },
  })

  await prisma.vendor.delete({ where: { id } })

  await logAudit({
    userId: session.user.id,
    action: "vendor.deleted",
    entityType: "vendor",
    entityId: id,
    metadata: { name: target?.name },
  })
}

export interface TenantOption {
  id: string
  name: string
  /** False when the tenant has no Organization, so it cannot have users. */
  canHaveUsers: boolean
}

/**
 * Every vendor, unpaginated, for the user-creation Access picker.
 *
 * Charles 2026-07-28: "when you pick vendor it does not let the vendors be
 * accurate and it does not let you scroll the vendor name list" — creating a
 * vendor user was impossible while facility users worked fine.
 *
 * The picker called `adminGetVendors({})`, which defaults to `pageSize: 20`, so
 * it only ever received the first 20 vendors ALPHABETICALLY. Production has 201
 * vendors of which exactly two have an Organization and can therefore hold
 * users: "asfd" (rank 19) and "Stryker" (rank 169). The picker showed 20 rows —
 * 19 of them disabled "no organization yet" — and Stryker, the only real target,
 * was never in the list. Scrolling dead-ended at 20 because 20 was all there was.
 * Facilities were unaffected purely because there are only three of them, which
 * is why the bug looked like "vendor is broken, facility works".
 *
 * A picker must not paginate. This returns id/name/canHaveUsers only, so the
 * full catalog stays a small payload.
 */
export async function adminGetVendorOptions(): Promise<TenantOption[]> {
  await requireAdmin()
  const vendors = await prisma.vendor.findMany({
    select: { id: true, name: true, organizationId: true },
    orderBy: { name: "asc" },
  })
  return vendors.map((v) => ({
    id: v.id,
    name: v.name,
    canHaveUsers: v.organizationId !== null,
  }))
}
