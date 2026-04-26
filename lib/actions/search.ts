"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

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

  const search = { contains: trimmed, mode: "insensitive" as const }

  const [contracts, vendors, alerts, purchaseOrders, invoices, reports, categories, cogItems] = await Promise.all([
    prisma.contract.findMany({
      where: {
        ...(facilityId ? { facilityId } : vendorId ? { vendorId } : {}),
        OR: [
          { name: search },
          { contractNumber: search },
          { description: search },
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
    }),

    prisma.vendor.findMany({
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
    }),

    prisma.alert.findMany({
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
    }),

    prisma.purchaseOrder.findMany({
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
    }),

    prisma.invoice.findMany({
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
    }),

    // Scheduled reports — facility-scoped only. Filter on enum reportType.
    facilityId
      ? prisma.reportSchedule.findMany({
          where: { facilityId },
          select: {
            id: true,
            reportType: true,
            frequency: true,
          },
          take: 25,
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve([]),

    // Product categories — global taxonomy.
    prisma.productCategory.findMany({
      where: { OR: [{ name: search }, { description: search }] },
      select: { id: true, name: true, description: true },
      take: 5,
      orderBy: { name: "asc" },
    }),

    // COG items — facility-scoped, by vendorItemNo + description.
    facilityId
      ? prisma.cOGRecord.findMany({
          where: {
            facilityId,
            OR: [
              { vendorItemNo: search },
              { inventoryDescription: search },
              { sku: search },
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
        })
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
      href: `/dashboard/invoice-validation`,
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
