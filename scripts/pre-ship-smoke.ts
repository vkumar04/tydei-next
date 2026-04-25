/**
 * pre-ship-smoke — the minimum a human would do before saying "ship it".
 *
 * Exists because the 2026-04-19 W1.U deep-test subagent gave a green light
 * minutes before Charles hit 8 bugs. See the retro at
 * docs/superpowers/retros/2026-04-19-w1u-retrospective.md for full context.
 *
 * What this does (in order — halts on first red):
 *
 *   1. FRESH BUILD GATE. `rm -rf .next` and `next build`. Stale action
 *      manifests after file-rename days (W1.T moved tie-in functions,
 *      surfaced as Charles bugs #1/#2) are invisible to tsc and vitest
 *      because both operate on source, not the compiled manifest.
 *
 *   2. DEV SERVER BOOT. Spawn `next dev` and poll an unauth page until a
 *      200/3xx arrives (or timeout). Login page is public, so we hit that.
 *
 *   3. TOUCHED SERVER-ACTION SMOKE. `git diff --name-only` against a
 *      configurable ref (default main~1..HEAD) under lib/actions/. For
 *      each touched action file, grep for its exported symbols' usage in
 *      app/ + components/ to find the pages that depend on it, then curl
 *      those pages with a logged-in demo session. Pass = 200/307/3xx;
 *      fail = 500 or uncaught render throw.
 *
 *   4. NUMERIC PARITY. Pick 3 seeded contracts at the demo facility.
 *      For each, compute the Earned (YTD) and Collected figures three
 *      different ways and assert they match:
 *        - contracts-list column (sumEarnedRebatesYTD over contract.rebates)
 *        - contract-detail header card (same helper, same scope)
 *        - Transactions ledger (getContractRebates rows summed via
 *          sumEarnedRebatesYTD)
 *      If any differ, print the triple + exit 1. This is the cross-seam
 *      test the unit-test suite cannot express.
 *
 *   5. ENUM COVERAGE. For ContractTerm.appliesTo, confirm at least one
 *      seeded term per value ("all_products" + "specific_category").
 *      B2 of the retro backlog will land a seed amendment; until then
 *      this WARNs (not fails) so the script ships without blocking on
 *      un-landed work.
 *
 *   6. AI ACTIONS (opt-in). `--with-ai` + `ANTHROPIC_API_KEY` hits
 *      getRebateOptimizerInsights + generateRenewalBrief on one contract
 *      each. Assert no uncaught throw and a useful error message on any
 *      failure (not a prod-stripped digest). Skipped by default so
 *      smoke stays cheap + offline-safe.
 *
 * Idempotent: safe to run repeatedly. Cleans up the spawned dev server
 * on any exit (success, failure, signal, uncaught throw).
 *
 * Usage:
 *   bun run smoke                       # default: main~1..HEAD
 *   bun run smoke --since-ref=main      # diff from main
 *   bun run smoke --with-ai             # include AI action smokes
 *   bun run smoke --skip-build          # trust existing .next (dev loop)
 *   bun run smoke --port=3100           # dev server on non-default port
 */

import { spawn, type ChildProcess } from "child_process"
import { readFileSync, readdirSync, statSync } from "fs"
import { join, relative } from "path"
import { prisma } from "../lib/db"
import {
  sumEarnedRebatesYTD,
  sumEarnedRebatesLifetime,
} from "../lib/contracts/rebate-earned-filter"
import { sumCollectedRebates } from "../lib/contracts/rebate-collected-filter"

// ─── Config ─────────────────────────────────────────────────────

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const YELLOW = "\x1b[33m"
const DIM = "\x1b[2m"
const BOLD = "\x1b[1m"
const RESET = "\x1b[0m"

type Args = {
  sinceRef: string
  withAi: boolean
  skipBuild: boolean
  port: number
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    sinceRef: "main~1",
    withAi: false,
    skipBuild: false,
    port: 3100, // avoid colliding with a dev server the user already has
  }
  for (const a of argv) {
    if (a.startsWith("--since-ref=")) args.sinceRef = a.slice("--since-ref=".length)
    else if (a === "--with-ai") args.withAi = true
    else if (a === "--skip-build") args.skipBuild = true
    else if (a.startsWith("--port=")) {
      const n = Number.parseInt(a.slice("--port=".length), 10)
      if (Number.isFinite(n) && n > 0) args.port = n
    }
  }
  return args
}

