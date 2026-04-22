# W2.A Phase 1 — Arthrex Cluster Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a single committed diagnostic markdown file that dumps every
piece of state the Arthrex contract's detail surfaces read from, so we can
decide which of bugs (1)–(4) are code bugs, data bugs, or both — before
writing any fix.

**Architecture:** A single `bun` script under `scripts/` follows the
established W1.X-C / W1.X-D diagnostic pattern: locate contract, enumerate
state in sections, print markdown to stdout, redirect into
`docs/superpowers/diagnostics/`. No fixes are written in this phase.

**Tech Stack:** Bun runtime, Prisma 7 client (`@/lib/db`), existing canonical
helpers from `lib/contracts/` (`sumEarnedRebatesYTD`,
`sumEarnedRebatesLifetime`, `sumCollectedRebates`). No new deps.

**Spec:** `docs/superpowers/specs/2026-04-22-charles-w2a-arthrex-cluster-design.md`

---

## File Structure

Files created by this plan:

- `scripts/diagnose-arthrex-cluster.ts` — the diagnostic script. Single
  responsibility: given a contract id (or a predicate that resolves to one),
  dump 8 sections of state. Pure reads — no writes, no mutations.
- `docs/superpowers/diagnostics/2026-04-22-w2a-arthrex-cluster.md` —
  committed output of running the script.

Files touched: none. This phase is read-only.

---

## Task 1: Skeleton the diagnostic script

**Files:**
- Create: `scripts/diagnose-arthrex-cluster.ts`

- [ ] **Step 1: Create the script skeleton**

Follow the existing pattern from `scripts/diagnose-off-contract-spend.ts`
(entrypoint, `main()`, `prisma.$disconnect()`, error handler).

```ts
/**
 * diagnose-arthrex-cluster — Charles W2.A diagnostic.
 *
 * Given a contract id (or the demo-facility Arthrex contract auto-located
 * by vendor + totalValue + expiration), dumps the full state feeding the
 * contract-detail surfaces Charles flagged on 2026-04-22:
 *   - header card (Rebates Earned YTD / Collected lifetime / Current Spend)
 *   - On vs Off Contract Spend card
 *   - Transactions tab rebate totals
 *   - Contract list row metrics
 *
 * Usage:
 *   bun --env-file=.env scripts/diagnose-arthrex-cluster.ts \
 *     [--contractId=<id>] \
 *     > docs/superpowers/diagnostics/2026-04-22-w2a-arthrex-cluster.md
 *
 * If no --contractId is passed, the script auto-locates the demo
 * facility's Arthrex contract by vendor name like '%Arthrex%', facility
 * id cmo4sbr8p0004wthl91ubwfwb, and totalValue within $10k of $1,808,002.
 * Fails fast if 0 or >1 matches.
 */
import { prisma } from "@/lib/db"

const DEMO_FACILITY_ID = "cmo4sbr8p0004wthl91ubwfwb"

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit?.slice(prefix.length)
}

async function resolveContractId(): Promise<string> {
  const explicit = parseArg("contractId")
  if (explicit) return explicit

  const candidates = await prisma.contract.findMany({
    where: {
      facilityId: DEMO_FACILITY_ID,
      vendor: { is: { name: { contains: "Arthrex", mode: "insensitive" } } },
      totalValue: { gte: 1_798_000, lte: 1_818_000 },
    },
    select: { id: true, name: true, totalValue: true },
  })
  if (candidates.length === 0)
    throw new Error(
      "No Arthrex contract found at demo facility with totalValue ≈ $1,808,002. Pass --contractId explicitly.",
    )
  if (candidates.length > 1)
    throw new Error(
      `Multiple candidates found: ${candidates
        .map((c) => `${c.id} (${c.name})`)
        .join(", ")}. Pass --contractId explicitly.`,
    )
  return candidates[0].id
}

async function main() {
  const contractId = await resolveContractId()
  console.log(`# Arthrex cluster diagnostic — ${contractId}\n`)
  console.log(`_Generated: ${new Date().toISOString()}_\n`)

  // Sections 1–8 land here in subsequent tasks.

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Smoke-run the skeleton**

Run: `bun --env-file=.env scripts/diagnose-arthrex-cluster.ts 2>&1 | head -5`
Expected: prints a line starting with `# Arthrex cluster diagnostic —`
followed by a contract id. If it errors with "No Arthrex contract found",
first check the demo DB has an Arthrex contract near $1.8M; if not, pass
`--contractId=<actual>` after eyeballing `prisma studio`.

