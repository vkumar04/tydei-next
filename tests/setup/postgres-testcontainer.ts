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
 * Make sure the images testcontainers needs are present, with a BOUNDED
 * pull, and explain the failure properly when they can't be fetched.
 *
 * Why this exists (2026-07-26): `docker pull` can hang indefinitely inside
 * the `desktop` credential helper — the binary is a valid symlink into
 * Docker.app but never returns, so docker eventually kills it and reports
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
 * The first version of this guard only CHECKED the cache and threw when an
 * image was missing. That was wrong: it hard-coded the assumption that
 * pulling is broken, so the moment pulls started working again it blocked
 * the normal path — and it would have failed every cold CI runner, where
 * nothing is cached by definition. Pull, don't just assert; the timeout is
 * what protects against the hang, not refusing to try.
 *
 * What does NOT fix the underlying hang: restarting Docker Desktop. That
 * was asserted here on first write and turned out to be untrue — a full
 * quit-and-relaunch (verified 2026-07-26: every container stopped, app
 * process restarted) left the helper hanging at the same 20s+ timeout.
 * The real fix is `credsStore: "osxkeychain"` in ~/.docker/config.json;
 * `desktop` proxies to the macOS keychain and can wedge, `osxkeychain`
 * talks to it directly and returned in 0.017s on the same machine.
 */
function ensureImagesAvailable(): void {
  const missing: string[] = []
  for (const image of [POSTGRES_IMAGE, RYUK_IMAGE]) {
    try {
      execSync(`docker image inspect ${image}`, { stdio: "ignore", timeout: 15_000 })
      continue
    } catch {
      // Not cached. Pull it — but bounded, so a hanging credential helper
      // costs 3 minutes at worst instead of blocking forever. A healthy
      // machine (and any cold CI runner, where NOTHING is cached) takes
      // this path normally and just works.
      try {
        execSync(`docker pull ${image}`, { stdio: "ignore", timeout: 180_000 })
      } catch {
        missing.push(image)
      }
    }
  }
  if (missing.length === 0) return

  throw new Error(
    [
      `testcontainers needs these images, and pulling them failed:`,
      ...missing.map((m) => `  - ${m}`),
      ``,
      `The usual cause on macOS is a wedged Docker credential helper. It`,
      `hangs instead of failing, so docker kills it and reports:`,
      ``,
      `    error getting credentials - err: signal: terminated, out: \`\``,
      ``,
      `THE FIX — set the credential store to osxkeychain in`,
      `~/.docker/config.json:`,
      ``,
      `    "credsStore": "osxkeychain"     (was: "desktop")`,
      ``,
      `"desktop" proxies to the macOS keychain and can wedge; "osxkeychain"`,
      `talks to it directly. Verified 2026-07-26: desktop hung >20s,`,
      `osxkeychain returned in 0.017s and pulls worked immediately.`,
      `Switching stores may require re-login to private registries.`,
      ``,
      `Restarting Docker Desktop does NOT fix it — a full quit-and-relaunch`,
      `left the helper hanging identically.`,
      ``,
      `To unblock this run without touching your config at all:`,
      ``,
      `  mkdir -p /tmp/dockercfg && echo '{}' > /tmp/dockercfg/config.json`,
      missing
        .map((m) => `  DOCKER_CONFIG=/tmp/dockercfg docker pull ${m}`)
        .join("\n"),
    ].join("\n"),
  )
}

export async function setupTestDb(): Promise<TestDbContext> {
  ensureImagesAvailable()

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
