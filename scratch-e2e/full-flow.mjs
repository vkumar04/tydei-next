import { chromium } from "playwright"
const BASE = "https://tydei-app-production.up.railway.app"
const SHOT = "/private/tmp/claude-501/-Users-vickkumar-code-tydei-next/4e380553-75f7-4d58-960b-63354467dd12/scratchpad"
const FILE = "/Users/vickkumar/.claude/uploads/4e380553-75f7-4d58-960b-63354467dd12/1245d90f-Benchmarks.xlsx"
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } })
const page = await ctx.newPage()
const errs = []
page.on("pageerror", (e) => errs.push("PAGEERR: " + e.message))
const main = () => page.locator("main.flex-1.overflow-auto, main").last()
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.fill('input[type="email"]', "demo-vendor@tydei.com")
  await page.fill('input[type="password"]', "demo-vendor-2024")
  await page.click('button[type="submit"]')
  await page.waitForURL(/vendor|dashboard/, { timeout: 30000 }).catch(()=>{})
  await page.goto(`${BASE}/vendor/prospective`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)

  // 1) Upload Charles's benchmark file (no Category column)
  await page.getByRole("tab", { name: "Benchmarks" }).click()
  await page.waitForTimeout(1200)
  await page.locator('input[type="file"]').first().setInputFiles(FILE)
  await page.waitForTimeout(4000)
  const benchTxt = (await main().innerText()).replace(/\n+/g," | ")
  console.log("BENCH AFTER UPLOAD:", benchTxt.slice(0, 350))
  const hasKnee = benchTxt.includes("Cemented Knee") || /Knee/i.test(benchTxt)
  console.log("benchmark 'Knee' visible:", hasKnee)
  await page.screenshot({ path: `${SHOT}/flow-1-bench.png` })

  // 2) Proposals workspace -> Deal Scorer benchmark picker
  await page.getByRole("tab", { name: "Proposals" }).click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${SHOT}/flow-2-proposals.png`, fullPage: true })
  // find the "Add from benchmark" / benchmark picker combobox
  const combos = page.locator('[role="combobox"]')
  const n = await combos.count()
  console.log("comboboxes on Proposals:", n)
  // Look for a construct category input BEFORE picking (baseline)
  const catInputsBefore = await page.locator('input[list="deal-construct-categories"]').count()
  console.log("category inputs before pick:", catInputsBefore)

  // Try to pick a benchmark to add a construct: find combobox near "benchmark"
  let picked = false
  for (let i = 0; i < n; i++) {
    const c = combos.nth(i)
    const t = (await c.innerText().catch(()=>"")) || ""
    if (/benchmark|add.*product|pick.*product|construct/i.test(t)) {
      await c.scrollIntoViewIfNeeded()
      await c.click()
      await page.waitForTimeout(800)
      const opt = page.getByRole("option").filter({ hasText: /Knee/i }).first()
      if (await opt.count()) { await opt.click(); picked = true; break }
      await page.keyboard.press("Escape")
    }
  }
  console.log("picked benchmark construct:", picked)
  await page.waitForTimeout(1500)
  const catInputsAfter = await page.locator('input[list="deal-construct-categories"]').count()
  console.log("category inputs AFTER pick:", catInputsAfter)
  await page.screenshot({ path: `${SHOT}/flow-3-construct.png`, fullPage: true })
  console.log("PAGEERRORS:", errs.length ? JSON.stringify(errs.slice(0,3)) : "none")
} catch (e) {
  console.log("ERR:", e.message)
  await page.screenshot({ path: `${SHOT}/flow-err.png`, fullPage: true }).catch(()=>{})
} finally { await browser.close() }
