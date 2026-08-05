import { test, expect } from "@playwright/test"

/**
 * E2E: Contract document upload → download round-trip (Documents tab)
 *
 * Regression: the Documents tab rendered document rows with no download
 * affordance at all — the file name was plain text, so an uploaded contract
 * PDF could not be retrieved from the app. The fix makes the file name and a
 * Download button exchange the stored S3 key for a presigned URL
 * (getDownloadUrl → assertKeyVisibleToUser → presign) and open it in a new
 * tab.
 *
 * Self-sufficient: uploads its own small PDF through the app's Upload dialog,
 * downloads it back, then deletes the row — so it does not depend on seed
 * data carrying ContractDocument rows (it doesn't).
 */
test.use({ storageState: "tests/e2e/.auth/facility.json" })

// Minimal valid single-page PDF, enough for the round-trip.
const TINY_PDF = Buffer.from(
  `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000052 00000 n
0000000101 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
164
%%EOF`,
)

// Unique per run — a failed earlier run leaves its row behind, and duplicate
// names would break the "gone after delete" assertion.
const DOC_NAME = `e2e-download-roundtrip-${Date.now()}.pdf`

test("uploaded document can be downloaded via a presigned URL", async ({
  page,
}) => {
  // Open the first real contract's Documents tab.
  await page.goto("/dashboard/contracts")
  await expect(page.locator("table").first()).toBeVisible({ timeout: 15_000 })
  await page.locator("table tbody tr").first().locator("a").first().click()
  await expect(page.getByRole("tab", { name: /documents/i })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByRole("tab", { name: /documents/i }).click()

  // Upload our own PDF through the app's dialog.
  await page.getByRole("button", { name: /upload/i }).first().click()
  await expect(page.getByText("Upload Document")).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({
    name: DOC_NAME,
    mimeType: "application/pdf",
    buffer: TINY_PDF,
  })
  await expect(page.getByText(DOC_NAME).first()).toBeVisible({
    timeout: 15_000,
  })

  // Download: the button navigates to a presigned URL signed with an
  // attachment Content-Disposition, so the browser fires a real download
  // (and the page stays put — no popup, no popup blockers).
  const downloadPromise = page.waitForEvent("download", { timeout: 15_000 })
  await page
    .getByRole("button", { name: /download/i })
    .last()
    .click()
  const download = await downloadPromise

  // Presigned URL with a signature, saved under the document's name.
  expect(download.url()).toMatch(/X-Amz-Signature=|X-Amz-Credential=/)
  expect(download.suggestedFilename()).toBe(DOC_NAME)

  // The bytes that come back are our PDF.
  const savedPath = await download.path()
  const { readFileSync } = await import("node:fs")
  expect(readFileSync(savedPath).subarray(0, 5).toString()).toBe("%PDF-")

  // And the page did not navigate away from the contract detail.
  expect(page.url()).toMatch(/\/dashboard\/contracts\//)

  // Clean up: delete the row we created (confirm dialog).
  const docRow = page
    .locator("div.flex.items-center.justify-between", {
      hasText: DOC_NAME,
    })
    .first()
  await docRow.getByRole("button").last().click()
  await expect(page.getByText("Delete document?")).toBeVisible()
  await page.getByRole("button", { name: /^confirm$/i }).click()
  await expect(page.getByText(DOC_NAME)).toHaveCount(0, { timeout: 15_000 })
})
