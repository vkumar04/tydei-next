/**
 * Smoke spec: On-vs-Off Contract card shows real on_contract spend after
 * matcher runs (Charles W1.X-C / iMessage "off contract still..." regression).
 *
 * Run:
 *   bun run tests/workflows/tiein-offcontract-card.spec.ts
 */
import { chromium } from "playwright"
import { login, step, reportAndExit, TYDEI_URL, type StepResult } from "./_helpers"

const CONTRACT_ID = "cmo6j6g2k0029achl3kwvddls" // Stryker Tie-In

const results: StepResult[] = []
const logStep = (name: string, fn: () => Promise<void>) => step(results, name, fn)

async function main() {
  console.log(`\nworkflow: tie-in On vs Off Contract card smoke\n`)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await login(browser, "facility")
    await logStep("navigate to contract detail (Overview)", async () => {
      await page.goto(`${TYDEI_URL}/dashboard/contracts/${CONTRACT_ID}`, {
        waitUntil: "networkidle",
        timeout: 30_000,
      })
      // The card is on the Overview tab (the default).
      await page.waitForTimeout(800)
    })
    await logStep("On vs Off Contract Spend card present", async () => {
      const card = page.locator('text="On vs Off Contract Spend"').first()
      if ((await card.count()) === 0) throw new Error("card missing")
    })
    await logStep("On Contract tile shows > $0 (matcher stamped on_contract rows)", async () => {
      const val = await page.evaluate(() => {
        const labels = Array.from(document.querySelectorAll("p, span, div"))
          .filter((el) => el.textContent?.trim() === "On Contract")
        for (const l of labels) {
          // The big-money text-2xl is a sibling in the same card.
          const card = l.closest("div")
          const big = card?.querySelector(".text-2xl")
          if (big?.textContent) return big.textContent.trim()
        }
        return null
      })
      if (!val) throw new Error("On Contract tile value not found")
      const n = parseFloat(val.replace(/[^\d.-]/g, ""))
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(
          `On Contract = "${val}" — expected > $0 after matcher. Matcher did not stamp rows on_contract, or card scope filter drops them.`,
        )
      }
    })
  } finally {
    await browser.close()
  }
  reportAndExit(results)
}

main().catch((err) => { console.error(err); process.exit(1) })