- [ ] **Step 3: Commit**

```bash
git add scripts/diagnose-arthrex-cluster.ts
git commit -m "feat(diagnostics): W2.A skeleton diagnose-arthrex-cluster"
```

---

## Task 2: Section 1 — Contract row + tiers

**Files:**
- Modify: `scripts/diagnose-arthrex-cluster.ts`

- [ ] **Step 1: Add the section-1 block**

Inside `main()` after the generated-timestamp line, before
`$disconnect`, insert:

```ts
const contract = await prisma.contract.findUniqueOrThrow({
  where: { id: contractId },
  include: {
    vendor: { select: { id: true, name: true } },
    tiers: true,
  },
})

console.log(`## 1. Contract row\n`)
console.log("| field | value |")
console.log("|---|---|")
for (const [k, v] of Object.entries(contract)) {
  if (k === "tiers" || k === "vendor") continue
  const display =
    v instanceof Date
      ? v.toISOString()
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v)
  console.log(`| ${k} | ${display} |`)
}
console.log(`| vendor | ${contract.vendor?.name ?? "(null)"} (${contract.vendor?.id ?? "(null)"}) |`)
console.log()

console.log(`## 2. Tiers (${contract.tiers.length})\n`)
console.log(
  "| id | tierIndex | baseline | target | rebateValue (raw) | rebateValue (×100) | rebateKind |",
)
console.log("|---|---:|---:|---:|---:|---:|---|")
for (const t of contract.tiers) {
  const raw = Number(t.rebateValue ?? 0)
  console.log(
    `| ${t.id} | ${t.tierIndex} | ${Number(t.baseline ?? 0)} | ${Number(t.target ?? 0)} | ${raw} | ${(raw * 100).toFixed(4)} | ${t.rebateKind} |`,
  )
}
console.log()
```

If the tier field names above don't match the Prisma schema, adjust to
match. Grep for actual field names with: `grep -n 'model ContractTier' -A 30 prisma/schema.prisma`.

- [ ] **Step 2: Run and verify output**

Run: `bun --env-file=.env scripts/diagnose-arthrex-cluster.ts 2>&1 | head -50`
Expected: prints `## 1. Contract row` with a table, then `## 2. Tiers (N)`
with one row per tier. `rebateValue (raw)` should be a fraction (e.g.
`0.02`) and `rebateValue (×100)` its percent equivalent (e.g. `2.0000`).

- [ ] **Step 3: Commit**

```bash
git add scripts/diagnose-arthrex-cluster.ts
git commit -m "feat(diagnostics): W2.A section 1+2 contract + tiers"
```

---

## Task 3: Section 3 — Rebate rows

**Files:**
- Modify: `scripts/diagnose-arthrex-cluster.ts`

- [ ] **Step 1: Add section 3**

Append to `main()` after section 2:

```ts
const rebates = await prisma.rebate.findMany({
  where: { contractId },
  orderBy: [{ payPeriodStart: "asc" }, { createdAt: "asc" }],
})

console.log(`## 3. Rebate rows (${rebates.length})\n`)
console.log(
  "| payPeriodStart | payPeriodEnd | amountEarned | collectedAmount | collectionDate | engineVersion | createdAt |",
)
console.log("|---|---|---:|---:|---|---|---|")
for (const r of rebates) {
  console.log(
    `| ${r.payPeriodStart?.toISOString().slice(0, 10) ?? "—"} | ${r.payPeriodEnd?.toISOString().slice(0, 10) ?? "—"} | ${Number(r.amountEarned ?? 0).toFixed(2)} | ${Number(r.collectedAmount ?? 0).toFixed(2)} | ${r.collectionDate?.toISOString().slice(0, 10) ?? "—"} | ${(r as { engineVersion?: string | null }).engineVersion ?? "—"} | ${r.createdAt.toISOString().slice(0, 10)} |`,
  )
}
console.log()
```

If a field name (e.g. `amountEarned`) doesn't match Prisma, grep
`prisma/schema.prisma` for `model Rebate` and adjust. Do **not** guess —
mismatched field names will produce `undefined` in the table and mask real
data.

- [ ] **Step 2: Run and verify**

Run: `bun --env-file=.env scripts/diagnose-arthrex-cluster.ts 2>&1 | grep -A 20 "## 3"`
Expected: two rebate rows for the Arthrex contract (per screenshot:
$319,525 and $319,865). If zero rows, that already disproves the
"Transactions tab shows $639K" claim — surface this finding.

- [ ] **Step 3: Commit**

```bash
git add scripts/diagnose-arthrex-cluster.ts
git commit -m "feat(diagnostics): W2.A section 3 rebate rows"
```

---

## Task 4: Section 4 — ContractPeriod rollups

**Files:**
- Modify: `scripts/diagnose-arthrex-cluster.ts`

- [ ] **Step 1: Add section 4**

```ts
const periods = await prisma.contractPeriod.findMany({
  where: { contractId },
  orderBy: { periodStart: "asc" },
})

