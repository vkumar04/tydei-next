"use server"

/**
 * Case-costing ingests — patient data, procedures, supplies.
 *
 * Extracted from lib/actions/mass-upload.ts during F16 tech debt split.
 */
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import {
  parseCSV,
  parseMoney,
  parseDate,
  mapColumnsWithAI,
  get,
} from "./shared"

// ─── Patient Case Data ──────────────────────────────────────────

export async function ingestCaseDataCSV(
  csvText: string,
  fileName?: string,
): Promise<{
  created: number
  updated: number
  failed: number
  errors: string[]
}> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  const rows = parseCSV(csvText)
  if (rows.length === 0)
    return { created: 0, updated: 0, failed: 0, errors: ["empty file"] }

  const headers = Object.keys(rows[0])
  const mapping = await mapColumnsWithAI(
    headers,
    [
      { key: "caseNumber", label: "Case ID / Case Number", required: true },
      { key: "surgeryDate", label: "Date of Surgery", required: true },
      {
        key: "surgeonName",
        label:
          "Surgeon — accept any column whose header contains 'surgeon' or 'physician' or 'doctor' or 'provider'",
        required: false,
      },
      { key: "patientDob", label: "Patient Date of Birth", required: false },
      {
        key: "timeIn",
        label: "Time wheeled into OR / Incision Time",
        required: false,
      },
      {
        key: "timeOut",
        label: "Time wheeled out of OR / Closure Time",
        required: false,
      },
    ],
    rows,
  )

  let created = 0
  let updated = 0
  let failed = 0
  const errors: string[] = []

  for (const row of rows) {
    const caseNumber = get(row, mapping, "caseNumber")
    if (!caseNumber) {
      failed++
      continue
    }

    const surgeryDate = parseDate(get(row, mapping, "surgeryDate"))
    if (!surgeryDate) {
      failed++
      errors.push(`${caseNumber}: invalid surgery date`)
      continue
    }

    const patientDob = parseDate(get(row, mapping, "patientDob"))
    let surgeonName: string | null = get(row, mapping, "surgeonName") || null
    if (!surgeonName) {
      for (const [key, val] of Object.entries(row)) {
        const lowerKey = key.toLowerCase()
        if (
          (lowerKey.includes("surgeon") ||
            lowerKey.includes("physician") ||
            lowerKey.includes("doctor") ||
            lowerKey.includes("provider")) &&
          val &&
          val.trim().length > 0
        ) {
          surgeonName = val.trim()
          break
        }
      }
    }
    const timeIn = get(row, mapping, "timeIn") || null
    const timeOut = get(row, mapping, "timeOut") || null

    try {
      // 2026-06-09 audit BLOCKER: lookups + upsert key MUST be
      // facility-scoped (compound unique facilityId_caseNumber). The
      // prior global-caseNumber upsert let facility B's import TRANSFER
      // facility A's case (the update branch even rewrote facilityId).
      // facilityId is deliberately absent from the update payload.
      const existing = await prisma.case.findUnique({
        where: { facilityId_caseNumber: { facilityId, caseNumber } },
        select: { id: true },
      })
      await prisma.case.upsert({
        where: { facilityId_caseNumber: { facilityId, caseNumber } },
        update: {
          surgeonName,
          patientDob,
          dateOfSurgery: surgeryDate,
          timeInOr: timeIn,
          timeOutOr: timeOut,
        },
        create: {
          caseNumber,
          facilityId,
          surgeonName,
          patientDob,
          dateOfSurgery: surgeryDate,
          timeInOr: timeIn,
          timeOutOr: timeOut,
        },
      })
      if (existing) updated++
      else created++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${caseNumber}: ${message.slice(0, 160)}`)
    }
  }

  await logAudit({
    userId,
    action: "cases.imported_via_mass_upload",
    entityType: "case",
    metadata: {
      created,
      updated,
      failed,
      rowCount: rows.length,
      fileName: fileName ?? null,
    },
  })

  revalidatePath("/dashboard/case-costing")
  return { created, updated, failed, errors: errors.slice(0, 10) }
}

// ─── Case Procedures ─────────────────────────────────────────────

export async function ingestCaseProceduresCSV(
  csvText: string,
  fileName?: string,
): Promise<{
  created: number
  failed: number
  caseStubsCreated: number
  errors: string[]
}> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  const rows = parseCSV(csvText)
  if (rows.length === 0)
    return {
      created: 0,
      failed: 0,
      caseStubsCreated: 0,
      errors: ["empty file"],
    }

  const headers = Object.keys(rows[0])
  const mapping = await mapColumnsWithAI(
    headers,
    [
      { key: "caseNumber", label: "Case ID / Case Number", required: true },
      { key: "cptCode", label: "CPT Code / Procedure Code", required: true },
      {
        key: "isPrimary",
        label: "CPT Is Primary YN / Primary Procedure Flag",
        required: false,
      },
      { key: "surgeryDate", label: "Date of Surgery", required: false },
    ],
    rows,
  )

  let created = 0
  let failed = 0
  let caseStubsCreated = 0
  let skippedDuplicates = 0
  const errors: string[] = []
  // caseId → set of CPT codes already on the case (lazy-loaded).
  const existingProcedureCodes = new Map<string, Set<string>>()

  for (const row of rows) {
    const caseNumber = get(row, mapping, "caseNumber")
    const cptCode = get(row, mapping, "cptCode")
    if (!caseNumber || !cptCode) {
      failed++
      continue
    }
    const isPrimary = get(row, mapping, "isPrimary")
      .toUpperCase()
      .startsWith("Y")
    const surgeryDate = parseDate(get(row, mapping, "surgeryDate"))

    try {
      // 2026-06-09 audit BLOCKER: facility-scoped lookup — the global
      // findUnique attached this facility's procedure rows onto another
      // facility's case on caseNumber collision.
      let caseRow = await prisma.case.findUnique({
        where: { facilityId_caseNumber: { facilityId, caseNumber } },
        select: { id: true },
      })
      if (!caseRow) {
        if (!surgeryDate) {
          failed++
          errors.push(`${caseNumber}: no surgery date and no existing case`)
          continue
        }
        caseRow = await prisma.case.create({
          data: {
            caseNumber,
            facilityId,
            dateOfSurgery: surgeryDate,
          },
          select: { id: true },
        })
        caseStubsCreated++
      }

      // Re-import idempotency (audit M13): skip when this (caseId,
      // cptCode) pair already exists — re-running the same file must
      // not double up procedure rows. The cache also folds duplicate
      // rows within one file (same CPT twice on a case is a dupe, not
      // a second procedure — distinct procedures carry distinct CPTs).
      let procCodes = existingProcedureCodes.get(caseRow.id)
      if (!procCodes) {
        const rows = await prisma.caseProcedure.findMany({
          where: { caseId: caseRow.id },
          select: { cptCode: true },
        })
        procCodes = new Set(rows.map((r) => r.cptCode))
        existingProcedureCodes.set(caseRow.id, procCodes)
      }
      if (procCodes.has(cptCode)) {
        skippedDuplicates++
        continue
      }
      procCodes.add(cptCode)

      await prisma.caseProcedure.create({
        data: {
          caseId: caseRow.id,
          cptCode,
        },
      })
      if (isPrimary) {
        // auth-scope-scanner-skip: caseRow.id comes from the
        // facility-scoped lookup/create directly above.
        await prisma.case.update({
          where: { id: caseRow.id },
          data: { primaryCptCode: cptCode },
        })
      }
      created++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${caseNumber}/${cptCode}: ${message.slice(0, 160)}`)
    }
  }

  await logAudit({
    userId,
    action: "case_procedures.imported_via_mass_upload",
    entityType: "case_procedure",
    metadata: {
      created,
      failed,
      caseStubsCreated,
      skippedDuplicates,
      rowCount: rows.length,
      fileName: fileName ?? null,
    },
  })

  revalidatePath("/dashboard/case-costing")
  return { created, failed, caseStubsCreated, errors: errors.slice(0, 10) }
}

