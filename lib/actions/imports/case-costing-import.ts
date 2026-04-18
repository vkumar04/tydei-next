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
      const existing = await prisma.case.findUnique({
        where: { caseNumber },
        select: { id: true },
      })
      await prisma.case.upsert({
        where: { caseNumber },
        update: {
          facilityId,
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
  const errors: string[] = []

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
      let caseRow = await prisma.case.findUnique({
        where: { caseNumber },
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

      await prisma.caseProcedure.create({
        data: {
          caseId: caseRow.id,
          cptCode,
        },
      })
      if (isPrimary) {
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
  const errors: string[] = []
  const caseIdsTouched = new Set<string>()

  for (const row of rows) {
    const caseNumber = get(row, mapping, "caseNumber")
    if (!caseNumber) {
      failed++
      continue
    }

    const materialName = get(row, mapping, "materialName") || "Unknown material"
    const vendorItemNo = get(row, mapping, "vendorItemNo") || null
    const usedCost =
      parseMoney(get(row, mapping, "usedCost")) ||
      parseMoney(get(row, mapping, "unitCost"))
    const unitCost = parseMoney(get(row, mapping, "unitCost"))
    const quantity = Math.max(
      1,
      parseInt(get(row, mapping, "quantity") || "1", 10) || 1,
    )

    try {
      let caseRow = await prisma.case.findUnique({
        where: { caseNumber },
        select: { id: true },
      })
      if (!caseRow) {
        caseRow = await prisma.case.create({
          data: {
            caseNumber,
            facilityId,
            dateOfSurgery: new Date(),
          },
          select: { id: true },
        })
      }
      caseIdsTouched.add(caseRow.id)

      const extCost = usedCost || unitCost * quantity
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

  for (const caseId of caseIdsTouched) {
    const agg = await prisma.caseSupply.aggregate({
      where: { caseId },
      _sum: { extendedCost: true },
    })
    const total = agg._sum.extendedCost ?? 0
    await prisma.case.update({
      where: { id: caseId },
      data: { totalSpend: total, margin: { decrement: 0 } },
    })
  }

  await logAudit({
    userId,
    action: "case_supplies.imported_via_mass_upload",
    entityType: "case_supply",
    metadata: {
      created,
      failed,
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
