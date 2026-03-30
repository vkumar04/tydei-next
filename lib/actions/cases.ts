"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import type { CaseInput, CaseSupplyInput } from "@/lib/validators/cases"
import { serialize } from "@/lib/serialize"

// ─── Types ──────────────────────────────────────────────────────

export interface CaseWithRelations {
  id: string
  caseNumber: string
  surgeonName: string | null
  dateOfSurgery: string
  primaryCptCode: string | null
  totalSpend: number
  totalReimbursement: number
  margin: number
  complianceStatus: string
  procedureCount: number
  supplyCount: number
}

export interface CaseDetail {
  id: string
  caseNumber: string
  surgeonName: string | null
  dateOfSurgery: string
  primaryCptCode: string | null
  timeInOr: string | null
  timeOutOr: string | null
  totalSpend: number
  totalReimbursement: number
  margin: number
  complianceStatus: string
  procedures: { id: string; cptCode: string; description: string | null }[]
  supplies: {
    id: string
    materialName: string
    vendorItemNo: string | null
    usedCost: number
    quantity: number
    extendedCost: number
    isOnContract: boolean
  }[]
}

export interface SurgeonScorecard {
  surgeonName: string
  caseCount: number
  totalSpend: number
  avgSpendPerCase: number
  totalReimbursement: number
  totalMargin: number
  avgMargin: number
  marginPercent: number
  complianceRate: number
  onContractPercent: number
  trend: "up" | "down"
  topProcedures: { cptCode: string; count: number }[]
}

export interface CPTCodeAnalysis {
  cptCode: string
  description: string | null
  caseCount: number
  avgCost: number
  minCost: number
  maxCost: number
  surgeonBreakdown: { surgeonName: string; avgCost: number; count: number }[]
}

export interface SurgeonComparison {
  surgeons: string[]
  dimensions: {
    label: string
    key: string
    values: Record<string, number>
  }[]
  barData: {
    metric: string
    values: Record<string, number>
  }[]
}

export interface CaseCostingReport {
  totalCases: number
  totalSpend: number
  avgCostPerCase: number
  totalReimbursement: number
  avgMargin: number
  complianceRate: number
  monthlyCosts: { month: string; spend: number; reimbursement: number }[]
  topSurgeons: { name: string; cases: number; spend: number }[]
}

// ─── Get Cases ──────────────────────────────────────────────────

export async function getCases(input: {
  facilityId: string
  surgeonName?: string
  dateFrom?: string
  dateTo?: string
  cptCode?: string
  page?: number
  pageSize?: number
}): Promise<{ cases: CaseWithRelations[]; total: number }> {
  await requireFacility()

  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 20

  const where = {
    facilityId: input.facilityId,
    ...(input.surgeonName && { surgeonName: { contains: input.surgeonName, mode: "insensitive" as const } }),
    ...(input.cptCode && { primaryCptCode: input.cptCode }),
    ...(input.dateFrom || input.dateTo
      ? {
          dateOfSurgery: {
            ...(input.dateFrom && { gte: new Date(input.dateFrom) }),
            ...(input.dateTo && { lte: new Date(input.dateTo) }),
          },
        }
      : {}),
  }

  const [records, total] = await Promise.all([
    prisma.case.findMany({
      where,
      include: {
        procedures: { select: { id: true } },
        supplies: { select: { id: true } },
      },
      orderBy: { dateOfSurgery: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.case.count({ where }),
  ])

  return serialize({
    cases: records.map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber,
      surgeonName: c.surgeonName,
      dateOfSurgery: c.dateOfSurgery.toISOString().slice(0, 10),
      primaryCptCode: c.primaryCptCode,
      totalSpend: Number(c.totalSpend),
      totalReimbursement: Number(c.totalReimbursement),
      margin: Number(c.margin),
      complianceStatus: c.complianceStatus,
      procedureCount: c.procedures.length,
      supplyCount: c.supplies.length,
    })),
    total,
  })
}

// ─── Get Single Case ────────────────────────────────────────────

