"use server"

import { prisma } from "@/lib/db"
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

export async function adminCreateVendor(input: AdminCreateVendorInput) {
  await requireAdmin()

  const vendor = await prisma.vendor.create({ data: input })
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
