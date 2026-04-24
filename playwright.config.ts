import { defineConfig } from "@playwright/test"

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
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [
    {
      name: "visual-setup",
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
      testMatch: /e2e\/auth\.setup\.ts/,
    },
    {
      name: "e2e",
      testDir: "./tests/e2e",
      testIgnore: /auth\.setup\.ts/,
      dependencies: ["e2e-setup"],
    },
  ],
})