export async function getCase(id: string): Promise<CaseDetail> {
  await requireFacility()

  const c = await prisma.case.findUniqueOrThrow({
    where: { id },
    include: {
      procedures: true,
      supplies: true,
    },
  })

  return serialize({
    id: c.id,
    caseNumber: c.caseNumber,
    surgeonName: c.surgeonName,
    dateOfSurgery: c.dateOfSurgery.toISOString().slice(0, 10),
    primaryCptCode: c.primaryCptCode,
    timeInOr: c.timeInOr,
    timeOutOr: c.timeOutOr,
    totalSpend: Number(c.totalSpend),
    totalReimbursement: Number(c.totalReimbursement),
    margin: Number(c.margin),
    complianceStatus: c.complianceStatus,
    procedures: c.procedures.map((p) => ({
      id: p.id,
      cptCode: p.cptCode,
      description: p.procedureDescription,
    })),
    supplies: c.supplies.map((s) => ({
      id: s.id,
      materialName: s.materialName,
      vendorItemNo: s.vendorItemNo,
      usedCost: Number(s.usedCost),
      quantity: s.quantity,
      extendedCost: Number(s.extendedCost),
      isOnContract: s.isOnContract,
    })),
  })
}

// ─── Import Cases ───────────────────────────────────────────────

export async function importCases(input: {
  facilityId: string
  cases: CaseInput[]
}): Promise<{ imported: number; errors: number }> {
  await requireFacility()

  let imported = 0
  let errors = 0

  for (const caseData of input.cases) {
    try {
      const spend = caseData.totalSpend
      const reimburse = caseData.totalReimbursement ?? 0

      await prisma.case.create({
        data: {
          caseNumber: caseData.caseNumber,
          facilityId: input.facilityId,
          surgeonName: caseData.surgeonName,
          surgeonId: caseData.surgeonId,
          dateOfSurgery: new Date(caseData.dateOfSurgery),
          primaryCptCode: caseData.primaryCptCode,
          totalSpend: spend,
          totalReimbursement: reimburse,
          margin: reimburse - spend,
          timeInOr: caseData.timeInOr,
          timeOutOr: caseData.timeOutOr,
        },
      })
      imported++
    } catch {
      errors++
    }
  }

  return { imported, errors }
}

// ─── Import Case Supplies ───────────────────────────────────────

export async function importCaseSupplies(input: {
  caseId: string
  supplies: CaseSupplyInput[]
}): Promise<{ imported: number; matched: number }> {
  await requireFacility()

  let imported = 0
  let matched = 0

  for (const supply of input.supplies) {
    const extCost = supply.usedCost * (supply.quantity ?? 1)
    await prisma.caseSupply.create({
      data: {
        caseId: input.caseId,
        materialName: supply.materialName,
        vendorItemNo: supply.vendorItemNo,
        usedCost: supply.usedCost,
        quantity: supply.quantity ?? 1,
        extendedCost: extCost,
        isOnContract: supply.isOnContract ?? false,
        contractId: supply.contractId,
      },
    })
    imported++
    if (supply.isOnContract) matched++
  }

  return { imported, matched }
}

// ─── Surgeon Scorecards ─────────────────────────────────────────

