# 2026-04-26 — Oracle promotion + coverage extension (design)

**Status:** draft / pre-brainstorm
**Author:** session w/ Vick on 2026-04-26
**Trigger:** Vick asked "what are your thoughts on oracle?" while reviewing the
v0-parity engine work. The oracle pattern (`scripts/oracle-full-sweep.ts`,
`scripts/oracle_*.py`, `docs/superpowers/diagnostics/`) is one of the strongest
correctness mechanisms in the codebase but is under-used: narrow coverage, not
in CI, one-off scripts with hardcoded paths, not wired to the canonical
reducers invariants table.

This is a peer to `2026-04-26-v0-parity-engines-design.md`. That spec prevents
drift *across surfaces* (list vs. detail) via canonical helpers + parity tests.
This spec prevents drift *between app and reality* via independent oracles. The
two are complementary; both are needed.

## 1. What exists today

### 1.1 Oracle scripts

| File | Language | Purpose |
|---|---|---|
| `scripts/oracle-full-sweep.ts` | TS | Read-only sweep against live DATABASE_URL — recomputes evergreen, term-years, cumulative/marginal rebate from `lib/rebates/calculate.ts` against current contracts and pass/fails each |
| `scripts/oracle_charles_arthrex.py` | Python | Computes Arthrex customer-facing numbers (lifetime/YTD/collected/on-contract spend) from Charles's exact COG CSV + pricing XLSX |
| `scripts/oracle_vendor_arthrex.py` | Python | Vendor-portal-side equivalent |
| `scripts/oracle_all_desktop.py` | Python | Multi-input sweep |
| `scripts/oracle_triangulate.py` | Python | Cross-checks two oracles against each other |
| `scripts/verify-app-against-oracle.ts` | TS | Drives Charles's files through the real importer + recompute pipeline, then compares the app's output to the Python oracle's ground truth |
| `scripts/verify-vendor-app-against-oracle.ts` | TS | Vendor-side equivalent |
| `scripts/diagnose-matcher-against-oracle.ts` | TS | Per-row diff for matcher disagreements |

### 1.2 Diagnostics archive

`docs/superpowers/diagnostics/2026-04-2*-oracle-*.md` snapshots every run as a
markdown report. Useful as paper trail when "this number changed."

### 1.3 Strengths to preserve

- **Second-channel evidence.** No shared code with the app pipeline. Different
  language for half the oracles. A simultaneous bug in both is implausible.
- **Read-only against prod.** Sweep is annotated "Safe for prod." High leverage:
  spot-check production whenever a number looks weird.
- **Cross-validation across oracles.** `oracle_triangulate.py` exists — oracles
  check each other, not just the app.

## 2. Gaps

### 2.1 Coverage gaps (highest priority)

The oracles cover lifetime/YTD/collected on Arthrex, COG matching, evergreen,
term-years, cumulative/marginal rebate. They do **not** cover:

- **Per-category market share** — exactly what `2026-04-26-v0-parity-engines-design.md`
  Bucket A1 is canonicalizing right now. Once `computeCategoryMarketShare` lands,
  there's no independent oracle to confirm the helper agrees with reality.
- **Tier projections** — the rebate forecast curve. Recently broken (`93d4dd0`
  fixed term-type selection). No oracle would have caught it.
- **Capital amortization** — `getContractCapitalSchedule`. PO complained
  about regressions here twice in the last month.
- **Accrual ledger per-period tier label** — `93d4dd0` fixed N/A → T1. No
  oracle.
- **Carve-out write-path dispatcher** — landed in `acd65cf`, no oracle.
- **Volume-rebate / CPT-counted earnings** — `b5d936b` added missing-CPT banner;
  no oracle for the underlying counts.
- **Vendor market-share by category** — duplicate logic from facility side
  (Bucket A4). Both should be oracled the same way.

### 2.2 Operational gaps

- **Not in CI.** All scripts are manual `bun scripts/...`. Regressions can sit
  for days before someone runs the sweep.
- **No baseline diff.** Each run prints pass/fail. There's no comparison to the
  prior run, so a number that drifted slowly (say, 2% per week) wouldn't trip
  the binary check.
- **Hardcoded inputs.** Every script bakes in `/Users/vickkumar/Desktop/...`
  paths and demo facility IDs. Can't run on another machine without edits.
- **No shared runner.** Adding a new oracle = forking an existing script. The
  setup boilerplate (Prisma client, formatting helpers, `CHECKS` array) is
  duplicated 5+ times.
- **Not wired to the invariants table.** CLAUDE.md "Canonical reducers" lists
  the helpers and their consumers but says nothing about which have an oracle.
  Future work has no signal that an oracle is missing.

## 3. Proposed shape

### 3.1 Directory + runner

