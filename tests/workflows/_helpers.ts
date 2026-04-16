/**
 * Shared helpers for playwright workflow specs.
 *
 * Every spec in this folder used to redefine the same loginFacility,
 * logStep, coloured console output. Now they import from here.
 */
import type { Browser, Page } from "playwright"

export const TYDEI_URL = process.env.TYDEI_URL ?? "http://localhost:3000"

export const CREDENTIALS = {
  facility: {
    email: "demo-facility@tydei.com",
    password: "demo-facility-2024",
  },
  vendor: {
    email: "demo-vendor@tydei.com",
    password: "demo-vendor-2024",
  },
  admin: {
    email: "demo-admin@tydei.com",
    password: "demo-admin-2024",
  },
} as const

// ─── Login ──────────────────────────────────────────────────────

/**
 * Boot a browser context, hit the root to seed session storage, and
 * sign in as the requested demo role via the /api/auth/sign-in/email
 * endpoint directly. We use fetch-in-page instead of playwright's
 * request helper because the latter mangles cookie Path semantics
 * on relative cookies (Set-Cookie "Path=/" is parsed as absolute).
 */
export async function login(
  browser: Browser,
  role: keyof typeof CREDENTIALS,
): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  const page = await ctx.newPage()
  await page.goto(TYDEI_URL, { waitUntil: "domcontentloaded" })

  const { email, password } = CREDENTIALS[role]
  await page.evaluate(
    async ({ email, password }) => {
      const r = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      if (!r.ok) throw new Error(`login failed: ${r.status}`)
    },
    { email, password },
  )
  return page
}

// ─── Step runner ────────────────────────────────────────────────

export type StepResult = { name: string; ok: boolean; detail?: string }

/**
 * Thin wrapper that runs `fn`, captures success/failure, and prints
 * coloured status to stdout. Mutates `results` so the spec can
 * aggregate at the end.
 */
export async function step(
  results: StepResult[],
  name: string,
  fn: () => Promise<void>,
): Promise<void> {
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

// ─── Report + exit ──────────────────────────────────────────────

/**
 * Print the pass/fail summary and exit non-zero if anything failed.
 * Every spec calls this as the final statement; it never returns.
 */
export function reportAndExit(results: StepResult[]): never {
  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(
    `\n${failed === 0 ? "\x1b[32m" : "\x1b[31m"}${passed}/${results.length} steps passing\x1b[0m\n`,
  )
  process.exit(failed > 0 ? 1 : 0)
}