export async function getSurgeonScorecards(
  facilityId: string
): Promise<SurgeonScorecard[]> {
  await requireFacility()

  const cases = await prisma.case.findMany({
    where: { facilityId, surgeonName: { not: null } },
    include: {
      procedures: { select: { cptCode: true } },
      supplies: { select: { isOnContract: true, extendedCost: true } },
    },
  })

  const surgeonMap = new Map<
    string,
    {
      cases: typeof cases
      totalSpend: number
      totalReimbursement: number
      totalMargin: number
      compliant: number
      onContract: number
      totalSupplies: number
      cptCounts: Map<string, number>
    }
  >()

  for (const c of cases) {
    const name = c.surgeonName!
    if (!surgeonMap.has(name)) {
      surgeonMap.set(name, {
        cases: [],
        totalSpend: 0,
        totalReimbursement: 0,
        totalMargin: 0,
        compliant: 0,
        onContract: 0,
        totalSupplies: 0,
        cptCounts: new Map(),
      })
    }
    const entry = surgeonMap.get(name)!
    entry.cases.push(c)
    entry.totalSpend += Number(c.totalSpend)
    entry.totalReimbursement += Number(c.totalReimbursement)
    entry.totalMargin += Number(c.margin)
    if (c.complianceStatus === "compliant") entry.compliant++

    for (const s of c.supplies) {
      entry.totalSupplies++
      if (s.isOnContract) entry.onContract++
    }

    for (const p of c.procedures) {
      entry.cptCounts.set(p.cptCode, (entry.cptCounts.get(p.cptCode) ?? 0) + 1)
    }
  }

  return serialize(Array.from(surgeonMap.entries()).map(([name, data]) => {
    const caseCount = data.cases.length
    const topProcedures = Array.from(data.cptCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cptCode, count]) => ({ cptCode, count }))

    const marginPercent =
      data.totalReimbursement > 0
        ? (data.totalMargin / data.totalReimbursement) * 100
        : 0

    return {
      surgeonName: name,
      caseCount,
      totalSpend: data.totalSpend,
      avgSpendPerCase: caseCount > 0 ? data.totalSpend / caseCount : 0,
      totalReimbursement: data.totalReimbursement,
      totalMargin: data.totalMargin,
      avgMargin: caseCount > 0 ? data.totalMargin / caseCount : 0,
      marginPercent: Math.round(marginPercent * 10) / 10,
      complianceRate: caseCount > 0 ? (data.compliant / caseCount) * 100 : 0,
      onContractPercent:
        data.totalSupplies > 0
          ? (data.onContract / data.totalSupplies) * 100
          : 0,
      trend: (marginPercent >= 25 ? "up" : "down") as "up" | "down",
      topProcedures,
    }
  }))
}

// ─── CPT Analysis ───────────────────────────────────────────────

export async function getCPTAnalysis(
  facilityId: string
): Promise<CPTCodeAnalysis[]> {
  await requireFacility()

  const cases = await prisma.case.findMany({
    where: { facilityId, primaryCptCode: { not: null } },
    select: {
      primaryCptCode: true,
      surgeonName: true,
      totalSpend: true,
    },
  })

  const cptMap = new Map<
    string,
    { costs: number[]; surgeons: Map<string, { total: number; count: number }> }
  >()

  for (const c of cases) {
    const code = c.primaryCptCode!
    if (!cptMap.has(code)) {
      cptMap.set(code, { costs: [], surgeons: new Map() })
    }
    const entry = cptMap.get(code)!
    const cost = Number(c.totalSpend)
    entry.costs.push(cost)

    if (c.surgeonName) {
      const surgeon = entry.surgeons.get(c.surgeonName) ?? { total: 0, count: 0 }
      surgeon.total += cost
      surgeon.count++
      entry.surgeons.set(c.surgeonName, surgeon)
    }
  }

  return serialize(Array.from(cptMap.entries())
    .map(([code, data]) => ({
      cptCode: code,
      description: null,
      caseCount: data.costs.length,
      avgCost: data.costs.reduce((a, b) => a + b, 0) / data.costs.length,
      minCost: Math.min(...data.costs),
      maxCost: Math.max(...data.costs),
      surgeonBreakdown: Array.from(data.surgeons.entries()).map(
        ([surgeonName, s]) => ({
          surgeonName,
          avgCost: s.total / s.count,
          count: s.count,
        })
      ),
    }))
    .sort((a, b) => b.caseCount - a.caseCount))
}

// ─── Compare Surgeons ───────────────────────────────────────────

