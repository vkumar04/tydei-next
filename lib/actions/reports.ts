"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

// ─── Contracts List (for report selector) ───────────────────────

export async function getContracts(facilityId: string) {
  await requireFacility()

  const contracts = await prisma.contract.findMany({
    where: {
      facilityId,
      status: { in: ["active", "expiring"] },
    },
    include: {
      vendor: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  })

  return serialize(
    contracts.map((c) => ({
      id: c.id,
      name: c.name,
      contractType: c.contractType,
      status: c.status,
      vendorId: c.vendor.id,
      vendorName: c.vendor.name,
    }))
  )
}

// ─── Report Data ─────────────────────────────────────────────────

export async function getReportData(input: {
  facilityId: string
  reportType: "usage" | "service" | "tie_in" | "capital" | "grouped"
  dateFrom: string
  dateTo: string
}) {
  await requireFacility()
  const { facilityId, reportType, dateFrom, dateTo } = input

  const contracts = await prisma.contract.findMany({
    where: {
      facilityId,
      contractType: reportType === "grouped" ? "grouped" : reportType,
      status: { in: ["active", "expiring"] },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      periods: {
        where: {
          periodStart: { gte: new Date(dateFrom) },
          periodEnd: { lte: new Date(dateTo) },
        },
        orderBy: { periodStart: "asc" },
      },
    },
    orderBy: { name: "asc" },
  })

  return serialize({
    contracts: contracts.map((c) => ({
      id: c.id,
      name: c.name,
      vendor: c.vendor.name,
      vendorId: c.vendor.id,
      contractType: c.contractType,
      totalValue: Number(c.totalValue),
      periods: c.periods.map((p) => ({
        id: p.id,
        periodStart: p.periodStart.toISOString(),
        periodEnd: p.periodEnd.toISOString(),
        totalSpend: Number(p.totalSpend),
        totalVolume: p.totalVolume,
        rebateEarned: Number(p.rebateEarned),
        rebateCollected: Number(p.rebateCollected),
        paymentExpected: Number(p.paymentExpected),
        paymentActual: Number(p.paymentActual),
        tierAchieved: p.tierAchieved,
      })),
    })),
    reportType,
    dateFrom,
    dateTo,
  })
}

// ─── Contract Period Data ────────────────────────────────────────

export async function getContractPeriodData(input: {
  contractId: string
  dateFrom?: string
  dateTo?: string
}) {
  await requireFacility()
  const { contractId, dateFrom, dateTo } = input

  const where: Record<string, unknown> = { contractId }
  if (dateFrom) where.periodStart = { gte: new Date(dateFrom) }
  if (dateTo) where.periodEnd = { lte: new Date(dateTo) }

  const periods = await prisma.contractPeriod.findMany({
    where,
    orderBy: { periodStart: "asc" },
  })

  return serialize(periods.map((p) => ({
    id: p.id,
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
    totalSpend: Number(p.totalSpend),
    totalVolume: p.totalVolume,
    rebateEarned: Number(p.rebateEarned),
    rebateCollected: Number(p.rebateCollected),
    paymentExpected: Number(p.paymentExpected),
    paymentActual: Number(p.paymentActual),
    tierAchieved: p.tierAchieved,
  })))
}

// ─── Export CSV ──────────────────────────────────────────────────

export async function exportReportCSV(input: {
  facilityId: string
  reportType: string
  dateFrom: string
  dateTo: string
}) {
  const report = await getReportData({
    ...input,
    reportType: input.reportType as "usage" | "service" | "tie_in" | "capital" | "grouped",
  })

  const headers = [
    "Contract", "Vendor", "Period Start", "Period End",
    "Spend", "Volume", "Rebate Earned", "Rebate Collected",
    "Payment Expected", "Payment Actual", "Tier",
  ]

  const rows = report.contracts.flatMap((c) =>
    c.periods.map((p) =>
      [
        c.name, c.vendor, p.periodStart.split("T")[0], p.periodEnd.split("T")[0],
        p.totalSpend, p.totalVolume, p.rebateEarned, p.rebateCollected,
        p.paymentExpected, p.paymentActual, p.tierAchieved ?? "",
      ].join(",")
    )
  )

  return [headers.join(","), ...rows].join("\n")
}

// ─── Price Discrepancies ─────────────────────────────────────────

export async function getPriceDiscrepancies(facilityId: string) {
  await requireFacility()

  const lineItems = await prisma.invoiceLineItem.findMany({
    where: {
      invoice: { facilityId },
      isFlagged: false,
      variancePercent: { not: null },
    },
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNumber: true,
          vendor: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { variancePercent: "desc" },
    take: 100,
  })

  return serialize(lineItems.map((li) => ({
    id: li.id,
    invoiceId: li.invoice.id,
    invoiceNumber: li.invoice.invoiceNumber,
    vendorName: li.invoice.vendor.name,
    vendorId: li.invoice.vendor.id,
    itemDescription: li.inventoryDescription,
    vendorItemNo: li.vendorItemNo,
    invoicePrice: Number(li.invoicePrice),
    contractPrice: li.contractPrice ? Number(li.contractPrice) : null,
    variancePercent: li.variancePercent ? Number(li.variancePercent) : null,
    quantity: li.invoiceQuantity,
    totalLineCost: Number(li.totalLineCost),
    isFlagged: li.isFlagged,
  })))
}