// ─── Case Supplies ──────────────────────────────────────────────

export async function ingestCaseSuppliesCSV(
  csvText: string,
  fileName?: string,
): Promise<{
  created: number
  failed: number
  casesTouched: number
  errors: string[]
}> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  const rows = parseCSV(csvText)
  if (rows.length === 0)
    return { created: 0, failed: 0, casesTouched: 0, errors: ["empty file"] }

  const headers = Object.keys(rows[0])
  const mapping = await mapColumnsWithAI(
    headers,
    [
      { key: "caseNumber", label: "Case ID / Case Number", required: true },
      {
        key: "materialName",
        label: "Material Name / Product Description",
        required: true,
      },
      {
        key: "vendorItemNo",
        label: "Catalog Number / Vendor Item Number",
        required: false,
      },
      { key: "unitCost", label: "Unit Cost / Per-Unit Price", required: false },
      { key: "usedCost", label: "Used Cost / Total Line Cost", required: false },
      { key: "quantity", label: "Quantity Used / Count", required: false },
      { key: "manufacturer", label: "Manufacturer", required: false },
    ],
    rows,
  )

  let created = 0
  let failed = 0
  let skippedDuplicates = 0
  const errors: string[] = []
  const caseIdsTouched = new Set<string>()
  // caseId → keys of supplies already in the DB before this run
  // (lazy-loaded). Audit M13: re-import idempotency — skip rows that
  // exactly match a PRE-EXISTING supply (caseId + vendorItemNo +
  // extendedCost). Chosen over delete-and-replace-per-case because a
  // facility may legitimately ingest several partial supply files that
  // touch the same case; replacing would silently destroy rows from an
  // earlier file. Rows created within THIS run are not added to the set,
  // so duplicate lines inside one file (two identical implants) survive.
  const existingSupplyKeys = new Map<string, Set<string>>()

  for (const row of rows) {
    const caseNumber = get(row, mapping, "caseNumber")
    if (!caseNumber) {
      failed++
      continue
    }

    const materialName = get(row, mapping, "materialName") || "Unknown material"
    const vendorItemNo = get(row, mapping, "vendorItemNo") || null
    // Audit H7: track provenance. The old `usedCost || unitCost`
    // fallback collapsed unitCost×qty to a bare unitCost — when the
    // file has no Used Cost column, the line total is unit × qty.
    const usedRaw = parseMoney(get(row, mapping, "usedCost"))
    const unitCost = parseMoney(get(row, mapping, "unitCost"))
    const quantity = Math.max(
      1,
      parseInt(get(row, mapping, "quantity") || "1", 10) || 1,
    )
    const extCost = usedRaw > 0 ? usedRaw : unitCost * quantity

    try {
      // 2026-06-09 audit BLOCKER: facility-scoped lookup — the global
      // findUnique attached this facility's supply rows (and spend) onto
      // another facility's case on caseNumber collision.
      let caseRow = await prisma.case.findUnique({
        where: { facilityId_caseNumber: { facilityId, caseNumber } },
        select: { id: true },
      })
      if (!caseRow) {
        caseRow = await prisma.case.create({
          data: {
            caseNumber,
            facilityId,
            // Audit L16 (honest placeholder): supply files carry no
            // surgery date, so a stub case created here gets "today".
            // The real date arrives when the patient-fields file for
            // this caseNumber is ingested (upsert overwrites it).
            dateOfSurgery: new Date(),
          },
          select: { id: true },
        })
      }
      caseIdsTouched.add(caseRow.id)

      let supplyKeys = existingSupplyKeys.get(caseRow.id)
      if (!supplyKeys) {
        const existing = await prisma.caseSupply.findMany({
          where: { caseId: caseRow.id },
          select: { vendorItemNo: true, extendedCost: true },
        })
        supplyKeys = new Set(
          existing.map(
            (s) => `${s.vendorItemNo ?? ""}|${Number(s.extendedCost)}`,
          ),
        )
        existingSupplyKeys.set(caseRow.id, supplyKeys)
      }
      if (supplyKeys.has(`${vendorItemNo ?? ""}|${extCost || 0}`)) {
        skippedDuplicates++
        continue
      }

      await prisma.caseSupply.create({
        data: {
          caseId: caseRow.id,
          materialName,
          vendorItemNo,
          usedCost: extCost || 0,
          quantity,
          extendedCost: extCost || 0,
        },
      })
      created++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      errors.push(`${caseNumber}: ${message.slice(0, 160)}`)
    }
  }

  // 2026-06-18 perf audit: was 3 sequential queries PER touched case
  // (aggregate + findUnique + update) — 3×N round-trips on a large upload.
  // Now: one groupBy for all supply sums, one findMany for reimbursements,
  // and the margin updates batched in a single transaction.
  if (caseIdsTouched.size > 0) {
    const ids = [...caseIdsTouched]
    const sums = await prisma.caseSupply.groupBy({
      by: ["caseId"],
      where: { caseId: { in: ids } },
      _sum: { extendedCost: true },
    })
    const totalByCase = new Map(
      sums.map((s) => [s.caseId, Number(s._sum.extendedCost ?? 0)]),
    )
    const caseRecords = await prisma.case.findMany({
      where: { id: { in: ids } },
      select: { id: true, totalReimbursement: true },
    })
    // Audit M10: recompute margin in the SAME update that writes the new
    // totalSpend (the old `margin: { decrement: 0 }` no-op left margin
    // frozen at its pre-import value).
    // auth-scope-scanner-skip: ids come from the facility-scoped
    // lookup/create in the loop above; batched in one transaction.
    await prisma.$transaction(
      caseRecords.map((cr) => {
        const total = totalByCase.get(cr.id) ?? 0
        const reimbursement = Number(cr.totalReimbursement ?? 0)
        // auth-scope-scanner-skip: cr.id is from the facility-scoped
        // case.findMany above (ids ⊂ facility-scoped creates in the loop).
        return prisma.case.update({
          where: { id: cr.id },
          data: { totalSpend: total, margin: reimbursement - total },
        })
      }),
    )
  }

  await logAudit({
    userId,
    action: "case_supplies.imported_via_mass_upload",
    entityType: "case_supply",
    metadata: {
      created,
      failed,
      skippedDuplicates,
      casesTouched: caseIdsTouched.size,
      rowCount: rows.length,
      fileName: fileName ?? null,
    },
  })

  revalidatePath("/dashboard/case-costing")
  return {
    created,
    failed,
    casesTouched: caseIdsTouched.size,
    errors: errors.slice(0, 10),
  }
}
