"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import { contractsOwnedByVendor } from "@/lib/actions/contracts-vendor-auth"
import { serialize } from "@/lib/serialize"
import { rateLimit } from "@/lib/rate-limit"

export interface SearchResult {
  id: string
  name: string
  description: string | null
  href: string
  type:
    | "contract"
    | "vendor"
    | "alert"
    | "purchase_order"
    | "invoice"
    | "report"
    | "category"
    | "cog_item"
}

export interface GroupedSearchResults {
  contracts: SearchResult[]
  vendors: SearchResult[]
  alerts: SearchResult[]
  purchaseOrders: SearchResult[]
  invoices: SearchResult[]
  reports: SearchResult[]
  categories: SearchResult[]
  cogItems: SearchResult[]
}

export async function globalSearch(query: string): Promise<GroupedSearchResults> {
  const session = await requireAuth()

  // DoS amplification guard: each call fans out into ~8 parallel scans.
  const { success } = rateLimit(`search:${session.user.id}`, 30, 60_000)
  if (!success) {
    throw new Error("Too many requests, try again shortly.")
  }

  const trimmed = query.trim()
  if (!trimmed || trimmed.length < 2) {
    return {
      contracts: [],
      vendors: [],
      alerts: [],
      purchaseOrders: [],
      invoices: [],
      reports: [],
      categories: [],
      cogItems: [],
    }
  }

  // Scope results to user's facility or vendor
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true, vendor: true } } },
  })
  const facilityId = member?.organization?.facility?.id
  const vendorId = member?.organization?.vendor?.id
  // A vendor-portal caller has a vendor scope and no facility. Used to route
  // results (e.g. invoices) to the vendor surfaces rather than the facility ones.
  const isVendorPortal = !facilityId && Boolean(vendorId)

  const search = { contains: trimmed, mode: "insensitive" as const }

  // Per-source resilience: one failing query must NOT reject the whole
  // Promise.all and blank every result group. Wrap each source so a failure
  // degrades that group to [] and is logged, instead of taking down search.
  // (A stale `sku` field on the COG query did exactly that — silently.)
  const safe = <T>(p: Promise<T[]>, label: string): Promise<T[]> =>
    p.catch((err) => {
      console.error(`[globalSearch] ${label} query failed`, err)
      return []
    })

  const [contracts, vendors, alerts, purchaseOrders, invoices, reports, categories, cogItems] = await Promise.all([
    safe(prisma.contract.findMany({
      // AND-combine the ownership scope with the text-search OR so the two
      // OR clauses don't collide. Vendor scope uses contractsOwnedByVendor so
      // grouped contracts where the vendor is only in additionalVendorIds are
      // included (group-vendor-drift invariant — never bare { vendorId }).
      where: {
        AND: [
          facilityId
            ? { facilityId }
            : vendorId
              ? contractsOwnedByVendor(vendorId)
              : {},
          {
            OR: [
              { name: search },
              { contractNumber: search },
              { description: search },
            ],
          },
        ],
      },
      select: {
        id: true,
        name: true,
        contractNumber: true,
        status: true,
        vendor: { select: { name: true } },
      },
      take: 5,
      orderBy: { updatedAt: "desc" },
    }), "contracts"),

    safe(prisma.vendor.findMany({
      where: {
        OR: [
          { name: search },
          { displayName: search },
          { code: search },
        ],
      },
      select: { id: true, name: true, displayName: true, division: true },
      take: 5,
      orderBy: { name: "asc" },
    }), "vendors"),

    safe(prisma.alert.findMany({
      where: {
        ...(facilityId ? { facilityId } : vendorId ? { vendorId } : {}),
        OR: [
          { title: search },
          { description: search },
        ],
      },
      select: { id: true, title: true, description: true, severity: true, portalType: true },
      take: 5,
      orderBy: { createdAt: "desc" },
    }), "alerts"),

    safe(prisma.purchaseOrder.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        OR: [
          { poNumber: search },
        ],
      },
      select: {
        id: true,
        poNumber: true,
        status: true,
        totalCost: true,
        vendor: { select: { name: true } },
      },
      take: 5,
      orderBy: { createdAt: "desc" },
    }), "purchaseOrders"),

    safe(prisma.invoice.findMany({
      where: {
        ...(facilityId ? { facilityId } : vendorId ? { vendorId } : {}),
        OR: [
          { invoiceNumber: search },
        ],
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        totalInvoiceCost: true,
        vendor: { select: { name: true } },
      },
      take: 5,
      orderBy: { createdAt: "desc" },
    }), "invoices"),

    // Scheduled reports — facility-scoped only. Filter on enum reportType.
    facilityId
      ? safe(prisma.reportSchedule.findMany({
          where: { facilityId },
          select: {
            id: true,
            reportType: true,
            frequency: true,
          },
          take: 25,
          orderBy: { updatedAt: "desc" },
        }), "reports")
      : Promise.resolve([]),

    // Product categories — global taxonomy.
    safe(prisma.productCategory.findMany({
      where: { OR: [{ name: search }, { description: search }] },
      select: { id: true, name: true, description: true },
      take: 5,
      orderBy: { name: "asc" },
    }), "categories"),

    // COG items — facility-scoped, by vendorItemNo + description.
    facilityId
      ? safe(prisma.cOGRecord.findMany({
          where: {
            facilityId,
            OR: [
              { vendorItemNo: search },
              { inventoryDescription: search },
              { manufacturerNo: search },
              { inventoryNumber: search },
            ],
          },
          select: {
            id: true,
            vendorItemNo: true,
            inventoryDescription: true,
            vendorName: true,
          },
          take: 5,
          orderBy: { transactionDate: "desc" },
          distinct: ["vendorItemNo"],
        }), "cogItems")
      : Promise.resolve([]),
  ])

  return serialize({
    contracts: contracts.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.contractNumber
        ? `${c.vendor.name} - ${c.contractNumber}`
        : c.vendor.name,
      href: `/dashboard/contracts/${c.id}`,
      type: "contract" as const,
    })),
    vendors: vendors.map((v) => ({
      id: v.id,
      name: v.displayName || v.name,
      description: v.division,
      href: `/dashboard/contracts?search=${encodeURIComponent(v.name)}`,
      type: "vendor" as const,
    })),
    alerts: alerts.map((a) => ({
      id: a.id,
      name: a.title,
      description: a.description,
      href: a.portalType === "vendor"
        ? `/vendor/alerts/${a.id}`
        : `/dashboard/alerts/${a.id}`,
      type: "alert" as const,
    })),
    purchaseOrders: purchaseOrders.map((po) => ({
      id: po.id,
      name: `PO ${po.poNumber}`,
      description: po.vendor.name,
      href: `/dashboard/purchase-orders/${po.id}`,
      type: "purchase_order" as const,
    })),
    invoices: invoices.map((inv) => ({
      id: inv.id,
      name: `Invoice ${inv.invoiceNumber}`,
      description: inv.vendor.name,
      // Deep-link to the invoice itself. Facility has a detail route; the
      // vendor side is a list only, so route vendor-portal hits there.
      href: isVendorPortal
        ? `/vendor/invoices`
        : `/dashboard/invoice-validation/${inv.id}`,
      type: "invoice" as const,
    })),
    reports: reports
      .filter((r) =>
        `${r.reportType} ${r.frequency}`
          .toLowerCase()
          .includes(trimmed.toLowerCase()),
      )
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        name: r.reportType.replace(/_/g, " "),
        description: `${r.frequency.toLowerCase()} schedule`,
        href: `/dashboard/reports`,
        type: "report" as const,
      })),
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      href: `/dashboard/cog?category=${encodeURIComponent(c.name)}`,
      type: "category" as const,
    })),
    cogItems: cogItems.map((i) => ({
      id: i.id,
      name: i.vendorItemNo
        ? `${i.vendorItemNo} — ${i.inventoryDescription ?? ""}`.trim()
        : i.inventoryDescription ?? "(no description)",
      description: i.vendorName,
      href: `/dashboard/cog?search=${encodeURIComponent(i.vendorItemNo ?? "")}`,
      type: "cog_item" as const,
    })),
  })
}