console.log(`## 4. ContractPeriod rollups (${periods.length})\n`)
if (periods.length === 0) {
  console.log("_(none)_\n")
} else {
  console.log(
    "| periodStart | periodEnd | spend | rebateEarned | rebateCollected | tierHit |",
  )
  console.log("|---|---|---:|---:|---:|---|")
  for (const p of periods) {
    console.log(
      `| ${p.periodStart?.toISOString().slice(0, 10) ?? "—"} | ${p.periodEnd?.toISOString().slice(0, 10) ?? "—"} | ${Number((p as { spend?: unknown }).spend ?? 0).toFixed(2)} | ${Number((p as { rebateEarned?: unknown }).rebateEarned ?? 0).toFixed(2)} | ${Number((p as { rebateCollected?: unknown }).rebateCollected ?? 0).toFixed(2)} | ${(p as { tierHit?: unknown }).tierHit ?? "—"} |`,
    )
  }
  console.log()
}
```

Again, confirm the field names against Prisma before running. Adjust if
the model uses different names (e.g. `startDate`/`endDate`).

- [ ] **Step 2: Run and verify**

Run: `bun --env-file=.env scripts/diagnose-arthrex-cluster.ts 2>&1 | grep -A 10 "## 4"`
Expected: zero or more period rollups, no Prisma errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/diagnose-arthrex-cluster.ts
git commit -m "feat(diagnostics): W2.A section 4 contract periods"
```

---

## Task 5: Section 5 — COG rows by matchStatus (full lifetime)

**Files:**
- Modify: `scripts/diagnose-arthrex-cluster.ts`

- [ ] **Step 1: Add section 5**

```ts
const scopeOR = [
  { contractId: contract.id },
  { contractId: null, vendorId: contract.vendorId },
]
const cogWhere = {
  facilityId: contract.facilityId ?? undefined,
  OR: scopeOR,
}

const cogByStatus = await prisma.cOGRecord.groupBy({
  by: ["matchStatus"],
  where: cogWhere,
  _sum: { extendedPrice: true },
  _count: { _all: true },
})

console.log(`## 5. COG rows in contract+same-vendor scope (lifetime)\n`)
console.log("| matchStatus | count | sum extendedPrice |")
console.log("|---|---:|---:|")
for (const b of cogByStatus) {
  console.log(
    `| ${b.matchStatus ?? "(null)"} | ${b._count._all} | ${Number(b._sum?.extendedPrice ?? 0).toFixed(2)} |`,
  )
}
console.log()

const top = await prisma.cOGRecord.findMany({
  where: cogWhere,
  orderBy: { extendedPrice: "desc" },
  take: 15,
  select: {
    id: true,
    vendorItemNo: true,
    inventoryDescription: true,
    extendedPrice: true,
    matchStatus: true,
    matchConfidence: true,
    transactionDate: true,
    contractId: true,
    vendorId: true,
  },
})

