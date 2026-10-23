import { defineConfig } from "@playwright/test"

const remoteBaseURL = process.env.E2E_BASE_URL
const baseURL = remoteBaseURL ?? `http://localhost:${process.env.PORT ?? "3000"}`
const realAi = process.env.E2E_REAL_AI === "1"

/**
 * Playwright is split into two projects:
 *
 *   - visual: page-content smoke tests (existing). Runs serially, checks
 *     that each route renders its expected labels and key UI elements.
 *     Catches "500 on the contracts page" class of regressions.
 *
 *   - e2e:    user-journey tests covering real interactions (click
 *     through a form, submit, see the right data render). These cost
 *     more to run but catch the bugs vitest can't — component
 *     reconciliation, cache invalidation on mutation, multi-step flows
 *     that span server actions. Keep them focused on the journeys
 *     Charles has actually hit regressions in.
 *
 * Run:
 *   bunx playwright test --project=visual-setup --project=visual
 *   bunx playwright test --project=e2e-setup     --project=e2e
 */
export default defineConfig({
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: remoteBaseURL
    ? undefined
    : {
        command: "bun run dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 30_000,
        env: realAi ? {} : { ANTHROPIC_BASE_URL: "http://127.0.0.1:9/v1" },
      },
  projects: [
    {
      name: "visual-setup",
      timeout: 180_000,
      testMatch: /visual\/auth\.setup\.ts/,
    },
    {
      name: "visual",
      testDir: "./tests/visual",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["visual-setup"],
    },
    {
      name: "e2e-setup",
      timeout: 180_000,
      testMatch: /e2e\/auth\.setup\.ts/,
    },
    {
      name: "e2e",
      testDir: "./tests/e2e",
      testIgnore: /auth\.setup\.ts/,
      grepInvert: realAi ? undefined : /@real-ai/,
      dependencies: ["e2e-setup"],
    },
  ],
})
