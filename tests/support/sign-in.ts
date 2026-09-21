import type { Page } from "@playwright/test"

export const SIGN_IN_ENDPOINT = "/api/auth/sign-in/email"

/**
 * better-auth caps `/sign-in/email` at 10 per 60s per IP
 * (`lib/auth-server.ts` rateLimit.customRules). Back-to-back Playwright
 * projects share that window, so a run can open against a limiter that is
 * already exhausted. A 429 produces no redirect, which previously surfaced
 * as an opaque `waitForURL` timeout.
 */
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_ATTEMPTS = 3

export async function browserSignIn(
  page: Page,
  email: string,
  password: string,
  expectedUrlPattern: RegExp,
): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await page.goto("/login")
    await page.getByLabel(/^email$/i).fill(email)
    await page.getByLabel(/^password$/i).fill(password)

    const responsePromise = page.waitForResponse(
      (r) => r.url().includes(SIGN_IN_ENDPOINT),
      { timeout: 30_000 },
    )
    await page.getByRole("button", { name: /sign in|log in/i }).click()
    const status = (await responsePromise).status()

    if (status === 200) {
      await page.waitForURL(expectedUrlPattern, { timeout: 30_000 })
      return
    }
    if (status !== 429) {
      throw new Error(`Sign-in for ${email} failed with HTTP ${status}`)
    }
    if (attempt < MAX_ATTEMPTS) {
      await page.waitForTimeout(RATE_LIMIT_WINDOW_MS)
    }
  }

  throw new Error(
    `Sign-in for ${email} was rate-limited (429) on ${MAX_ATTEMPTS} attempts ` +
      `spanning ${(MAX_ATTEMPTS - 1) * (RATE_LIMIT_WINDOW_MS / 1000)}s. ` +
      `Another Playwright project or dev session is consuming the ` +
      `10-per-60s sign-in budget.`,
  )
}
