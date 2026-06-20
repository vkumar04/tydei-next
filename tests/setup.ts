// Test setup — runs before each test file.
//
// Loads .env so integration tests that hit the local Postgres via
// `@/lib/db` find a valid `DATABASE_URL`. Existing env vars win, so this
// is a no-op in CI environments that inject creds a different way.
import { config } from "dotenv"
import { vi } from "vitest"
config({ path: ".env", override: false })

// Global stub for the access-tier gates. Mutating server actions call
// `requireCanMutate()` / `requireCan()` (which internally hit
// `auth.api.getSession` + prisma) — in unit tests there is no request scope,
// so left un-mocked they'd throw "Not authenticated" and break ~100 existing
// action tests that only mock `@/lib/actions/auth`. Stubbing them to a
// permissive Super context here keeps those tests focused on their own
// behavior. Tests that specifically exercise the REAL gate logic
// (`auth-permissions.test.ts`) pull the actual module via `vi.importActual`,
// and tests that drive the gate explicitly (`settings-access-tier.test.ts`)
// declare their own per-file `vi.mock`, which overrides this global one.
const SUPER_CTX = { tier: "super" as const, side: "facility" as const }
vi.mock("@/lib/actions/auth-permissions", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/actions/auth-permissions")>()
  return {
    ...actual,
    getCurrentAccessContext: vi.fn().mockResolvedValue(SUPER_CTX),
    requireCan: vi.fn().mockResolvedValue(SUPER_CTX),
    requireCanMutate: vi.fn().mockResolvedValue(SUPER_CTX),
  }
})
