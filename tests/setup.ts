// Test setup — runs before each test file.
//
// Loads .env so integration tests that hit the local Postgres via
// `@/lib/db` find a valid `DATABASE_URL`. Existing env vars win, so this
// is a no-op in CI environments that inject creds a different way.
import { config } from "dotenv"
config({ path: ".env", override: false })
