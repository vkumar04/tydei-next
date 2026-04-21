/**
 * Smoke spec: tie-in Paid to Date shows canonical sumRebateAppliedToCapital,
 * not the forecast schedule.
 *
 * Run:
 *   bun run tests/workflows/_smoke-tiein-paid.spec.ts
 */
import { chromium } from "playwright"
import { login, step, reportAndExit, TYDEI_URL, type StepResult } from "./_helpers"

const CONTRACT_ID = "cmo6j6g2k0029achl3kwvddls" // Stryker Tie-In (seeded)
const EXPECTED_PAID_TO_DATE = 195124

const results: StepResult[] = []
const logStep = (name: string, fn: () => Promise<void>) => step(results, name, fn)

async function main() {
  console.log(`\nworkflow: tie-in Paid to Date smoke\n`)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await login(browser, "facility")
    await logStep("navigate to contract detail", async () => {
      await page.goto(`${TYDEI_URL}/dashboard/contracts/${CONTRACT_ID}`, {
        waitUntil: "networkidle",
        timeout: 30_000,
      })
    })
    await logStep("Paid to Date renders and equals canonical value", async () => {
      const val = await page.evaluate(() => {
        const titles = Array.from(document.querySelectorAll("span, p, div"))
          .filter((el) => el.textContent?.trim() === "Paid To Date")
        for (const t of titles) {
          const card = t.closest("div.rounded-md, [data-slot='card'], .rounded-xl, .rounded-lg")
          const big = card?.querySelector(".text-xl, .text-2xl")
          if (big?.textContent) return big.textContent.trim()
        }
        return null
      })
      if (!val) throw new Error("Paid To Date tile not found")
      const n = parseFloat(val.replace(/[^\d.-]/g, ""))
      if (!Number.isFinite(n)) throw new Error(`Paid To Date unparseable: "${val}"`)
      if (Math.abs(n - EXPECTED_PAID_TO_DATE) > 1) {
        throw new Error(
          `Paid To Date = "${val}" (${n}) but expected ${EXPECTED_PAID_TO_DATE} (sum of collected rebates). Forecast-fallback bug.`,
        )
      }
    })
  } finally {
    await browser.close()
  }
  reportAndExit(results)
}

main().catch((err) => { console.error(err); process.exit(1) })
