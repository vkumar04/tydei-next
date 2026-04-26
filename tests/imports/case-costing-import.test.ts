/**
 * End-to-end tests for the 3 case-costing CSV ingest pipelines:
 *   - ingestCaseDataCSV     (patient fields)
 *   - ingestCaseProceduresCSV (CPT codes)
 *   - ingestCaseSuppliesCSV (materials + totalSpend rollup)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures")

// ─── In-memory DB stub ──────────────────────────────────────────

type CaseRow = { id: string; caseNumber: string; [k: string]: unknown }

const caseRows: CaseRow[] = []
const procedureCreates: Array<Record<string, unknown>> = []
const supplyCreates: Array<Record<string, unknown>> = []
const caseUpdates: Array<{ id: string; data: Record<string, unknown> }> = []

let caseIdCounter = 0

vi.mock("@/lib/db", () => ({
  prisma: {
    case: {
      findUnique: vi.fn(async ({ where }: { where: { caseNumber: string } }) => {
        const row = caseRows.find((r) => r.caseNumber === where.caseNumber)
        return row ? { id: row.id } : null
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = `case-${++caseIdCounter}`
        caseRows.push({ id, caseNumber: String(data.caseNumber), ...data })
        return { id }
      }),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { caseNumber: string }
          create: Record<string, unknown>
          update: Record<string, unknown>
        }) => {
          const existing = caseRows.find((r) => r.caseNumber === where.caseNumber)
          if (existing) {
            Object.assign(existing, update)
            return { id: existing.id }
          }
          const id = `case-${++caseIdCounter}`
          caseRows.push({ id, caseNumber: where.caseNumber, ...create })
          return { id }
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Record<string, unknown>
        }) => {
          caseUpdates.push({ id: where.id, data })
          const row = caseRows.find((r) => r.id === where.id)
          if (row) Object.assign(row, data)
          return { id: where.id }
        },
      ),
    },
    caseProcedure: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        procedureCreates.push(data)
        return { id: `proc-${procedureCreates.length}` }
      }),
    },
    caseSupply: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        supplyCreates.push(data)
        return { id: `sup-${supplyCreates.length}` }
      }),
      aggregate: vi.fn(async ({ where }: { where: { caseId: string } }) => {
        const sum = supplyCreates
          .filter((s) => s.caseId === where.caseId)
          .reduce((acc, s) => acc + Number(s.extendedCost ?? 0), 0)
        return { _sum: { extendedCost: sum } }
      }),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))
vi.mock("next/cache", () => import("@/tests/setup/next-cache-mock"))
vi.mock("@/lib/actions/imports/shared", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/actions/imports/shared")
  >("@/lib/actions/imports/shared")
  return {
    ...actual,
    mapColumnsWithAI: vi.fn(async () => ({})),
  }
})

import {
  ingestCaseDataCSV,
  ingestCaseProceduresCSV,
  ingestCaseSuppliesCSV,
} from "@/lib/actions/imports/case-costing-import"
import { mapColumnsWithAI } from "@/lib/actions/imports/shared"

const fixture = (name: string): string =>
  readFileSync(join(FIXTURE_DIR, name), "utf8")

beforeEach(() => {
  vi.clearAllMocks()
  caseRows.length = 0
  procedureCreates.length = 0
  supplyCreates.length = 0
  caseUpdates.length = 0
  caseIdCounter = 0
})

// ─── ingestCaseDataCSV ───────────────────────────────────────────

describe("ingestCaseDataCSV", () => {
  it("creates 3 case rows from the fixture CSV", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      surgeryDate: "Date of Surgery",
      surgeonName: "Surgeon",
      patientDob: "Date of birth",
      timeIn: "Time wheeled into OR",
      timeOut: "Time wheeled out of OR",
    })

    const csv = fixture("case-data.csv")
    const result = await ingestCaseDataCSV(csv, "cases.csv")

    expect(result.created).toBe(3)
    expect(result.updated).toBe(0)
    expect(result.failed).toBe(0)
    expect(caseRows).toHaveLength(3)
    expect(caseRows[0].caseNumber).toBe("CASE-100")
    expect(caseRows[0].surgeonName).toBe("Dr. Smith")
  })

  it("updates existing cases on re-import (idempotent)", async () => {
    // Pre-populate with an existing case
    caseRows.push({ id: "case-existing", caseNumber: "CASE-100" })
    caseIdCounter = 1

    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      surgeryDate: "Date of Surgery",
      surgeonName: "Surgeon",
    })

    const csv =
      "Case ID,Date of Surgery,Surgeon\n" +
      "CASE-100,03/15/2026,Dr. Newname\n" +
      "CASE-200,03/16/2026,Dr. Fresh\n"

    const result = await ingestCaseDataCSV(csv)
    expect(result.updated).toBe(1)
    expect(result.created).toBe(1)
  })

  it("rejects rows with invalid surgery date", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      surgeryDate: "Date of Surgery",
    })

    const csv =
      "Case ID,Date of Surgery\n" +
      "CASE-100,not-a-date\n" +
      "CASE-101,03/15/2026\n"

    const result = await ingestCaseDataCSV(csv)
    expect(result.created).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors[0]).toContain("CASE-100")
  })

  it("falls back to scanning row keys for surgeon when mapper misses it", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      surgeryDate: "Date of Surgery",
      // No surgeonName mapping — should fall back to key-name scan
    })

    const csv =
      "Case ID,Date of Surgery,Attending Surgeon\n" + "CASE-100,03/15/2026,Dr. Hidden\n"

    await ingestCaseDataCSV(csv)
    expect(caseRows[0].surgeonName).toBe("Dr. Hidden")
  })

  it("returns error for empty file", async () => {
    const result = await ingestCaseDataCSV("")
    expect(result.errors).toContain("empty file")
  })
})

// ─── ingestCaseProceduresCSV ─────────────────────────────────────

describe("ingestCaseProceduresCSV", () => {
  it("creates procedures for existing cases", async () => {
    // Pre-populate parent cases
    caseRows.push(
      { id: "case-1", caseNumber: "CASE-100" },
      { id: "case-2", caseNumber: "CASE-101" },
      { id: "case-3", caseNumber: "CASE-102" },
    )
    caseIdCounter = 3

    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      cptCode: "CPT Code",
      isPrimary: "CPT Is Primary YN",
      surgeryDate: "Date of Surgery",
    })

    const csv = fixture("case-procedures.csv")
    const result = await ingestCaseProceduresCSV(csv)

    expect(result.created).toBe(4)
    expect(result.failed).toBe(0)
    expect(result.caseStubsCreated).toBe(0)
    expect(procedureCreates).toHaveLength(4)
  })

  it("creates case stub when parent case doesn't exist yet", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      cptCode: "CPT Code",
      isPrimary: "CPT Is Primary YN",
      surgeryDate: "Date of Surgery",
    })

    const csv =
      "Case ID,CPT Code,CPT Is Primary YN,Date of Surgery\n" +
      "CASE-NEW,29881,Y,03/15/2026\n"

    const result = await ingestCaseProceduresCSV(csv)
    expect(result.created).toBe(1)
    expect(result.caseStubsCreated).toBe(1)
    expect(caseRows).toHaveLength(1)
  })

  it("rejects rows missing surgery date when parent case doesn't exist", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      cptCode: "CPT Code",
    })

    const csv = "Case ID,CPT Code\nCASE-NO-DATE,29881\n"

    const result = await ingestCaseProceduresCSV(csv)
    expect(result.failed).toBe(1)
    expect(result.errors[0]).toContain("no surgery date")
  })

  it("sets Case.primaryCptCode when CPT Is Primary = Y", async () => {
    caseRows.push({ id: "case-1", caseNumber: "CASE-100" })
    caseIdCounter = 1

    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      cptCode: "CPT Code",
      isPrimary: "CPT Is Primary YN",
      surgeryDate: "Date of Surgery",
    })

    const csv =
      "Case ID,CPT Code,CPT Is Primary YN,Date of Surgery\n" +
      "CASE-100,29881,Y,03/15/2026\n"

    await ingestCaseProceduresCSV(csv)
    const primaryUpdate = caseUpdates.find(
      (u) => (u.data as { primaryCptCode?: string }).primaryCptCode === "29881",
    )
    expect(primaryUpdate).toBeDefined()
  })
})

// ─── ingestCaseSuppliesCSV ───────────────────────────────────────

describe("ingestCaseSuppliesCSV", () => {
  it("creates supplies + rolls up totalSpend on each touched case", async () => {
    // Pre-populate parent cases
    caseRows.push(
      { id: "case-1", caseNumber: "CASE-100" },
      { id: "case-2", caseNumber: "CASE-101" },
      { id: "case-3", caseNumber: "CASE-102" },
    )
    caseIdCounter = 3

    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      materialName: "Material Name",
      vendorItemNo: "Catalog number",
      unitCost: "Unit Cost",
      usedCost: "Used Cost",
      quantity: "Quantity Used",
      manufacturer: "Manufacturer",
    })

    const csv = fixture("case-supplies.csv")
    const result = await ingestCaseSuppliesCSV(csv)

    expect(result.created).toBe(4)
    expect(result.casesTouched).toBe(3)
    expect(supplyCreates).toHaveLength(4)

    // CASE-100 has 2 supplies (125 + 88 = 213). Verify rollup.
    const case1Total = supplyCreates
      .filter((s) => s.caseId === "case-1")
      .reduce((acc, s) => acc + Number(s.extendedCost), 0)
    expect(case1Total).toBe(213)

    // Verify totalSpend update happened for each touched case
    const totalSpendUpdates = caseUpdates.filter(
      (u) => "totalSpend" in u.data,
    )
    expect(totalSpendUpdates.length).toBe(3)
    const case1Rollup = totalSpendUpdates.find((u) => u.id === "case-1")
    expect(Number(case1Rollup?.data.totalSpend)).toBe(213)
  })

  it("creates case stub with placeholder date when parent missing", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      materialName: "Material Name",
      unitCost: "Unit Cost",
      quantity: "Quantity Used",
    })

    const csv =
      "Case ID,Material Name,Unit Cost,Quantity Used\n" +
      "ORPHAN-1,Implant,100,2\n"

    const result = await ingestCaseSuppliesCSV(csv)
    expect(result.created).toBe(1)
    expect(result.casesTouched).toBe(1)
    expect(caseRows).toHaveLength(1)
  })

  it("falls back to unitCost (as-is) when usedCost mapping is missing (legacy behavior)", async () => {
    caseRows.push({ id: "case-1", caseNumber: "CASE-100" })
    caseIdCounter = 1

    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      materialName: "Material Name",
      unitCost: "Unit Cost",
      quantity: "Quantity Used",
      // no "usedCost" key
    })

    const csv =
      "Case ID,Material Name,Unit Cost,Quantity Used\n" +
      "CASE-100,Item,25.00,4\n"

    await ingestCaseSuppliesCSV(csv)
    // Quirk of the existing ingest: when usedCost mapping is missing,
    // `usedCost = parseMoney(unitCost)` (not unitCost × quantity). Then
    // `extCost = usedCost || unitCost × quantity` — the first branch wins
    // because usedCost is truthy. Result: extCost = 25, NOT 100.
    //
    // This looks like a latent bug — consumers of the Supply rollup may
    // under-count when the source CSV lacks a Used Cost column. Left
    // locked-in here so any accidental change is surfaced explicitly.
    expect(Number(supplyCreates[0].extendedCost)).toBe(25)
  })

  it("prefers usedCost over unitCost × quantity when present", async () => {
    caseRows.push({ id: "case-1", caseNumber: "CASE-100" })
    caseIdCounter = 1

    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      materialName: "Material Name",
      unitCost: "Unit Cost",
      usedCost: "Used Cost",
      quantity: "Quantity Used",
    })

    // Synthetic: usedCost ≠ unit × qty (e.g., partial usage)
    const csv =
      "Case ID,Material Name,Unit Cost,Used Cost,Quantity Used\n" +
      "CASE-100,Partial,100.00,75.00,1\n"

    await ingestCaseSuppliesCSV(csv)
    expect(Number(supplyCreates[0].extendedCost)).toBe(75)
  })

  it("skips rows missing caseNumber", async () => {
    vi.mocked(mapColumnsWithAI).mockResolvedValueOnce({
      caseNumber: "Case ID",
      materialName: "Material Name",
      unitCost: "Unit Cost",
    })

    const csv =
      "Case ID,Material Name,Unit Cost\n" +
      ",Item A,50\n" + // no case id
      "CASE-100,Item B,50\n"

    const result = await ingestCaseSuppliesCSV(csv)
    expect(result.created).toBe(1)
    expect(result.failed).toBe(1)
  })
})
