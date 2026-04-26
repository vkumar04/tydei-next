/**
 * Spin up a disposable Postgres container per test file, run the
 * Prisma migration baseline against it, and return a fresh
 * PrismaClient pointed at it.
 *
 * Usage (per integration test file):
 *
 *   import { setupTestDb, teardownTestDb } from "@/tests/setup/postgres-testcontainer"
 *
 *   let ctx: Awaited<ReturnType<typeof setupTestDb>>
 *   beforeAll(async () => { ctx = await setupTestDb() }, 60_000)
 *   afterAll(async () => { await teardownTestDb(ctx) })
 *
 * Each setupTestDb() call creates an isolated Postgres so tests
 * don't share state. Faster than touching the dev DB and safe to
 * run in CI without a pre-provisioned database.
 *
 * The container starts in <5s on a warm machine, ~15s cold (image
 * pull). Set TESTCONTAINERS_REUSE_ENABLE=true and reuse(true) for
 * faster local iteration; container is torn down on process exit.
 */

import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { execSync } from "node:child_process"

interface TestDbContext {
  container: StartedPostgreSqlContainer
  databaseUrl: string
}

export async function setupTestDb(): Promise<TestDbContext> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("tydei_test")
    .withUsername("test")
    .withPassword("test")
    .start()

  const databaseUrl = container.getConnectionUri()

  // Apply schema via the same migration artifact prod uses. This
  // catches any drift between the schema we develop against and
  // what migrate deploy actually does in prod.
  execSync(
    `bunx prisma migrate deploy --config=prisma/prisma.config.ts`,
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    },
  )

  return { container, databaseUrl }
}

export async function teardownTestDb(ctx: TestDbContext): Promise<void> {
  await ctx.container.stop()
}