console.log(`### Top 15 rows by extendedPrice\n`)
console.log(
  "| vendorItem | desc (40ch) | contractId | matchStatus | confidence | spend | txnDate |",
)
console.log("|---|---|---|---|---:|---:|---|")
for (const r of top) {
  console.log(
    `| ${r.vendorItemNo ?? ""} | ${(r.inventoryDescription ?? "").slice(0, 40)} | ${r.contractId ? r.contractId.slice(0, 8) + "…" : "(null)"} | ${r.matchStatus} | ${r.matchConfidence ?? "—"} | ${Number(r.extendedPrice).toFixed(2)} | ${r.transactionDate?.toISOString().slice(0, 10) ?? ""} |`,
  )
}
console.log()
```

- [ ] **Step 2: Run and verify**

Run: `bun --env-file=.env scripts/diagnose-arthrex-cluster.ts 2>&1 | grep -A 30 "## 5"`
Expected: a matchStatus breakdown (probably showing zero `on_contract` and
lots of `out_of_scope` per Charles's report), and a top-15 that makes the
pattern human-readable.

- [ ] **Step 3: Commit**

```bash
git add scripts/diagnose-arthrex-cluster.ts
git commit -m "feat(diagnostics): W2.A section 5 COG matchStatus breakdown"
```

---

## Task 6: Section 6 — Trailing-12-months slice

**Files:**
- Modify: `scripts/diagnose-arthrex-cluster.ts`

- [ ] **Step 1: Add section 6**

```ts
const trailingStart = new Date()
trailingStart.setFullYear(trailingStart.getFullYear() - 1)

const cogByStatus12mo = await prisma.cOGRecord.groupBy({
  by: ["matchStatus"],
  where: { ...cogWhere, transactionDate: { gte: trailingStart } },
  _sum: { extendedPrice: true },
  _count: { _all: true },
})

