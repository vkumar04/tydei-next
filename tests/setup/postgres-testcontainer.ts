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

/** Postgres image the container runs; Ryuk is testcontainers' own reaper. */
const POSTGRES_IMAGE = "postgres:16-alpine"
const RYUK_IMAGE = "testcontainers/ryuk:0.14.0"

/**
 * Fail fast when an image testcontainers needs isn't cached locally.
 *
 * Why this exists (2026-07-26): `docker pull` on this project's machines
 * can hang indefinitely inside the `desktop` credential helper — the
 * binary is a valid symlink into Docker.app but never returns, so docker
 * eventually kills it and reports
 *
 *     error getting credentials - err: signal: terminated, out: ``
 *
 * testcontainers pulls Ryuk BEFORE it starts anything, so the hang landed
 * inside `.start()`. All the test suite showed was
 *
 *     Error: Hook timed out in 90000ms
 *
 * which names neither Docker, nor Ryuk, nor credentials, and cost a long
 * debugging session to trace. Worse, `postgres:16-alpine` was already
 * cached, so plain `docker run` worked fine and made Docker look healthy.
 *
 * A cached image never touches the credential helper, so checking for one
 * is both the diagnosis and the workaround. This turns a 90s silent hang
 * into an immediate, actionable error.
 *
 * What does NOT fix it: restarting Docker Desktop. That was asserted here
 * on first write and turned out to be untrue — a full quit-and-relaunch
 * (verified 2026-07-26: every container stopped, app process restarted)
 * left the helper hanging at exactly the same 20s+ timeout. Whatever the
 * cause is, it survives an engine cycle.
 */
function assertImagesCached(): void {
  const missing: string[] = []
  for (const image of [POSTGRES_IMAGE, RYUK_IMAGE]) {
    try {
      execSync(`docker image inspect ${image}`, { stdio: "ignore", timeout: 15_000 })
    } catch {
      missing.push(image)
    }
  }
  if (missing.length === 0) return

  throw new Error(
    [
      `testcontainers needs these images cached locally, and they are not:`,
      ...missing.map((m) => `  - ${m}`),
      ``,
      `They are NOT pulled automatically here: if the Docker credential`,
      `helper hangs, the pull hangs with it and testcontainers stalls`,
      `until the hook times out.`,
      ``,
      `Pull them without going through the credential helper:`,
      ``,
      `  mkdir -p /tmp/dockercfg && echo '{}' > /tmp/dockercfg/config.json`,
      missing
        .map((m) => `  DOCKER_CONFIG=/tmp/dockercfg docker pull ${m}`)
        .join("\n"),
      ``,
      `That leaves ~/.docker/config.json untouched.`,
      ``,
      `Restarting Docker Desktop does NOT fix this — verified 2026-07-26:`,
      `the helper still hung after a full quit-and-relaunch. Check for a`,
      `blocked Docker Desktop sign-in prompt or a locked login keychain,`,
      `which produce exactly this hang. The DOCKER_CONFIG workaround above`,
      `sidesteps the helper entirely and is enough to run the tests.`,
    ].join("\n"),
  )
}

export async function setupTestDb(): Promise<TestDbContext> {
  assertImagesCached()

  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
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
