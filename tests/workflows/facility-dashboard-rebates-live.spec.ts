/**
 * Workflow test: facility dashboard shows non-zero rebate / on-contract
 * / category-coverage metrics — these are computed live at read time
 * (not stored columns), so this catches the "numbers all zero because
 * demo state has no persisted rows" class of regression.
 *
 * Catches:
 *   - Dashboard rebate aggregate reads wrong column             (qa1 bug 6)
 *   - On-contract spend computed via vendorId proxy (wrong)     (qa recurring)
 *   - Category coverage drops because COG category not resolved (qa2 bug 8)
 *   - Synthetic ContractPeriods missing when no persisted rows  (qa2 bug 11)
 *
 * Run:
 *   bun run tests/workflows/facility-dashboard-rebates-live.spec.ts
 */

import { chromium, type Page } from "playwright"
import { login, step, reportAndExit, TYDEI_URL, type StepResult } from "./_helpers"

const results: StepResult[] = []
const logStep = (name: string, fn: () => Promise<void>) => step(results, name, fn)

// Scans every main-area card and returns the first card whose combined
// text matches `keyword`. Dashboard stat cards don't use a discrete
// CardTitle — the label is inlined next to the value, so substring
// match on the full card text is the only reliable path.
async function findCardText(page: Page, keyword: RegExp): Promise<string | null> {
  return await page.evaluate((src) => {
    const re = new RegExp(src.source, src.flags)
    const cards = Array.from(
      document.querySelectorAll('main [data-slot="card"]'),
    )
    for (const c of cards) {
      const txt = (c.textContent ?? "").replace(/\s+/g, " ").trim()
      if (re.test(txt)) return txt
    }
    return null
  }, { source: keyword.source, flags: keyword.flags })
}

// Extract the first dollar amount from a text blob (e.g. "$841K" → 841000,
// "$1.2M" → 1200000, "$500" → 500).
function parseDollar(text: string): number | null {
  const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([KMB])?/)
  if (!m) return null
  const base = parseFloat(m[1].replace(/,/g, ""))
  const mult = m[2] === "K" ? 1_000 : m[2] === "M" ? 1_000_000 : m[2] === "B" ? 1_000_000_000 : 1
  return base * mult
}

async function main() {
  console.log(`\nworkflow: dashboard live rebate/on-contract metrics\n`)
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await login(browser, "facility")

    await logStep("navigate to /dashboard", async () => {
      await page.goto(`${TYDEI_URL}/dashboard`, {
        waitUntil: "networkidle",
        timeout: 30_000,
      })
      await page.waitForTimeout(1500)
    })

    await logStep(
      "Total Spend / On-Contract card shows > $0 (qa1 bug 6)",
      async () => {
        const txt = await findCardText(page, /Total Spend.*On Contract|On Contract.*Total Spend/i)
        if (!txt) throw new Error("Total Spend / On Contract card not found")
        // The card reads like "99.7% $841K Total Spend $838K On Contract YTD spend".
        // Find the $ amount that appears immediately before "On Contract".
        const m = txt.match(/(\$[\d.,]+[KMB]?)\s*On Contract/i)
        if (!m) {
          throw new Error(`Could not parse on-contract $ value from: ${txt}`)
        }
        const n = parseDollar(m[1])
        if (n === null || n <= 0) {
          throw new Error(
            `On Contract = "${m[1]}" — expected > 0 (live JOIN should resolve vendor→contract)`,
          )
        }
      },
    )

    await logStep(
      "Rebates card shows > $0 collected (qa2 bug 11)",
      async () => {
        const txt = await findCardText(page, /Rebates.*Collected|Collected.*Rebates/i)
        if (!txt) throw new Error("Rebates / Collected card not found")
        // Card reads like "76.8% $81K Rebates $62K Collected earned from contracts".
        const m = txt.match(/(\$[\d.,]+[KMB]?)\s*Collected/i)
        if (!m) {
          throw new Error(`Could not parse collected $ value from: ${txt}`)
        }
        const n = parseDollar(m[1])
        if (n === null || n <= 0) {
          throw new Error(
            `Rebates Collected = "${m[1]}" — expected > 0 (synthetic periods should fire when no persisted rows)`,
          )
        }
      },
    )

    await logStep(
      "Spend-by-category shows at least one named category (not 100% Uncategorized)",
      async () => {
        // Card with heading "Spend by Category"
        const txt = await page.evaluate(() => {
          const card = Array.from(
            document.querySelectorAll('[data-slot="card"], .rounded-xl, .rounded-lg'),
          ).find((el) =>
            el.querySelector('[data-slot="card-title"],[class*="CardTitle"],h3,h2')
              ?.textContent
              ?.toLowerCase()
              .includes("spend by category"),
          )
          return card?.textContent ?? ""
        })
        if (!txt) {
          // Fall back: scan page for "Spend by Category"
          const present = await page.locator('text="Spend by Category"').count()
          if (present === 0) {
            // Not every layout has this card — skip rather than fail
            return
          }
        }
        const lower = txt.toLowerCase()
        // If the only category we see is "uncategorized" then resolution
        // fell through — the whole point of the pricing-file + contract
        // cascade is that most rows get a real category
        if (lower.includes("uncategorized") && !/implant|surgical|orthopedic|spine|biolog/.test(lower)) {
          throw new Error(
            "Spend by Category appears to be 100% Uncategorized — pricing/contract fallback not firing",
          )
        }
      },
    )
  } finally {
    await browser.close()
  }

  reportAndExit(results)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