```
scripts/oracles/
  index.ts                    # Single entry: `bun run oracles [--filter <name>]`
  README.md                   # How to add a new oracle
  _shared/
    fixtures.ts               # Path resolution: env var > sentinel default
    runner.ts                 # CHECKS framework (pass/fail collector, fmt, exit code)
    baseline.ts               # Read prior run from diagnostics/, diff numerically
  market-share.ts             # NEW — covers `computeCategoryMarketShare`
  capital-amortization.ts     # NEW
  accrual-ledger.ts           # NEW
  rebate-forecast.ts          # NEW
  carve-out.ts                # NEW
  volume-cpt.ts               # NEW
  arthrex-customer-numbers.ts # MIGRATE from oracle_charles_arthrex.py
  full-sweep.ts               # MIGRATE from scripts/oracle-full-sweep.ts
```

Each oracle file exports `{ name, run(): Promise<CheckResult[]> }`. The runner
discovers them, runs them, prints a unified report, and writes a markdown
snapshot to `docs/superpowers/diagnostics/<date>-oracle-<name>.md`.

Keep the Python oracles as-is — they're load-bearing for cross-language
independence. The TS runner orchestrates Python via `bun spawn` and consumes
their JSON output.

### 3.2 Inputs without hardcoding

```ts
// scripts/oracles/_shared/fixtures.ts
export const FIXTURES = {
  arthrexCogCsv: process.env.ORACLE_ARTHREX_COG ?? "fixtures/oracle/arthrex-cog.csv",
  arthrexPricingXlsx: process.env.ORACLE_ARTHREX_PRICING ?? "fixtures/oracle/arthrex-pricing.xlsx",
  demoFacilityName: process.env.ORACLE_DEMO_FACILITY ?? "Lighthouse Surgical Center",
}
```

Move desktop files into `fixtures/oracle/` (gitignored if large; checked-in if
small). Look up demo facility by `name`, not by cuid (CLAUDE.md primer
explicitly warns about this).

### 3.3 CI integration

Two cadences:

1. **Per-PR (cheap):** `bun run oracles --filter '!*full-sweep*'` runs everything
   that uses fixtures, not the live-DB sweep. Should complete in <60s. Required
   to merge.
2. **Nightly cron (full):** `bun run oracles` against staging or prod-replica.
   On disagreement, post a Slack message with the diff and link to the
   diagnostics markdown.

Vercel's cron-jobs / Routing Middleware aren't the right tool here — these are
build-time / scheduled-job concerns. Use a GitHub Actions workflow.

### 3.4 Baseline diffing

Each oracle run reads the prior diagnostics markdown for the same name, parses
the table, and reports both **absolute pass/fail** AND **relative drift**
("`vendorSpend` for Ortho-Extremity moved from $415,645 to $432,108 — +4.0%
since 2026-04-22"). Drift over a configurable threshold without a corresponding
commit explaining it is a soft fail (warning, not blocking).

### 3.5 Wire to invariants table

Add a new column to CLAUDE.md "Canonical reducers — invariants table":

| Invariant | Helper | File | Used by | **Oracle** |

Every row should eventually fill the Oracle column. Empty cells are tracked
gaps; new helpers must add an oracle in the same PR or document why they can't.

## 4. Proposed sequencing

Don't try to do all of this at once. Three plans:

1. ~~**`oracle-runner-skeleton.md`**~~ — DONE 2026-04-26. Runner + fixtures +
   report + baseline diff + entry point + full-sweep migration. The Python
   oracle migration was deferred to a follow-up (separate plan for the JSON
   contract between TS runner and Python oracles).
2. **`oracle-market-share.md`** — First new oracle on top of the new runner.
   Mirrors the canonical helper from `2026-04-26-v0-parity-engines-design.md`.
   Add the Oracle column to CLAUDE.md. ~half day.
3. **`oracle-coverage-fill.md`** — One oracle per gap from §2.1
   (capital-amortization, accrual-ledger, rebate-forecast, carve-out,
   volume-cpt, vendor-market-share). Can be parallelized across subagents.
   ~2-3 days.

Plan #1 is prerequisite. #2 and #3 unblock once #1 lands.

## 5. Out of scope for this spec

- **Property-based testing.** Oracles are example-based against real data.
  Property tests (fast-check, hypothesis) are a separate axis and a separate
  spec if we want them.
- **Replacing Vitest tests.** Unit tests on canonical helpers (e.g.,
  `lib/contracts/__tests__/market-share-filter.test.ts`) stay as the inner
  ring. Oracles are the outer ring (against real data, real DB writes).
- **Live-prod cron.** First version targets staging or a replica. Read-only
  against prod is fine for ad-hoc spot-checks but not as scheduled load.

## 6. Connections to other specs

- **`2026-04-26-v0-parity-engines-design.md`** — every canonical helper added
  there should get an oracle here. Explicitly: market-share (Bucket A1) needs
  the §3 oracle once Tasks 1–7 of the parity plan land.
- **`2026-04-20-engine-improvement-roadmap.md`** — engine improvements are
  the inner consistency layer; oracles are the outer truth layer. Both feed
  the same drift-prevention goal.
