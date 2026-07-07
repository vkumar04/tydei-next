import { chromium } from "playwright"
const BASE = "https://tydei-app-production.up.railway.app"
const SHOT = "/private/tmp/claude-501/-Users-vickkumar-code-tydei-next/4e380553-75f7-4d58-960b-63354467dd12/scratchpad"
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.fill('input[type="email"]', "demo-vendor@tydei.com")
  await page.fill('input[type="password"]', "demo-vendor-2024")
  await page.click('button[type="submit"]')
  await page.waitForURL(/vendor|dashboard/, { timeout: 30000 }).catch(()=>{})
  await page.goto(`${BASE}/vendor/prospective`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)
  // Benchmarks tab
  await page.getByRole("tab", { name: "Benchmarks" }).click()
  await page.waitForTimeout(1500)
  const fileInputs = await page.locator('input[type="file"]').count()
  console.log("Benchmarks: file inputs =", fileInputs)
  const btext = (await page.locator("main").innerText()).slice(0, 500).replace(/\n+/g," | ")
  console.log("BENCH TEXT:", btext)
  await page.screenshot({ path: `${SHOT}/bench-tab.png` })
  // Proposals tab
  await page.getByRole("tab", { name: "Proposals" }).click()
  await page.waitForTimeout(1500)
  const ptext = (await page.locator("main").innerText()).slice(0, 700).replace(/\n+/g," | ")
  console.log("PROPOSALS TEXT:", ptext)
  const comboCount = await page.locator('[role="combobox"], select').count()
  console.log("Proposals comboboxes/selects:", comboCount)
  await page.screenshot({ path: `${SHOT}/proposals-tab.png`, fullPage: true })
} catch (e) { console.log("ERR:", e.message) } finally { await browser.close() }
