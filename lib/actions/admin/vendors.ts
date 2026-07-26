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

export async function adminGetVendors(input: {
  search?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ vendors: AdminVendorRow[]; total: number }> {
  await requireAdmin()
  const { search, status, page = 1, pageSize = 20 } = input

  const where: Record<string, unknown> = {}
  if (search) where.name = { contains: search, mode: "insensitive" }
  if (status) where.status = status

  const [vendors, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      include: { _count: { select: { contracts: true, divisions: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.vendor.count({ where }),
  ])

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
