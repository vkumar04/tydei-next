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
  const dialog = page.getByRole("dialog")
  const combo = dialog.locator('[role="combobox"]').first()
  await combo.click(); await page.waitForTimeout(400)
  await page.getByRole("option", { name: /^Construct$/i }).first().click()
  await page.waitForTimeout(600)
  // list dialog buttons
  const btns = await dialog.getByRole("button").allInnerTexts()
  console.log("DIALOG BUTTONS:", JSON.stringify(btns))
  // scroll dialog to bottom then click the confirm/import
  await dialog.evaluate((el) => { const s = el.querySelector('[class*="overflow"]') || el; s.scrollTop = s.scrollHeight })
  await page.waitForTimeout(400)
  const confirm = dialog.getByRole("button", { name: /^(Import|Import benchmarks|Confirm|Import \d+)/i }).last()
  if (await confirm.count()) { await confirm.click(); console.log("clicked confirm:", (await confirm.innerText().catch(()=>""))) }
  await page.waitForTimeout(4000)
  const dialogGone = (await page.getByRole("dialog").count()) === 0
  console.log("dialog closed:", dialogGone)
  await page.screenshot({ path: `${SHOT}/fin-1.png` })

  await page.getByRole("tab", { name: "Proposals" }).click({ timeout: 8000 }).catch(e=>console.log("proposals click:", e.message.slice(0,40)))
  await page.waitForTimeout(2500)
  await page.screenshot({ path: `${SHOT}/fin-2-proposals.png`, fullPage: true })
  const combos = page.locator('[role="combobox"]')
  const n = await combos.count()
  console.log("Proposals comboboxes:", n)
  // Dump combobox labels to find the benchmark picker
  for (let i=0;i<n;i++){ console.log(" combo",i,JSON.stringify(((await combos.nth(i).innerText().catch(()=>""))||"").slice(0,40))) }
  console.log("PAGEERRORS:", errs.length?JSON.stringify(errs.slice(0,3)):"none")
} catch (e) { console.log("ERR:", e.message); await page.screenshot({ path: `${SHOT}/fin-err.png`, fullPage:true }).catch(()=>{}) } finally { await browser.close() }
