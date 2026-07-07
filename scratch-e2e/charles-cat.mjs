import { chromium } from "playwright"
const BASE = "https://tydei-app-production.up.railway.app"
const SHOT = "/private/tmp/claude-501/-Users-vickkumar-code-tydei-next/4e380553-75f7-4d58-960b-63354467dd12/scratchpad"
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
const page = await ctx.newPage()
const errs = []
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()) })
page.on("pageerror", (e) => errs.push("PAGEERR: " + e.message))
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" })
  await page.fill('input[type="email"]', "demo-vendor@tydei.com")
  await page.fill('input[type="password"]', "demo-vendor-2024")
  await page.click('button[type="submit"]')
  await page.waitForURL(/vendor|dashboard/, { timeout: 30000 }).catch(()=>{})
  await page.waitForTimeout(2500)
  console.log("after-login URL:", page.url())
  await page.goto(`${BASE}/vendor/prospective`, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(3500)
  console.log("prospective URL:", page.url())
  const bodyText = (await page.locator("body").innerText()).slice(0, 400)
  console.log("PAGE TEXT SNIPPET:", bodyText.replace(/\n+/g, " | "))
  // tabs present?
  const tabs = await page.locator('[role="tab"]').allInnerTexts().catch(()=>[])
  console.log("TABS:", JSON.stringify(tabs))
  await page.screenshot({ path: `${SHOT}/prospective-01.png`, fullPage: false })
  console.log("CONSOLE ERRORS:", errs.length ? JSON.stringify(errs.slice(0,5)) : "none")
} catch (e) {
  console.log("SCRIPT ERROR:", e.message)
  await page.screenshot({ path: `${SHOT}/prospective-err.png` }).catch(()=>{})
} finally {
  await browser.close()
}