console.log(`## 6. COG trailing-12-months (since ${trailingStart.toISOString().slice(0, 10)})\n`)
console.log("| matchStatus | count | sum extendedPrice |")
console.log("|---|---:|---:|")
for (const b of cogByStatus12mo) {
  console.log(
    `| ${b.matchStatus ?? "(null)"} | ${b._count._all} | ${Number(b._sum?.extendedPrice ?? 0).toFixed(2)} |`,
  )
}
console.log()
```

- [ ] **Step 2: Run and verify**

Run: `bun --env-file=.env scripts/diagnose-arthrex-cluster.ts 2>&1 | grep -A 10 "## 6"`
Expected: a smaller subset of the section-5 totals.

- [ ] **Step 3: Commit**

```bash
git add scripts/diagnose-arthrex-cluster.ts
git commit -m "feat(diagnostics): W2.A section 6 trailing-12mo COG"
```

---

## Task 7: Section 7 — Surface-feeding server-action return values

**Files:**
- Modify: `scripts/diagnose-arthrex-cluster.ts`

- [ ] **Step 1: Locate the four server actions**

Run the following greps and note each result — you'll import these in
Step 2:

```bash
grep -n "export async function getContracts\b" lib/actions/contracts.ts
grep -rn "export async function getOffContractSpend\b\|export async function getOnOffContractSpend\b" lib/actions/contracts/
grep -rn "export async function.*rebateEarnedYTD\|export async function getContractDetail\b\|export async function getContractStats\b" lib/actions/
grep -rn "export async function.*Transactions\b" lib/actions/contracts/ lib/actions/
```

Record the four exact `import` paths:

- Header-card feed: `<path>` (likely in `lib/actions/contracts.ts` or
  `lib/actions/contracts/*`)
- On/Off Contract Spend: `@/lib/actions/contracts/off-contract-spend`
  (export name from grep above)
- Transactions tab: `<path>` (likely feeds
  `components/contracts/contract-transactions.tsx` — follow its server
  action imports)
- Contract list row: `@/lib/actions/contracts` (`getContracts`)

If any import requires auth (`requireFacility()` / session), the script
needs to **bypass** — diagnostics read directly, not through the action.
Instead, call the underlying Prisma queries or the canonical helpers
directly, and label the section: `## 7. Equivalent server-action reads
(Prisma-direct; bypasses auth gate)`.

- [ ] **Step 2: Add section 7**

```ts
import {
  sumEarnedRebatesYTD,
  sumEarnedRebatesLifetime,
} from "@/lib/contracts/rebate-earned-filter"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"

// … inside main(), after section 6:

console.log(`## 7. Canonical-helper readouts (Prisma-direct)\n`)
const earnedYTD = sumEarnedRebatesYTD(rebates)
const earnedLifetime = sumEarnedRebatesLifetime(rebates)
const collectedLifetime = sumCollectedRebates(rebates)

console.log("| metric | value |")
console.log("|---|---:|")
console.log(`| sumEarnedRebatesYTD(rebates) | ${earnedYTD.toFixed(2)} |`)
console.log(`| sumEarnedRebatesLifetime(rebates) | ${earnedLifetime.toFixed(2)} |`)
console.log(`| sumCollectedRebates(rebates) | ${collectedLifetime.toFixed(2)} |`)
console.log()
```

If any canonical helper import path differs (e.g. function name is
`sumEarnedRebatesLifetime` vs `sumEarnedRebatesTotal`), fix the import.
`ls lib/contracts/rebate-earned-filter.ts` and grep for `export` to
confirm.

- [ ] **Step 3: Run and verify**

Run: `bun --env-file=.env scripts/diagnose-arthrex-cluster.ts 2>&1 | grep -A 8 "## 7"`
Expected: three non-negative numbers. If `sumEarnedRebatesLifetime`
disagrees with the Transactions-tab $639,390 screenshot, **that's the
smoking gun** for bug (3).

- [ ] **Step 4: Commit**

```bash
git add scripts/diagnose-arthrex-cluster.ts
git commit -m "feat(diagnostics): W2.A section 7 canonical-helper readouts"
```

---

## Task 8: Section 8 — Reconciliation deltas

**Files:**
- Modify: `scripts/diagnose-arthrex-cluster.ts`

- [ ] **Step 1: Add section 8**

```ts
console.log(`## 8. Reconciliation notes\n`)
console.log(`- Rebate rows found: **${rebates.length}**`)
console.log(`- Rebate rows with collectionDate set: **${rebates.filter((r) => r.collectionDate).length}**`)
console.log(
  `- Sum of raw amountEarned over all rows: **$${rebates.reduce((s, r) => s + Number(r.amountEarned ?? 0), 0).toFixed(2)}**`,
)
console.log(
  `- Sum via sumEarnedRebatesLifetime (filters to payPeriodEnd <= today): **$${earnedLifetime.toFixed(2)}**`,
)
console.log(
  `- Sum via sumEarnedRebatesYTD (filters to current year closed periods): **$${earnedYTD.toFixed(2)}**`,
)
console.log(
  `- Sum via sumCollectedRebates (requires collectionDate set): **$${collectedLifetime.toFixed(2)}**`,
)
console.log()
console.log(`### Screenshots Charles sent (for cross-check)\n`)
console.log(`- Header "Rebates Earned (YTD)" displayed: **$0**`)
console.log(`- Header "Rebates Collected (lifetime)" displayed: **$0**`)
console.log(`- Header "Current Spend (Last 12 Months)" displayed: **$0** on first load, **$1,559,528** on reload`)
console.log(`- On/Off card: **$0 On**, **$3,389,667 Not Priced**`)
console.log(`- Transactions tab "Total Rebates (lifetime)" displayed: **$639,390**`)
console.log(`- Transactions tab period rows: Dec 31 2023–Dec 30 2024 earned **$319,865**; Dec 31 2024–Dec 30 2025 earned **$319,525**`)
console.log()
console.log(`### Flags to verify by eye\n`)
console.log(`1. Does **section 5 on_contract count > 0**? If 0, bug (1) confirmed at matcher level.`)
console.log(`2. Does **section 7 sumEarnedRebatesLifetime ≈ $639,390**? If yes → header card is wrong; if no → Transactions tab is wrong.`)
console.log(`3. Does **section 3 amountEarned** for each row equal **\`tier.target * tier.rebateValue\`** within $1? If yes, rebate-engine fabrication (bug 4) confirmed.`)
console.log(`4. Do **section 2 tier rebateValue (raw)** values fit in (0, 1)? If any ≥ 1, rebate-units bug (already fixed in principle by Charles W1.R — confirm no regression).`)
console.log(`5. **Bug (2) flicker** is NOT visible here — this is a server-side read. If sections 5/6 and the canonical helpers are stable across two runs, the flicker is a client/cache issue.`)
```

- [ ] **Step 2: Run twice, diff for stability**

Run the script twice and confirm identical output (proves the server-side
values are deterministic — so bug 2's flicker is client/caching):

```bash
bun --env-file=.env scripts/diagnose-arthrex-cluster.ts > /tmp/arthrex1.md
bun --env-file=.env scripts/diagnose-arthrex-cluster.ts > /tmp/arthrex2.md
diff /tmp/arthrex1.md /tmp/arthrex2.md
```

Expected: only the `_Generated: ...` timestamp line differs. If any
numeric field differs, **stop** — record the delta; bug (2) is
server-side.

- [ ] **Step 3: Commit**

```bash
git add scripts/diagnose-arthrex-cluster.ts
git commit -m "feat(diagnostics): W2.A section 8 reconciliation notes"
```

---

## Task 9: Produce and commit the diagnostic output

**Files:**
- Create: `docs/superpowers/diagnostics/2026-04-22-w2a-arthrex-cluster.md`

- [ ] **Step 1: Generate the file**

```bash
bun --env-file=.env scripts/diagnose-arthrex-cluster.ts \
  > docs/superpowers/diagnostics/2026-04-22-w2a-arthrex-cluster.md
```

Expected exit code: 0. If the script errors, fix the error in the
relevant task above and re-run.

- [ ] **Step 2: Sanity-check the file**

```bash
wc -l docs/superpowers/diagnostics/2026-04-22-w2a-arthrex-cluster.md
grep -E "^## [1-8]\." docs/superpowers/diagnostics/2026-04-22-w2a-arthrex-cluster.md
```

Expected: `wc -l` > 40; grep returns sections 1–8 in order.

- [ ] **Step 3: Quick-read check**

Print the file and eyeball all 8 sections. Confirm each has populated
(non-empty) data. A section with `(none)` for periods is fine; a section
with an empty table body is a bug in that section's task — go back and
fix.

- [ ] **Step 4: Commit the diagnostic**

```bash
git add docs/superpowers/diagnostics/2026-04-22-w2a-arthrex-cluster.md
git commit -m "docs(diagnostics): W2.A Arthrex cluster Phase 1 output"
```

---

## Task 10: Phase-1 completion gate

- [ ] **Step 1: Final verification (read-only, no code changes)**

Run: `bunx tsc --noEmit 2>&1 | tail -20`
Expected: 0 errors. Phase 1 only adds a script; it should not introduce
type errors. If any appear, they're in the new script — fix them.

- [ ] **Step 2: Post-run summary for Vick**

Do **NOT** begin Phase 2. Instead, post a one-screen summary that
answers the five "Flags to verify by eye" questions from section 8,
using the diagnostic file you just produced. Format:

```
Phase 1 done. Diagnostic at docs/superpowers/diagnostics/2026-04-22-w2a-arthrex-cluster.md.

Flag 1 (on_contract count): <count> → bug (1) <confirmed|not confirmed>
Flag 2 (earnedLifetime vs $639,390): $<value> → <header wrong|tab wrong|both agree>
Flag 3 (rebate fabrication): <yes|no>
Flag 4 (rebateValue raw range): [<min>, <max>]
Flag 5 (server-side determinism): <stable|flickers>

Recommended Phase 2 decomposition: <list of sub-specs to write next>.
```

Phase 2 sub-spec writing is triggered by Vick reading this summary and
choosing which sub-specs to write. **Stop here.**

---

## Self-Review

**Spec coverage:** Phase 1 spec called for 8 sections in the diagnostic;
tasks 2–8 produce sections 1–8 (task 2 bundles sections 1+2 because
contract-row and tiers share one `findUniqueOrThrow(include: { tiers })`
— efficient and correct). Gate at task 10 matches the spec's "Plan
execution halts here" stop-condition. Phase 2 is explicitly deferred to
a later plan per spec. No Phase 2 sub-spec content appears in this plan.

**Placeholder scan:** "field name is TBD" is replaced with "grep and
confirm" instructions and fallback casts (`as { engineVersion?: ... }`)
so the script never silently prints `undefined` — a cast surfaces as
`"—"` in the table. "File TBD" in the spec's section 7 is addressed by
Task 7 Step 1's explicit grep workflow that records the four paths
before the import. No "TODO" or "implement later" strings remain.

**Type consistency:** `sumEarnedRebatesYTD`, `sumEarnedRebatesLifetime`,
`sumCollectedRebates` are used consistently across tasks 7 and 8 with
identical argument shape (`rebates` — a `Rebate[]`). Variable names
(`contract`, `rebates`, `periods`, `cogWhere`, `scopeOR`, `earnedYTD`,
`earnedLifetime`, `collectedLifetime`) are introduced once and reused.
The `contract.tiers` shape used in Task 2 is consistent with the
`include: { tiers: true }` from the same task.

**Testing discipline note:** Phase 1 is diagnostic-only — pure reads,
no production code touched. TDD doesn't apply here because there's
nothing to assert behaviour against yet. Phase 2 sub-plans (written
after this runs) WILL follow TDD: failing test first, canonical helper,
full verify checklist green. The diagnostic's own "run twice, diff"
step in Task 8 is itself a mini-test against the script.
