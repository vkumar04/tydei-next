import { test as setup } from "@playwright/test"

/**
 * E2E auth setup — runs once before the E2E project, saves two
 * storage states (facility + vendor) so individual tests can pick
 * whichever role they need via `test.use({ storageState: ... })`.
 */

setup("authenticate as facility user", async ({ request, context }) => {
  const res = await request.post("/api/auth/sign-in/email", {
    data: {
      email: "demo-facility@tydei.com",
      password: "demo-facility-2024",
    },
  })
  if (!res.ok()) throw new Error(`Facility auth failed: ${res.status()}`)
  await context.storageState({ path: "tests/e2e/.auth/facility.json" })
})

setup("authenticate as vendor user", async ({ request, context }) => {
  const res = await request.post("/api/auth/sign-in/email", {
    data: {
      email: "demo-vendor@tydei.com",
      password: "demo-vendor-2024",
    },
  })
  if (!res.ok()) throw new Error(`Vendor auth failed: ${res.status()}`)
  await context.storageState({ path: "tests/e2e/.auth/vendor.json" })
})
