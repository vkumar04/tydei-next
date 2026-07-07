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
  // import benchmark (Construct mapping)
  await page.getByRole("tab", { name: "Benchmarks" }).click(); await page.waitForTimeout(1000)
  await page.locator('input[type="file"]').first().setInputFiles(FILE); await page.waitForTimeout(3000)
  const dialog = page.getByRole("dialog")
  await dialog.locator('[role="combobox"]').first().click(); await page.waitForTimeout(400)
  await page.getByRole("option", { name: /^Construct$/i }).first().click(); await page.waitForTimeout(500)
  await dialog.getByRole("button", { name: /^Import$/ }).click(); await page.waitForTimeout(4000)
  // Proposals -> Add from benchmark
  await page.getByRole("tab", { name: "Proposals" }).click(); await page.waitForTimeout(2000)
  const picker = page.getByRole("combobox").filter({ hasText: /Add from benchmark/i }).first()
  await picker.scrollIntoViewIfNeeded(); await picker.click(); await page.waitForTimeout(800)
  const opts = await page.getByRole("option").allInnerTexts()
  console.log("benchmark options:", JSON.stringify(opts.slice(0,8)))
  const knee = page.getByRole("option").filter({ hasText: /Knee/i }).first()
  await knee.click(); await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOT}/vc-1-picked.png`, fullPage: true })
  const catInputs = page.locator('input[list="deal-construct-categories"]')
  const cn = await catInputs.count()
  console.log(">>> EDITABLE CATEGORY INPUTS:", cn)
  if (cn > 0) {
    const before = await catInputs.first().inputValue()
    console.log(">>> seeded category value:", JSON.stringify(before))
    await catInputs.first().fill("Joint Replacement"); await page.waitForTimeout(400)
    console.log(">>> after typing:", JSON.stringify(await catInputs.first().inputValue()))
  }
  // zoom into the construct row
  const row = page.locator('text=/benchmark/').first()
  await catInputs.first().scrollIntoViewIfNeeded().catch(()=>{})
  await page.screenshot({ path: `${SHOT}/vc-2-category-cell.png` })
  console.log("PAGEERRORS:", errs.length?JSON.stringify(errs.slice(0,3)):"none")
} catch (e) { console.log("ERR:", e.message); await page.screenshot({ path: `${SHOT}/vc-err.png`, fullPage:true }).catch(()=>{}) } finally { await browser.close() }
