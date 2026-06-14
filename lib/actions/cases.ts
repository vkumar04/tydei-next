"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import type { CaseInput, CaseSupplyInput } from "@/lib/validators/cases"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import {
  buildCptRateMap,
  resolveCaseReimbursement,
} from "@/lib/case-costing/cpt-rate-map"

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
  // v0 doc §8 surgeon score inputs (Tier-3 #20). Null when no cases
  // have demographics filled in. Avg case time is in minutes.
  payorMixPct: number | null
  bmiUnder40Pct: number | null
  ageUnder65Pct: number | null
  avgCaseTimeMinutes: number | null
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
  facilityId?: string
  surgeonName?: string
  dateFrom?: string
  dateTo?: string
  cptCode?: string
  page?: number
  pageSize?: number
}): Promise<{ cases: CaseWithRelations[]; total: number }> {
  const { facility } = await requireFacility()

  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 20

  const where = {
    facilityId: facility.id,
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

  const [records, total, payorContracts] = await Promise.all([
    prisma.case.findMany({
      where,
      include: {
        procedures: { select: { id: true, cptCode: true } },
        supplies: { select: { id: true } },
      },
      orderBy: { dateOfSurgery: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.case.count({ where }),
    // Live payor-contract CPT rate lookup. Build a single CPT → best-rate
    // map from every active facility payor contract so every case row can
    // compute its expected reimbursement without the user manually
    // selecting a payor. Overrides Case.totalReimbursement (which is 0 in
    // most seed states) when we have a rate match.
    prisma.payorContract.findMany({
      where: { facilityId: facility.id, status: "active" },
      select: { cptRates: true },
    }),
  ])

  // Canonical CPT-rate map (audit H5) — shared with the facility-averages
  // hero, payor-margin calculator, and the case-costing report so every
  // surface backfills reimbursement identically.
  const cptRateMap = buildCptRateMap(payorContracts)

  return serialize({
    cases: records.map((c) => {
      const effectiveReimbursement = resolveCaseReimbursement(
        {
          storedReimbursement: Number(c.totalReimbursement),
          primaryCptCode: c.primaryCptCode,
          procedureCptCodes: c.procedures.map((p) => p.cptCode),
        },
        cptRateMap,
      )
      const effectiveMargin = effectiveReimbursement - Number(c.totalSpend)

      return {
        id: c.id,
        caseNumber: c.caseNumber,
        surgeonName: c.surgeonName,
        dateOfSurgery: c.dateOfSurgery.toISOString().slice(0, 10),
        primaryCptCode: c.primaryCptCode,
        totalSpend: Number(c.totalSpend),
        totalReimbursement: effectiveReimbursement,
        margin: effectiveMargin,
        complianceStatus: c.complianceStatus,
        procedureCount: c.procedures.length,
        supplyCount: c.supplies.length,
      }
    }),
    total,
  })
}

// ─── Get Single Case ────────────────────────────────────────────

export async function getCase(id: string): Promise<CaseDetail> {
  const { facility } = await requireFacility()

  const c = await prisma.case.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
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

// ─── Date Helper ───────────────────────────────────────────────

/** Parse a date string (MM/DD/YYYY or YYYY-MM-DD) into a UTC Date object */
function parseDateToUTC(raw: string): Date {
  const trimmed = raw.trim()

  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch) {
    const [, m, d, y] = slashMatch
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  }

  // YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (isoMatch) {
    const [, y, m, d] = isoMatch
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  }

  // Fallback — use native parser but guard against Invalid Date
  const parsed = new Date(trimmed)
  if (!isNaN(parsed.getTime())) return parsed

  return new Date() // last resort: today
}

// ─── Import Cases ───────────────────────────────────────────────

export async function importCases(input: {
  facilityId?: string
  cases: CaseInput[]
}): Promise<{
  imported: number
  errors: number
  /**
   * caseNumber → Case.id for every input case that now exists at this
   * facility (newly created OR pre-existing skipDuplicates hits). The
   * import dialog uses this to persist supplies/procedures per case
   * after the case rows land (audit H4).
   */
  caseIds: Record<string, string>
}> {
  const { facility, user } = await requireFacility()

  let imported = 0
  let errors = 0
  const BATCH = 500

  for (let i = 0; i < input.cases.length; i += BATCH) {
    const batch = input.cases.slice(i, i + BATCH)
    try {
      const result = await prisma.case.createMany({
        // 2026-06-09 audit: with the per-facility unique
        // (facilityId_caseNumber), a duplicate row no longer fails the
        // whole 500-row batch as opaque "errors" — re-imports skip
        // already-imported cases instead.
        skipDuplicates: true,
        data: batch.map((caseData) => {
          const spend = caseData.totalSpend

          // Only use reimbursement when explicitly provided (i.e. calculated
          // from an actual payor contract). Don't auto-estimate from CPT here
          // — that makes margins appear on the dashboard even when no payor
          // contract is loaded.
          const reimburse = caseData.totalReimbursement ?? 0

          // Parse date: handle MM/DD/YYYY, YYYY-MM-DD, and fallback
          const dateOfSurgery = parseDateToUTC(caseData.dateOfSurgery)

          return {
            caseNumber: caseData.caseNumber,
            facilityId: facility.id,
            surgeonName: caseData.surgeonName,
            surgeonId: caseData.surgeonId,
            dateOfSurgery,
            primaryCptCode: caseData.primaryCptCode,
            totalSpend: spend,
            totalReimbursement: reimburse,
            margin: reimburse - spend,
            timeInOr: caseData.timeInOr,
            timeOutOr: caseData.timeOutOr,
            // 2026-06-14: thread the payor/insurance class through so the
            // Surgeons + Facility payor-mix surfaces have data. Store the
            // raw carrier string trimmed; `classifyPayorClass` buckets it
            // at read time. Blank → null (counts as casesWithoutPayor).
            payorClass: caseData.payorClass?.trim() || null,
          }
        }),
      })
      imported += result.count
    } catch {
      errors += batch.length
    }
  }

  // Resolve caseNumber → id so the caller can attach supplies/procedures.
  // Includes pre-existing cases (skipDuplicates) on purpose: a re-import
  // should still be able to enrich cases that already exist.
  const caseIds: Record<string, string> = {}
  const caseNumbers = input.cases.map((c) => c.caseNumber)
  for (let i = 0; i < caseNumbers.length; i += BATCH) {
    const rows = await prisma.case.findMany({
      where: {
        facilityId: facility.id,
        caseNumber: { in: caseNumbers.slice(i, i + BATCH) },
      },
      select: { id: true, caseNumber: true },
    })
    for (const r of rows) caseIds[r.caseNumber] = r.id
  }

  await logAudit({
    userId: user.id,
    action: "cases.imported",
    entityType: "case",
    metadata: { imported, errors, totalCases: input.cases.length },
  })

  return { imported, errors, caseIds }
}

// ─── Delete All Cases (clear prior case-costing data) ──────────

export async function deleteAllCases(): Promise<{ deleted: number }> {
  const { facility, user } = await requireFacility()

  const result = await prisma.case.deleteMany({
    where: { facilityId: facility.id },
  })

  await logAudit({
    userId: user.id,
    action: "cases.deleted_all",
    entityType: "case",
    metadata: { deleted: result.count },
  })

  return { deleted: result.count }
}

// ─── Import Case Supplies ───────────────────────────────────────

export async function importCaseSupplies(input: {
  caseId: string
  supplies: CaseSupplyInput[]
}): Promise<{ imported: number; matched: number }> {
  const { facility } = await requireFacility()

  // Verify case belongs to this facility
  await prisma.case.findUniqueOrThrow({
    where: { id: input.caseId, facilityId: facility.id },
    select: { id: true },
  })

  let imported = 0
  let matched = 0

  // Re-import idempotency (audit M13): skip rows that exactly match a
  // supply already on the case (vendorItemNo + extendedCost). Only
  // PRE-EXISTING rows are deduped — two identical rows within the same
  // payload stay legitimate (e.g. two identical implants, qty 1 each).
  const existingSupplies = await prisma.caseSupply.findMany({
    where: { caseId: input.caseId },
    select: { vendorItemNo: true, extendedCost: true },
  })
  const existingKeys = new Set(
    existingSupplies.map(
      (s) => `${s.vendorItemNo ?? ""}|${Number(s.extendedCost)}`,
    ),
  )

  for (const supply of input.supplies) {
    const extCost = supply.usedCost * (supply.quantity ?? 1)
    if (existingKeys.has(`${supply.vendorItemNo ?? ""}|${extCost}`)) {
      continue
    }
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

// ─── Import Case Procedures ─────────────────────────────────────

export interface CaseProcedureInput {
  cptCode: string
  description?: string
}

/**
 * Batch-insert procedure rows for one case (audit H4 — the import
 * dialog previously parsed procedure files and persisted nothing
 * beyond `primaryCptCode`). Mirrors `importCaseSupplies`: facility
 * scoping via `requireFacility` + case-ownership verification before
 * any write. Re-import idempotent: rows whose (caseId, cptCode) pair
 * already exists are skipped (audit M13).
 */
export async function importCaseProcedures(input: {
  caseId: string
  procedures: CaseProcedureInput[]
}): Promise<{ imported: number; skipped: number }> {
  const { facility } = await requireFacility()

  // Verify case belongs to this facility
  await prisma.case.findUniqueOrThrow({
    where: { id: input.caseId, facilityId: facility.id },
    select: { id: true },
  })

  const existing = await prisma.caseProcedure.findMany({
    where: { caseId: input.caseId },
    select: { cptCode: true },
  })
  const seen = new Set(existing.map((p) => p.cptCode))

  let imported = 0
  let skipped = 0
  const data: Array<{
    caseId: string
    cptCode: string
    procedureDescription: string | null
  }> = []

  for (const proc of input.procedures) {
    if (!proc.cptCode || seen.has(proc.cptCode)) {
      skipped++
      continue
    }
    seen.add(proc.cptCode)
    data.push({
      caseId: input.caseId,
      cptCode: proc.cptCode,
      procedureDescription: proc.description || null,
    })
    imported++
  }

  if (data.length > 0) {
    await prisma.caseProcedure.createMany({ data })
  }

  return { imported, skipped }
}

// ─── Surgeon Scorecards ─────────────────────────────────────────

export async function getSurgeonScorecards(
  _facilityId?: string
): Promise<SurgeonScorecard[]> {
  const { facility } = await requireFacility()

  const cases = await prisma.case.findMany({
    where: { facilityId: facility.id, surgeonName: { not: null } },
    include: {
      procedures: { select: { cptCode: true } },
      supplies: { select: { isOnContract: true, extendedCost: true } },
    },
  })

  const COMMERCIAL_PAYORS = new Set([
    "commercial",
    "blue_cross",
    "aetna",
    "united",
  ])

  function caseDurationMinutes(c: { timeInOr: string | null; timeOutOr: string | null }) {
    if (!c.timeInOr || !c.timeOutOr) return null
    const [inH, inM] = c.timeInOr.split(":").map(Number)
    const [outH, outM] = c.timeOutOr.split(":").map(Number)
    if ([inH, inM, outH, outM].some((n) => Number.isNaN(n))) return null
    const start = inH * 60 + inM
    const end = outH * 60 + outM
    const diff = end - start
    if (!Number.isFinite(diff)) return null
    return diff > 0 ? diff : diff + 24 * 60 // wrap past-midnight
  }

  function ageAtSurgery(dob: Date | null, surg: Date) {
    if (!dob) return null
    const ms = surg.getTime() - dob.getTime()
    if (ms <= 0) return null
    return ms / (365.25 * 24 * 60 * 60 * 1000)
  }

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
      // demographic accumulators
      payorTotal: number
      payorCommercial: number
      bmiTotal: number
      bmiUnder40: number
      ageTotal: number
      ageUnder65: number
      timeTotal: number
      timeCount: number
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
        payorTotal: 0,
        payorCommercial: 0,
        bmiTotal: 0,
        bmiUnder40: 0,
        ageTotal: 0,
        ageUnder65: 0,
        timeTotal: 0,
        timeCount: 0,
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

    if (c.payorClass) {
      entry.payorTotal++
      if (COMMERCIAL_PAYORS.has(c.payorClass)) entry.payorCommercial++
    }
    if (c.patientBmi != null) {
      entry.bmiTotal++
      if (Number(c.patientBmi) < 40) entry.bmiUnder40++
    }
    const age = ageAtSurgery(c.patientDob, c.dateOfSurgery)
    if (age != null) {
      entry.ageTotal++
      if (age < 65) entry.ageUnder65++
    }
    const dur = caseDurationMinutes(c)
    if (dur != null) {
      entry.timeTotal += dur
      entry.timeCount++
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
      payorMixPct:
        data.payorTotal > 0
          ? Math.round((data.payorCommercial / data.payorTotal) * 1000) / 10
          : null,
      bmiUnder40Pct:
        data.bmiTotal > 0
          ? Math.round((data.bmiUnder40 / data.bmiTotal) * 1000) / 10
          : null,
      ageUnder65Pct:
        data.ageTotal > 0
          ? Math.round((data.ageUnder65 / data.ageTotal) * 1000) / 10
          : null,
      avgCaseTimeMinutes:
        data.timeCount > 0
          ? Math.round((data.timeTotal / data.timeCount) * 10) / 10
          : null,
    }
  }))
}

// ─── CPT Analysis ───────────────────────────────────────────────

export async function getCPTAnalysis(
  _facilityId?: string
): Promise<CPTCodeAnalysis[]> {
  const { facility } = await requireFacility()

  const cases = await prisma.case.findMany({
    where: { facilityId: facility.id, primaryCptCode: { not: null } },
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
  facilityId?: string
  surgeonNames: string[]
  cptCode?: string
}): Promise<SurgeonComparison> {
  await requireFacility()

  const scorecards = await getSurgeonScorecards()
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
  facilityId?: string
  surgeonName?: string
  contractId?: string
  dateFrom?: string
  dateTo?: string
}): Promise<CaseCostingReport> {
  const { facility } = await requireFacility()

  const where = {
    facilityId: facility.id,
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

  // Audit H5: the report previously summed the raw stored
  // totalReimbursement (0 in most prod states) while the case tables
  // beside it backfilled from live PayorContract CPT rates — producing a
  // contradictory "Avg Margin". Use the same canonical rate-map fallback.
  const [cases, payorContracts] = await Promise.all([
    prisma.case.findMany({
      where,
      include: { procedures: { select: { cptCode: true } } },
      orderBy: { dateOfSurgery: "asc" },
    }),
    prisma.payorContract.findMany({
      where: { facilityId: facility.id, status: "active" },
      select: { cptRates: true },
    }),
  ])

  const cptRateMap = buildCptRateMap(payorContracts)
  const reimbursementFor = (c: (typeof cases)[number]): number =>
    resolveCaseReimbursement(
      {
        storedReimbursement: Number(c.totalReimbursement),
        primaryCptCode: c.primaryCptCode,
        procedureCptCodes: c.procedures.map((p) => p.cptCode),
      },
      cptRateMap,
    )

  const totalCases = cases.length
  const totalSpend = cases.reduce((s, c) => s + Number(c.totalSpend), 0)
  const totalReimbursement = cases.reduce(
    (s, c) => s + reimbursementFor(c),
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
    entry.reimbursement += reimbursementFor(c)
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