export async function compareSurgeons(input: {
  facilityId: string
  surgeonNames: string[]
  cptCode?: string
}): Promise<SurgeonComparison> {
  await requireFacility()

  const scorecards = await getSurgeonScorecards(input.facilityId)
  const selected = scorecards.filter((s) =>
    input.surgeonNames.includes(s.surgeonName)
  )

  const maxSpend = Math.max(...selected.map((s) => s.avgSpendPerCase), 1)
  const maxCases = Math.max(...selected.map((s) => s.caseCount), 1)

  const dimensions = [
    {
      label: "Cost Efficiency",
      key: "costEfficiency",
      values: Object.fromEntries(
        selected.map((s) => [
          s.surgeonName,
          Math.round(100 - (s.avgSpendPerCase / maxSpend) * 100),
        ])
      ),
    },
    {
      label: "Volume",
      key: "volume",
      values: Object.fromEntries(
        selected.map((s) => [
          s.surgeonName,
          Math.round((s.caseCount / maxCases) * 100),
        ])
      ),
    },
    {
      label: "Compliance",
      key: "compliance",
      values: Object.fromEntries(
        selected.map((s) => [s.surgeonName, Math.round(s.complianceRate)])
      ),
    },
    {
      label: "On-Contract",
      key: "onContract",
      values: Object.fromEntries(
        selected.map((s) => [s.surgeonName, Math.round(s.onContractPercent)])
      ),
    },
  ]

  const barData = [
    {
      metric: "Avg Spend/Case",
      values: Object.fromEntries(
        selected.map((s) => [s.surgeonName, Math.round(s.avgSpendPerCase)])
      ),
    },
    {
      metric: "Total Cases",
      values: Object.fromEntries(
        selected.map((s) => [s.surgeonName, s.caseCount])
      ),
    },
    {
      metric: "Compliance %",
      values: Object.fromEntries(
        selected.map((s) => [s.surgeonName, Math.round(s.complianceRate)])
      ),
    },
  ]

  return serialize({ surgeons: input.surgeonNames, dimensions, barData })
}

// ─── Case Costing Report ────────────────────────────────────────

export async function getCaseCostingReportData(input: {
  facilityId: string
  surgeonName?: string
  contractId?: string
  dateFrom?: string
  dateTo?: string
}): Promise<CaseCostingReport> {
  await requireFacility()

  const where = {
    facilityId: input.facilityId,
    ...(input.surgeonName && { surgeonName: input.surgeonName }),
    ...(input.dateFrom || input.dateTo
      ? {
          dateOfSurgery: {
            ...(input.dateFrom && { gte: new Date(input.dateFrom) }),
            ...(input.dateTo && { lte: new Date(input.dateTo) }),
          },
        }
      : {}),
  }

  const cases = await prisma.case.findMany({
    where,
    orderBy: { dateOfSurgery: "asc" },
  })

  const totalCases = cases.length
  const totalSpend = cases.reduce((s, c) => s + Number(c.totalSpend), 0)
  const totalReimbursement = cases.reduce(
    (s, c) => s + Number(c.totalReimbursement),
    0
  )
  const compliant = cases.filter(
    (c) => c.complianceStatus === "compliant"
  ).length

  // Monthly breakdown
  const monthlyMap = new Map<string, { spend: number; reimbursement: number }>()
  for (const c of cases) {
    const month = c.dateOfSurgery.toISOString().slice(0, 7)
    const entry = monthlyMap.get(month) ?? { spend: 0, reimbursement: 0 }
    entry.spend += Number(c.totalSpend)
    entry.reimbursement += Number(c.totalReimbursement)
    monthlyMap.set(month, entry)
  }

  // Top surgeons
  const surgeonMap = new Map<string, { cases: number; spend: number }>()
  for (const c of cases) {
    if (!c.surgeonName) continue
    const entry = surgeonMap.get(c.surgeonName) ?? { cases: 0, spend: 0 }
    entry.cases++
    entry.spend += Number(c.totalSpend)
    surgeonMap.set(c.surgeonName, entry)
  }

  return serialize({
    totalCases,
    totalSpend,
    avgCostPerCase: totalCases > 0 ? totalSpend / totalCases : 0,
    totalReimbursement,
    avgMargin:
      totalCases > 0
        ? (totalReimbursement - totalSpend) / totalCases
        : 0,
    complianceRate: totalCases > 0 ? (compliant / totalCases) * 100 : 0,
    monthlyCosts: Array.from(monthlyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => ({ month, ...data })),
    topSurgeons: Array.from(surgeonMap.entries())
      .sort(([, a], [, b]) => b.spend - a.spend)
      .slice(0, 10)
      .map(([name, data]) => ({ name, ...data })),
  })
}
