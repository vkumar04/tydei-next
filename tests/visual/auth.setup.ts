import { test as setup } from "@playwright/test"

/**
 * Authenticate once and save cookies for all tests.
 * Run with: npx playwright test --project=setup
 */
setup("authenticate", async ({ request, context }) => {
  const res = await request.post("/api/auth/sign-in/email", {
    data: {
      email: "demo-facility@tydei.com",
      password: "demo-facility-2024",
    },
  })

  if (!res.ok()) {
    throw new Error(`Auth failed: ${res.status()}`)
  }

  // Save cookies to reuse across tests
  await context.storageState({ path: "tests/visual/.auth/state.json" })
})
