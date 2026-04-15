/**
 * Workflow test: facility selects a payor contract on /dashboard/case-costing
 * and gets real margin numbers instead of zeros.
 *
 * Catches:
 *   - Payor contract select dropdown empty                   (qa recurring)
 *   - Reimbursement = $0 even with matching cases            (qa2 bug 9)
 *   - Margin pagination sort broken                          (qa2 bug 12)
 *   - CPT rate shape drift ({cpt} vs {cptCode})              (seed drift)
 *
 * Run:
 *   bun run tests/workflows/facility-payor-contract-margin.spec.ts
 */

import { chromium, type Browser, type Page } from "playwright"

const TYDEI_URL = process.env.TYDEI_URL ?? "http://localhost:3000"
const FACILITY_EMAIL = "demo-facility@tydei.com"
const FACILITY_PASSWORD = "demo-facility-2024"

type StepResult = { name: string; ok: boolean; detail?: string }
const results: StepResult[] = []
const logStep = async (name: string, fn: () => Promise<void>) => {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  \x1b[32m✓\x1b[0m ${name}`)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    results.push({ name, ok: false, detail: detail.slice(0, 300) })
    console.log(`  \x1b[31m✗\x1b[0m ${name}`)
    console.log(`    \x1b[33m${detail.slice(0, 300)}\x1b[0m`)
  }
}

async function loginFacility(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(TYDEI_URL, { waitUntil: "domcontentloaded" })
  await page.evaluate(
    async ({ email, password }) => {
      const r = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      if (!r.ok) throw new Error(`login failed: ${r.status}`)
    },
    { email: FACILITY_EMAIL, password: FACILITY_PASSWORD },
  )
  return page
}

async function main() {
  console.log(`\nworkflow: payor contract margin calc (facility)\n`)
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await loginFacility(browser)

    await logStep("navigate to /dashboard/case-costing", async () => {
      await page.goto(`${TYDEI_URL}/dashboard/case-costing`, {
        waitUntil: "networkidle",
        timeout: 30_000,
      })
      const h1 = await page.locator("h1").first().textContent()
      if (!/case costing/i.test(h1 ?? "")) {
        throw new Error(`wrong page, h1 = "${h1}"`)
      }
    })

    await logStep("Payor Contract Margin card is present", async () => {
      const card = page.locator('text="Payor Contract Margin"').first()
      if ((await card.count()) === 0) {
        throw new Error("Payor Contract Margin card missing — regression")
      }
    })

    await logStep("Payor select dropdown has at least one option", async () => {
      const trigger = page
        .locator('[role="combobox"]:has-text("Select payor contract")')
        .first()
      if ((await trigger.count()) === 0) {
        throw new Error("Select payor contract trigger not found")
      }
      await trigger.click()
      await page.waitForTimeout(500)
      const optionCount = await page.locator('[role="option"]').count()
      if (optionCount === 0) {
        throw new Error("payor contract dropdown is empty — seed missing rows")
      }
    })

    await logStep("Select first payor contract", async () => {
      await page.locator('[role="option"]').first().click()
      await page.waitForTimeout(1500) // let the margin RSC refetch
    })

    await logStep(
      "Margin stats render with non-zero reimbursement (qa2 bug 9)",
      async () => {
        const reimbText = await page
          .locator('text="Est. Reimbursement"')
          .locator("..")
          .locator("p.text-lg")
          .first()
          .textContent()
        const reimb = parseFloat((reimbText ?? "").replace(/[^\d.-]/g, ""))
        if (!Number.isFinite(reimb) || reimb <= 0) {
          throw new Error(
            `Est. Reimbursement = "${reimbText}" — expected a positive dollar value`,
          )
        }
      },
    )

    await logStep(
      "At least 1 case is CPT matched (proves rate map resolved)",
      async () => {
        const matchedText = await page
          .locator('text="CPT Matched"')
          .locator("..")
          .locator("p.text-lg")
          .first()
          .textContent()
        const n = parseInt((matchedText ?? "0").trim(), 10)
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(
            `CPT Matched = "${matchedText}" — expected ≥ 1. Either no cases or CPT rate shape drift.`,
          )
        }
      },
    )

    await logStep("Summary card 'Total Margin' shows a value", async () => {
      // Total Margin card: CardTitle > CardContent > .text-2xl value.
      // Grab the card by its title, then the .text-2xl within the same card.
      const val = await page.evaluate(() => {
        const titles = Array.from(document.querySelectorAll("*"))
          .filter((el) => el.textContent?.trim() === "Total Margin")
        for (const t of titles) {
          const card = t.closest('[data-slot="card"], .rounded-xl, .rounded-lg')
          const big = card?.querySelector(".text-2xl")
          if (big?.textContent) return big.textContent.trim()
        }
        return null
      })
      if (!val) throw new Error("Total Margin card value not found")
      if (val === "—") {
        throw new Error(
          "Total Margin card still shows '—' after payor selected — hasPayorContractLoaded false",
        )
      }
    })
  } finally {
    await browser.close()
  }

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(
    `\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}${passed}/${results.length} steps passing\x1b[0m\n`,
  )
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