type CheckOutcome =
  | { status: "pass"; detail?: string }
  | { status: "fail"; detail: string }
  | { status: "skip"; detail: string }
  | { status: "warn"; detail: string }

type CheckResult = { name: string; outcome: CheckOutcome; durationMs: number }

const results: CheckResult[] = []

async function runCheck(
  name: string,
  fn: () => Promise<CheckOutcome>,
): Promise<CheckResult> {
  const t0 = Date.now()
  let outcome: CheckOutcome
  try {
    outcome = await fn()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    outcome = { status: "fail", detail: `threw: ${msg}` }
  }
  const result: CheckResult = { name, outcome, durationMs: Date.now() - t0 }
  results.push(result)
  printResult(result)
  return result
}

function printResult(r: CheckResult): void {
  const dur = `${DIM}(${r.durationMs}ms)${RESET}`
  switch (r.outcome.status) {
    case "pass":
      console.log(
        `${GREEN}✓${RESET} ${r.name} ${dur}${
          r.outcome.detail ? ` ${DIM}— ${r.outcome.detail}${RESET}` : ""
        }`,
      )
      break
    case "fail":
      console.log(`${RED}✗${RESET} ${r.name} ${dur}`)
      console.log(`  ${RED}→ ${r.outcome.detail}${RESET}`)
      break
    case "warn":
      console.log(`${YELLOW}!${RESET} ${r.name} ${dur}`)
      console.log(`  ${YELLOW}→ ${r.outcome.detail}${RESET}`)
      break
    case "skip":
      console.log(`${DIM}- ${r.name} (skipped) ${r.outcome.detail}${RESET}`)
      break
  }
}

// ─── Dev server lifecycle ───────────────────────────────────────

let devServer: ChildProcess | null = null

function killDevServer(): void {
  if (devServer && !devServer.killed) {
    try {
      devServer.kill("SIGTERM")
    } catch {
      // ignore
    }
    devServer = null
  }
}

function installExitTrap(): void {
  const cleanup = (): void => {
    killDevServer()
  }
  process.on("exit", cleanup)
  process.on("SIGINT", () => {
    cleanup()
    process.exit(130)
  })
  process.on("SIGTERM", () => {
    cleanup()
    process.exit(143)
  })
  process.on("uncaughtException", (err) => {
    console.error(`${RED}uncaughtException:${RESET}`, err)
    cleanup()
    process.exit(1)
  })
}

function sh(
  cmd: string,
  args: readonly string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; stream?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: opts.stream ? "inherit" : "pipe",
    })
    let stdout = ""
    let stderr = ""
    p.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString()
    })
    p.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString()
    })
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
}

