import { test, expect } from "../../support/test"
import { facilityIdByName, withDb } from "../../support/db"
import {
  caseCostingFixture,
  casePatientFieldsCsv,
  caseProceduresCsv,
  caseSuppliesCsv,
} from "../../support/upload-fixtures"

test.use({ storageState: "tests/e2e/.auth/facility.json" })
test.describe.configure({ mode: "serial" })

const PREFIX = `E2E-CASE-${Date.now().toString(36).toUpperCase()}`
const fixture = caseCostingFixture(PREFIX)

interface SavedCase {
  id: string
  caseNumber: string
  facilityId: string
  surgeonName: string | null
  dateOfSurgery: string
  primaryCptCode: string | null
  payorClass: string | null
  totalSpend: number
}

async function savedCases(): Promise<SavedCase[]> {
  return withDb(async (c) => {
    const { rows } = await c.query(
      `select id, "caseNumber", "facilityId", "surgeonName", "dateOfSurgery"::text as "dateOfSurgery",
              "primaryCptCode", "payorClass", "totalSpend"::float as "totalSpend"
         from case_record where "caseNumber" like $1 order by "caseNumber"`,
      [`${PREFIX}-%`],
    )
    return rows as SavedCase[]
  })
}

async function cleanup() {
  await withDb((c) => c.query(`delete from case_record where "caseNumber" like $1`, [`${PREFIX}-%`]))
}

test.describe("Case costing CSV import links patient, procedure and supply files by Case ID", () => {
  test.beforeAll(cleanup)
  test.afterAll(cleanup)

  test("three CSV slots → Process & Link Files → case_record, case_procedure, case_supply rows", async ({ page }) => {
    test.setTimeout(180_000)
    await page.goto("/dashboard/case-costing")
    await page.getByRole("button", { name: "Upload Data" }).click()
    const dialog = page.getByRole("dialog").filter({ hasText: "Upload Clinical Case Costing Files" })
    await expect(dialog).toBeVisible({ timeout: 15_000 })

    const slots = [
      { label: "Case Procedures File", name: `${PREFIX}-procedures.csv`, buffer: caseProceduresCsv(fixture) },
      { label: "Supply Field File", name: `${PREFIX}-supplies.csv`, buffer: caseSuppliesCsv(fixture) },
      { label: "Patient Fields File", name: `${PREFIX}-patients.csv`, buffer: casePatientFieldsCsv(fixture) },
    ]
    for (const slot of slots) {
      await dialog
        .locator(`label[aria-label="Select ${slot.label} file"] input[type="file"]`)
        .setInputFiles({ name: slot.name, mimeType: "text/csv", buffer: slot.buffer })
      await expect(dialog.getByRole("button", { name: "Remove file" })).toHaveCount(slots.indexOf(slot) + 1)
    }
    await dialog.getByRole("button", { name: "Process & Link Files" }).click()
    await expect(dialog).toBeHidden({ timeout: 120_000 })

    const facilityId = await facilityIdByName()
    const cases = await savedCases()
    expect(cases.map((c) => c.caseNumber)).toEqual(fixture.cases.map((c) => c.caseNumber))
    for (const [i, expected] of fixture.cases.entries()) {
      const got = cases[i]!
      expect(got.facilityId).toBe(facilityId)
      expect(got.surgeonName).toBe(expected.surgeon)
      expect(got.dateOfSurgery.slice(0, 10)).toBe(expected.date)
      expect(got.primaryCptCode).toBe(expected.procedures[0]!.cpt)
      expect(got.payorClass).toBe(expected.payor)
    }

    const children = await withDb(async (c) => {
      const procs = await c.query(
        `select r."caseNumber", p."cptCode", p."procedureDescription"
           from case_procedure p join case_record r on r.id = p."caseId"
          where r."caseNumber" like $1 order by r."caseNumber", p."cptCode"`,
        [`${PREFIX}-%`],
      )
      const supplies = await c.query(
        `select r."caseNumber", s."vendorItemNo", s."materialName", s.quantity
           from case_supply s join case_record r on r.id = s."caseId"
          where r."caseNumber" like $1 order by r."caseNumber", s."vendorItemNo"`,
        [`${PREFIX}-%`],
      )
      return {
        procs: procs.rows as { caseNumber: string; cptCode: string; procedureDescription: string | null }[],
        supplies: supplies.rows as { caseNumber: string; vendorItemNo: string | null; materialName: string; quantity: number }[],
      }
    })
    expect(children.procs).toEqual(
      fixture.cases.flatMap((c) =>
        [...c.procedures]
          .sort((a, b) => a.cpt.localeCompare(b.cpt))
          .map((p) => ({ caseNumber: c.caseNumber, cptCode: p.cpt, procedureDescription: p.description })),
      ),
    )
    expect(children.supplies).toEqual(
      fixture.cases.flatMap((c) =>
        [...c.supplies]
          .sort((a, b) => a.catalog.localeCompare(b.catalog))
          .map((s) => ({ caseNumber: c.caseNumber, vendorItemNo: s.catalog, materialName: s.material, quantity: s.quantity })),
      ),
    )
  })

  test("supply 'Used Cost' is read as the line total, not multiplied by quantity again", async () => {
    const lines = await withDb(async (c) => {
      const { rows } = await c.query(
        `select s."vendorItemNo", s."usedCost"::float as used, s."extendedCost"::float as ext
           from case_supply s join case_record r on r.id = s."caseId" where r."caseNumber" like $1`,
        [`${PREFIX}-%`],
      )
      return rows as { vendorItemNo: string; used: number; ext: number }[]
    })
    const cases = await savedCases()
    for (const c of fixture.cases) {
      for (const s of c.supplies) {
        const got = lines.find((l) => l.vendorItemNo === s.catalog)
        expect(got?.used, `${s.catalog} unit cost`).toBeCloseTo(s.unitCost, 2)
        expect(got?.ext, `${s.catalog} extended cost`).toBeCloseTo(s.unitCost * s.quantity, 2)
      }
      const spend = c.supplies.reduce((a, s) => a + s.unitCost * s.quantity, 0)
      expect(cases.find((x) => x.caseNumber === c.caseNumber)?.totalSpend, `${c.caseNumber} totalSpend`).toBeCloseTo(spend, 2)
    }
  })
})
