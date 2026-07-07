import { chromium } from "playwright"
const BASE = "https://tydei-app-production.up.railway.app"
const SHOT = "/private/tmp/claude-501/-Users-vickkumar-code-tydei-next/4e380553-75f7-4d58-960b-63354467dd12/scratchpad"
const FILE = "/Users/vickkumar/.claude/uploads/4e380553-75f7-4d58-960b-63354467dd12/1245d90f-Benchmarks.xlsx"
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } })
const page = await ctx.newPage()
const errs = []
page.on("pageerror", (e) => errs.push("PAGEERR: " + e.message))
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.fill('input[type="email"]', "demo-vendor@tydei.com")
  await page.fill('input[type="password"]', "demo-vendor-2024")
  await page.click('button[type="submit"]')
  await page.waitForURL(/vendor|dashboard/, { timeout: 30000 }).catch(()=>{})
  await page.goto(`${BASE}/vendor/prospective`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  await page.getByRole("tab", { name: "Benchmarks" }).click()
  await page.waitForTimeout(1000)
  await page.locator('input[type="file"]').first().setInputFiles(FILE)
  await page.waitForTimeout(3000)

  // Map columns dialog: Item number -> "Construct"
  const dialog = page.getByRole("dialog")
  if (await dialog.count()) {
    console.log("Column-mapper dialog opened (expected for Charles's file).")
    // First combobox in the dialog is the Item number mapper
    const combo = dialog.locator('[role="combobox"]').first()
    await combo.click()
    await page.waitForTimeout(500)
    const constructOpt = page.getByRole("option", { name: /^Construct$/i }).first()
    const oc = await constructOpt.count()
    console.log("'Construct' option available for Item number:", oc > 0)
    if (oc) await constructOpt.click()
    await page.waitForTimeout(800)
    const importBtn = dialog.getByRole("button", { name: /Import benchmarks/i })
    if (await importBtn.count()) { await importBtn.click(); console.log("clicked Import") }
    await page.waitForTimeout(3500)
  }
  await page.screenshot({ path: `${SHOT}/cf-1-afterimport.png` })

  // Proposals workspace
  await page.getByRole("tab", { name: "Proposals" }).click()
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `${SHOT}/cf-2-proposals.png`, fullPage: true })

  // Find the benchmark picker (Deal Scorer "Add product from benchmark")
  const combos = page.locator('[role="combobox"]')
  const n = await combos.count()
  console.log("comboboxes on Proposals:", n)
  let picked = false
  for (let i = 0; i < n; i++) {
    const c = combos.nth(i)
    const t = ((await c.innerText().catch(()=>"")) || "").toLowerCase()
    if (/benchmark|product|construct|add/.test(t)) {
      await c.scrollIntoViewIfNeeded(); await c.click(); await page.waitForTimeout(700)
      const opt = page.getByRole("option").filter({ hasText: /Knee/i }).first()
      if (await opt.count()) { await opt.click(); picked = true; console.log("picked via combo", i, "text:", t.slice(0,30)); break }
      await page.keyboard.press("Escape")
    }
  }
  console.log("picked benchmark construct:", picked)
  await page.waitForTimeout(1500)
  const catInputs = page.locator('input[list="deal-construct-categories"]')
  const cn = await catInputs.count()
  console.log("EDITABLE CATEGORY INPUTS present:", cn)
  if (cn > 0) {
    await catInputs.first().fill("Joint Replacement")
    await page.waitForTimeout(400)
    const v = await catInputs.first().inputValue()
    console.log("typed category holds:", JSON.stringify(v))
  }
  // Assert NO stranded "uncategorized" literal text near constructs
  const bodyTxt = await page.locator("body").innerText()
  console.log("literal 'uncategorized' present on page:", /uncategorized/i.test(bodyTxt))
  await page.screenshot({ path: `${SHOT}/cf-3-construct-category.png`, fullPage: true })
  console.log("PAGEERRORS:", errs.length ? JSON.stringify(errs.slice(0,3)) : "none")
} catch (e) {
  console.log("ERR:", e.message); await page.screenshot({ path: `${SHOT}/cf-err.png`, fullPage: true }).catch(()=>{})
} finally { await browser.close() }
