import { test, expect } from "../../support/test"
import { createScratchContract, deleteContract, withDb } from "../../support/db"
import { CONTRACT_FIXTURE, buildTextPdf, contractPdfLines, rasterizeToScannedPdf } from "../../support/upload-fixtures"

test.use({ storageState: "tests/e2e/.auth/facility.json" })
test.describe.configure({ mode: "serial" })

for (const variant of ["text", "scanned"] as const) {
  test(`AI Agent upload indexes the words of a ${variant} PDF, not its bytes`, async ({ page }) => {
    test.setTimeout(300_000)
    const contractName = `AI Agent Doc ${variant} ${Date.now()}`
    const contractId = await createScratchContract(contractName)
    const docName = `omx-${variant}-${Date.now()}`
    try {
      const text = await buildTextPdf(contractPdfLines())
      const pdf = variant === "text" ? text : await rasterizeToScannedPdf(text)
      await page.goto("/dashboard/ai-agent")
      await page.getByRole("tab", { name: /documents/i }).click()
      await page.getByRole("button", { name: /upload/i }).first().click()
      const dialog = page.getByRole("dialog")
      await expect(dialog.getByText("Upload Document")).toBeVisible()
      await dialog.locator("#upload-contract").click()
      await page.getByRole("option", { name: contractName }).click()
      await dialog.locator("#upload-name").fill(docName)
      await dialog.locator("#upload-file").setInputFiles({ name: `${docName}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(pdf) })
      await expect(dialog.locator("#upload-raw-text")).toHaveValue(new RegExp(CONTRACT_FIXTURE.contractNumber), { timeout: 180_000 })
      const submit = dialog.getByRole("button", { name: "Upload", exact: true })
      await expect(submit).toBeEnabled()
      await submit.click()
      await expect(dialog).toBeHidden({ timeout: 120_000 })

      const pages = await withDb(async (c) => {
        const { rows } = await c.query(
          `select p."pageNumber", p.text, d."indexStatus"
             from contract_document d join contract_document_page p on p."documentId" = d.id
            where d."contractId" = $1 and d.name = $2 order by p."pageNumber"`,
          [contractId, docName],
        )
        return rows as { pageNumber: number; text: string; indexStatus: string }[]
      })
      expect(pages.length, "indexed pages").toBe(2)
      expect(pages[0]!.indexStatus).toBe("indexed")
      expect(pages[0]!.text.replace(/\s+/g, " ")).toContain(CONTRACT_FIXTURE.contractNumber)
      expect(pages[1]!.text.replace(/\s+/g, "")).toContain(CONTRACT_FIXTURE.capitalValue)
      expect(pages.map((p) => p.text).join(" ")).not.toMatch(/%PDF|endobj|FlateDecode/)
    } finally {
      await withDb((c) => c.query(`delete from contract_document_page where "documentId" in (select id from contract_document where "contractId" = $1)`, [contractId]))
      await deleteContract(contractId)
    }
  })
}