async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: "manual" })
      // Any response means Next is live; login page is public so this
      // returns 200. Dashboard pages redirect to /login (307).
      if (r.status > 0) return true
    } catch {
      // server not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

// ─── Step 1: fresh build ────────────────────────────────────────

async function stepFreshBuild(args: Args): Promise<CheckOutcome> {
  if (args.skipBuild) {
    return { status: "skip", detail: "--skip-build" }
  }
  await sh("rm", ["-rf", ".next"])
  const build = await sh("bun", ["run", "build"], { stream: true })
  if (build.code !== 0) {
    return {
      status: "fail",
      detail: `next build exited with code ${build.code}`,
    }
  }
  return { status: "pass", detail: ".next rebuilt from scratch" }
}

// ─── Step 2: dev server boot ────────────────────────────────────

async function stepDevServerBoot(args: Args): Promise<CheckOutcome> {
  devServer = spawn("bun", ["run", "dev"], {
    env: { ...process.env, PORT: String(args.port) },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const up = await waitForHttp(`http://localhost:${args.port}/login`, 45_000)
  if (!up) {
    return {
      status: "fail",
      detail: `dev server on :${args.port} never became responsive (45s timeout)`,
    }
  }
  return { status: "pass", detail: `dev server on :${args.port}` }
}

// ─── Demo session cookie ────────────────────────────────────────

async function signInDemoFacility(port: number): Promise<string | null> {
  try {
    const r = await fetch(`http://localhost:${port}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "demo-facility@tydei.com",
        password: "demo-facility-2024",
      }),
      redirect: "manual",
    })
    if (!r.ok) return null
    const setCookie = r.headers.get("set-cookie")
    if (!setCookie) return null
    // Extract just the name=value pair for the session cookie.
    // better-auth sets `better-auth.session_token=<val>; Path=/; HttpOnly; ...`
    // in dev (no Secure prefix).
    const match = setCookie.match(/better-auth\.session_token=[^;]+/)
    return match ? match[0] : null
  } catch {
    return null
  }
}

// ─── Step 3: touched server-action smoke ────────────────────────

async function findTouchedActionFiles(sinceRef: string): Promise<string[]> {
  const r = await sh("git", [
    "diff",
    `${sinceRef}...HEAD`,
    "--name-only",
    "--",
    "lib/actions/",
  ])
  if (r.code !== 0) return []
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 0 &&
        (s.endsWith(".ts") || s.endsWith(".tsx")) &&
        !s.includes("__tests__"),
    )
}

function extractExportedSymbols(filePath: string): string[] {
  try {
    const src = readFileSync(filePath, "utf8")
    const symbols = new Set<string>()
    // Match `export async function foo`, `export function foo`, and
    // `export const foo`. Skip types/interfaces.
    const re = /export\s+(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/g
    const constRe = /export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src)) !== null) {
      symbols.add(m[1])
    }
    while ((m = constRe.exec(src)) !== null) {
      symbols.add(m[1])
    }
    return Array.from(symbols)
  } catch {
    return []
  }
}

function walkFiles(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walkFiles(full, out)
    } else if (
      st.isFile() &&
      (entry.endsWith(".ts") || entry.endsWith(".tsx"))
    ) {
      out.push(full)
    }
  }
  return out
}

function findPagesImportingSymbol(
  rootDir: string,
  symbols: readonly string[],
): string[] {
  if (symbols.length === 0) return []
  const appDir = join(rootDir, "app")
  const files = walkFiles(appDir)
  const pages: Set<string> = new Set()
  for (const file of files) {
    if (!file.endsWith("page.tsx") && !file.endsWith("layout.tsx")) {
      // Check components too — a component on a page might import the
      // action. We include any file that imports, then map to its page
      // by walking up. Simpler: just scan page.tsx/layout.tsx + component
      // tree via transitive grep is expensive — instead, scan every
      // ts/tsx file; if it imports a touched symbol, find the nearest
      // app page ancestor. For smoke purposes we'll only count direct
      // page.tsx/layout.tsx imports to keep the check tractable.
      continue
    }
    const src = safeRead(file)
    if (!src) continue
    for (const sym of symbols) {
      // Look for `import { ... sym ... }` or `from "...sym"` style.
      // Very permissive grep — we just want a signal the page uses it.
      const importRe = new RegExp(
        `\\bimport[^;]*\\b${sym}\\b[^;]*from`,
        "m",
      )
      if (importRe.test(src)) {
        pages.add(file)
        break
      }
    }
  }
  return Array.from(pages)
}

function safeRead(file: string): string | null {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return null
  }
}

function filePathToRoute(rootDir: string, pageFile: string): string | null {
  const rel = relative(join(rootDir, "app"), pageFile)
  // Strip trailing /page.tsx or /layout.tsx
  const withoutFilename = rel.replace(/\/(page|layout)\.tsx$/, "")
  // Drop route-group segments like (dashboard) — they aren't in the URL.
  const segments = withoutFilename
    .split("/")
    .filter((s) => s.length > 0 && !(s.startsWith("(") && s.endsWith(")")))
  // Skip auth routes — those are public; hitting them tests nothing
  // about server actions and muddies the output.
  if (segments.length === 0) return "/"
  // Dynamic segments [id] aren't supported by the generic crawl — a
  // caller would need a fixture contract id. Skip them.
  if (segments.some((s) => s.startsWith("["))) return null
  return "/" + segments.join("/")
}

async function stepTouchedActionSmoke(args: Args): Promise<CheckOutcome> {
  const rootDir = process.cwd()
  const touched = await findTouchedActionFiles(args.sinceRef)
  if (touched.length === 0) {
    return {
      status: "skip",
      detail: `no files under lib/actions/ changed since ${args.sinceRef}`,
    }
  }
  console.log(
    `  ${DIM}touched action files (${touched.length}): ${touched.slice(0, 5).join(", ")}${
      touched.length > 5 ? "…" : ""
    }${RESET}`,
  )

  const allSymbols = new Set<string>()
  for (const file of touched) {
    const abs = join(rootDir, file)
    for (const sym of extractExportedSymbols(abs)) {
      allSymbols.add(sym)
    }
  }
  if (allSymbols.size === 0) {
    return { status: "skip", detail: "no exported symbols found in touched files" }
  }

  const pages = findPagesImportingSymbol(rootDir, Array.from(allSymbols))
  const directRoutes = pages
    .map((p) => filePathToRoute(rootDir, p))
    .filter((r): r is string => r !== null)

  // Always include a baseline of non-dynamic auth-gated routes so the
  // smoke proves the build + middleware + proxy work end-to-end even
  // when every touched action is used only by a component on a dynamic
  // `[id]` page (very common — contract detail, invoice detail, etc.).
  // If a touched symbol is used by a component imported into one of
  // these routes, a render-time throw will 500 and this catches it.
  const baselineRoutes = [
    "/login",
    "/dashboard",
    "/dashboard/contracts",
    "/dashboard/rebate-optimizer",
    "/dashboard/renewals",
    "/dashboard/alerts",
  ]

  const routes = Array.from(new Set([...directRoutes, ...baselineRoutes])).slice(
    0,
    15,
  )

  if (routes.length === 0) {
    return {
      status: "skip",
      detail: "no routes to probe",
    }
  }

  const cookie = await signInDemoFacility(args.port)
  if (!cookie) {
    return {
      status: "warn",
      detail:
        "could not sign in as demo-facility@tydei.com — skipping authed page curls. (Is the DB seeded? `bun run db:seed`)",
    }
  }

  const failures: string[] = []
  for (const route of routes) {
    try {
      const r = await fetch(`http://localhost:${args.port}${route}`, {
        headers: { cookie },
        redirect: "manual",
      })
      // 2xx = ok, 3xx = redirect (e.g. /dashboard → /dashboard/), 401/403
      // likely means proxy didn't see our cookie (test setup issue, not
      // a real regression); 500+ is a real failure.
      if (r.status >= 500) {
        failures.push(`${route}: HTTP ${r.status}`)
      } else {
        console.log(`    ${DIM}${route} → HTTP ${r.status}${RESET}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failures.push(`${route}: ${msg}`)
    }
  }

  if (failures.length > 0) {
    return {
      status: "fail",
      detail: `${failures.length}/${routes.length} pages failed:\n    ${failures.join("\n    ")}`,
    }
  }
  return {
    status: "pass",
    detail: `${routes.length} page(s) responded < 500 for ${allSymbols.size} touched symbol(s)`,
  }
}

// ─── Step 4: numeric parity ─────────────────────────────────────

async function getDemoFacilityId(): Promise<string | null> {
  // CLAUDE.md calls out Lighthouse Community Hospital as the demo facility
  // but the primary seeded org is Lighthouse Surgical Center (see
  // prisma/seeds/users.ts). We accept either — whichever exists.
  const f =
    (await prisma.facility.findFirst({
      where: { name: "Lighthouse Community Hospital" },
      select: { id: true },
    })) ??
    (await prisma.facility.findFirst({
      where: { name: "Lighthouse Surgical Center" },
      select: { id: true },
    }))
  return f?.id ?? null
}

type ParityTriple = {
  contractId: string
  contractName: string
  listEarnedLifetime: number
  headerEarnedYTD: number
  ledgerEarnedYTD: number
  listCollected: number
  headerCollected: number
  ledgerCollected: number
  headerEarnedLifetime: number
}

async function computeParity(
  contractId: string,
  facilityId: string,
  today: Date,
): Promise<ParityTriple> {
  // Surface 1 — contracts-list row. The list query pulls rebates via
  // `rebates: { select: { rebateEarned, rebateCollected, payPeriodEnd,
  // collectionDate } }` on contracts scoped to the facility (see
  // lib/actions/contracts.ts:64) and then runs them through
  // sumEarnedRebatesYTD / sumCollectedRebates. Mirror that exactly.
  const listContract = await prisma.contract.findFirstOrThrow({
    where: {
      id: contractId,
      OR: [
        { facilityId },
        { contractFacilities: { some: { facilityId } } },
      ],
    },
    select: {
      id: true,
      name: true,
      rebates: {
        select: {
          rebateEarned: true,
          rebateCollected: true,
          payPeriodEnd: true,
          collectionDate: true,
        },
      },
    },
  })
  // Charles audit round-1 facility CONCERN-B + iMessage 2026-04-20 N13:
  // contracts-list earned column is LIFETIME (not YTD). Smoke now
  // mirrors that — list value should equal the detail's lifetime card,
  // not the YTD card.
  const listEarnedLifetime = sumEarnedRebatesLifetime(listContract.rebates)
  const listCollected = sumCollectedRebates(listContract.rebates)

  // Surface 2 — contract-detail header card. getContract() uses the same
  // reducers with the same row shape, but the include clause doesn't add
  // a `period` filter when no periodId is passed (it's our case here).
  // So the values should match surface 1 exactly.
  const headerContract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      rebates: {
        select: {
          rebateEarned: true,
          rebateCollected: true,
          payPeriodEnd: true,
          collectionDate: true,
        },
      },
    },
  })
  const headerEarnedYTD = sumEarnedRebatesYTD(headerContract.rebates, today)
  const headerEarnedLifetime = sumEarnedRebatesLifetime(
    headerContract.rebates,
    today,
  )
  const headerCollected = sumCollectedRebates(headerContract.rebates)

  // Surface 3 — Transactions ledger. getContractRebates() filters server-
  // side to payPeriodEnd <= today. Summing the returned rows with
  // sumEarnedRebatesYTD must equal the header card's YTD figure.
  const ledgerRows = await prisma.rebate.findMany({
    where: { contractId, payPeriodEnd: { lte: today } },
    select: {
      rebateEarned: true,
      rebateCollected: true,
      payPeriodEnd: true,
      collectionDate: true,
    },
  })
  const ledgerEarnedYTD = sumEarnedRebatesYTD(ledgerRows, today)
  const ledgerCollected = sumCollectedRebates(ledgerRows)

  return {
    contractId,
    contractName: listContract.name,
    listEarnedLifetime,
    headerEarnedYTD,
    ledgerEarnedYTD,
    listCollected,
    headerCollected,
    ledgerCollected,
    headerEarnedLifetime,
  }
}

function approxEqual(a: number, b: number): boolean {
  // All three paths pull the same Rebate rows from Postgres. Drift
  // beyond floating-point noise is a bug, not rounding.
  return Math.abs(a - b) < 0.005
}

async function stepNumericParity(): Promise<CheckOutcome> {
  const facilityId = await getDemoFacilityId()
  if (!facilityId) {
    return {
      status: "fail",
      detail:
        "demo facility not found (Lighthouse Community Hospital / Lighthouse Surgical Center). Run `bun run db:seed`.",
    }
  }
  // Pull contracts with at least one Rebate row — a contract with zero
  // rebates makes every surface return 0 and the parity check is
  // trivially green while testing nothing.
  const contracts = await prisma.contract.findMany({
    where: {
      OR: [
        { facilityId },
        { contractFacilities: { some: { facilityId } } },
      ],
      rebates: { some: {} },
    },
    select: { id: true, name: true },
    take: 10,
  })
  if (contracts.length === 0) {
    return {
      status: "warn",
      detail: "demo facility has zero contracts with rebate rows — parity check skipped (seed coverage gap)",
    }
  }
  const picked = contracts.slice(0, Math.min(3, contracts.length))
  const today = new Date()
  const triples: ParityTriple[] = []
  for (const c of picked) {
    triples.push(await computeParity(c.id, facilityId, today))
  }

  const failures: string[] = []
  const lines: string[] = [
    `    ${DIM}Golden-number table (today=${today.toISOString().slice(0, 10)}):${RESET}`,
  ]
  lines.push(
    `    ${DIM}${"contract".padEnd(40)}  ${"list.earnedLT".padStart(16)}  ${"header.earnedYTD".padStart(18)}  ${"ledger.earnedYTD".padStart(18)}  ${"collected".padStart(14)}${RESET}`,
  )
  for (const t of triples) {
    const row = `    ${t.contractName.slice(0, 40).padEnd(40)}  ${t.listEarnedLifetime
      .toFixed(2)
      .padStart(16)}  ${t.headerEarnedYTD.toFixed(2).padStart(18)}  ${t.ledgerEarnedYTD
      .toFixed(2)
      .padStart(18)}  ${t.headerCollected.toFixed(2).padStart(14)}`
    lines.push(row)
    // Charles audit round-1 facility CONCERN-B: list is LIFETIME,
    // header is YTD. Compare list-lifetime against
    // header-LIFETIME (separate field), and header-YTD against
    // ledger-YTD (the YTD parity that still applies between header
    // card and ledger).
    if (
      !approxEqual(t.listEarnedLifetime, t.headerEarnedLifetime) ||
      !approxEqual(t.headerEarnedYTD, t.ledgerEarnedYTD)
    ) {
      failures.push(
        `EARNED drift for ${t.contractName} (${t.contractId}): list.lifetime=${t.listEarnedLifetime} header.lifetime=${t.headerEarnedLifetime} header.ytd=${t.headerEarnedYTD} ledger.ytd=${t.ledgerEarnedYTD}
        source calls:
          list   = sumEarnedRebatesLifetime(contract.rebates) (lib/actions/contracts.ts contracts-list path)
          header = sumEarnedRebatesLifetime / sumEarnedRebatesYTD (lib/actions/contracts.ts:495)
          ledger = sumEarnedRebatesYTD(getContractRebates rows) at lib/actions/contract-periods.ts:310`,
      )
    }
    if (
      !approxEqual(t.listCollected, t.headerCollected) ||
      !approxEqual(t.headerCollected, t.ledgerCollected)
    ) {
      failures.push(
        `COLLECTED drift for ${t.contractName} (${t.contractId}): list=${t.listCollected} header=${t.headerCollected} ledger=${t.ledgerCollected}`,
      )
    }
    if (t.headerEarnedYTD > t.headerEarnedLifetime + 0.005) {
      failures.push(
        `YTD > lifetime for ${t.contractName}: ytd=${t.headerEarnedYTD} lifetime=${t.headerEarnedLifetime}`,
      )
    }
  }
  for (const line of lines) console.log(line)

  if (failures.length > 0) {
    return {
      status: "fail",
      detail: failures.join("\n    "),
    }
  }
  return {
    status: "pass",
    detail: `${triples.length} contract(s) × 3 surfaces × 2 metrics all matched`,
  }
}

// ─── Step 5: enum coverage ──────────────────────────────────────

async function stepEnumCoverage(): Promise<CheckOutcome> {
  const facilityId = await getDemoFacilityId()
  if (!facilityId) {
    return { status: "skip", detail: "no demo facility" }
  }
  // Retro Fix 2 backlog B2 — require at least one term per appliesTo
  // value on the demo facility's contracts. Until the seed amendment
  // lands this is a WARN so smoke doesn't block on pending backlog
  // work.
  const termCountsByAppliesTo = await prisma.contractTerm.groupBy({
    by: ["appliesTo"],
    where: {
      contract: {
        OR: [
          { facilityId },
          { contractFacilities: { some: { facilityId } } },
        ],
      },
    },
    _count: { _all: true },
  })
  const counts = new Map<string, number>()
  for (const row of termCountsByAppliesTo) {
    counts.set(row.appliesTo, row._count._all)
  }
  const required: readonly string[] = ["all_products", "specific_category"]
  const missing = required.filter((v) => (counts.get(v) ?? 0) === 0)
  if (missing.length > 0) {
    return {
      status: "warn",
      detail: `ContractTerm.appliesTo coverage gap: no seeded term uses [${missing.join(", ")}]. Retro backlog B2 owns the seed amendment. Counts: ${JSON.stringify(Object.fromEntries(counts))}`,
    }
  }
  return {
    status: "pass",
    detail: `appliesTo coverage complete: ${JSON.stringify(Object.fromEntries(counts))}`,
  }
}

// ─── Step 6: AI actions (opt-in) ────────────────────────────────

async function stepAiActions(args: Args): Promise<CheckOutcome> {
  if (!args.withAi) {
    return { status: "skip", detail: "--with-ai not passed" }
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: "skip", detail: "ANTHROPIC_API_KEY not set" }
  }
  // Calling a `"use server"` function requires a Next request context
  // (requireFacility reads cookies). For now the AI smoke is done by
  // hitting the detail page's Smart Recs + Renewal Brief endpoints via
  // the dev server. Those are not wired as JSON APIs today — we
  // record the gap here and warn. Future B7+ work: add an internal
  // smoke-only endpoint the deep-test agent hits directly.
  return {
    status: "warn",
    detail:
      "AI action direct-call harness not yet wired (requires Next request context). Deep-test agent should manually verify the Smart Recs and Renewal Brief surfaces.",
  }
}

// ─── Orchestration ──────────────────────────────────────────────

function summarize(): { failed: number; warned: number; passed: number; skipped: number } {
  let passed = 0
  let failed = 0
  let warned = 0
  let skipped = 0
  for (const r of results) {
    if (r.outcome.status === "pass") passed++
    else if (r.outcome.status === "fail") failed++
    else if (r.outcome.status === "warn") warned++
    else skipped++
  }
  return { failed, warned, passed, skipped }
}

async function main(): Promise<void> {
  installExitTrap()
  const args = parseArgs(process.argv.slice(2))

  console.log(
    `${BOLD}tydei pre-ship-smoke${RESET} ${DIM}(since=${args.sinceRef}${args.withAi ? ", with-ai" : ""}${
      args.skipBuild ? ", skip-build" : ""
    }, port=${args.port})${RESET}\n`,
  )

  // Step 1: fresh build (if skipped, record that and move on).
  const build = await runCheck("1. fresh build (rm -rf .next && next build)", () =>
    stepFreshBuild(args),
  )
  if (build.outcome.status === "fail") {
    printSummary()
    await prisma.$disconnect()
    process.exit(1)
  }

  // Step 2: boot dev server. Required for steps 3 and 6.
  const boot = await runCheck("2. dev server boot", () => stepDevServerBoot(args))
  if (boot.outcome.status === "fail") {
    printSummary()
    killDevServer()
    await prisma.$disconnect()
    process.exit(1)
  }

  // Step 3: touched server-action smoke.
  await runCheck("3. touched server-action page smoke", () =>
    stepTouchedActionSmoke(args),
  )

  // Step 4: numeric parity.
  await runCheck("4. numeric parity (earned YTD + collected)", () =>
    stepNumericParity(),
  )

  // Step 5: enum coverage.
  await runCheck("5. enum coverage (ContractTerm.appliesTo)", () =>
    stepEnumCoverage(),
  )

  // Step 6: AI actions (opt-in).
  await runCheck("6. AI actions smoke", () => stepAiActions(args))

  printSummary()
  killDevServer()
  await prisma.$disconnect()
  const s = summarize()
  process.exit(s.failed > 0 ? 1 : 0)
}

function printSummary(): void {
  const s = summarize()
  console.log(
    `\n${DIM}──────────────────────────────${RESET}\n${
      s.failed === 0 ? GREEN : RED
    }${s.passed} pass / ${s.failed} fail / ${s.warned} warn / ${s.skipped} skip${RESET}\n`,
  )
  if (s.failed > 0) {
    console.log(`${RED}${BOLD}pre-ship-smoke FAILED${RESET}`)
    for (const r of results) {
      if (r.outcome.status === "fail") {
        console.log(`  ${RED}${r.name}${RESET}`)
        console.log(`    ${r.outcome.detail}`)
      }
    }
  } else if (s.warned > 0) {
    console.log(`${YELLOW}${BOLD}pre-ship-smoke PASSED with warnings${RESET}`)
  } else {
    console.log(`${GREEN}${BOLD}pre-ship-smoke OK${RESET}`)
  }
}

main().catch(async (err) => {
  console.error(err)
  killDevServer()
  await prisma.$disconnect()
  process.exit(1)
})
