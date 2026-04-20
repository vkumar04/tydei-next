# Deep-Test Subagent Prompt — Canonical Template

**Purpose.** This is the prompt template the orchestrator hands to a
deep-test subagent after a day of commits, immediately before a human
code review. The deep-test's job is to **find the Charles bugs
*before* Charles does** — i.e. bugs that a freshly-stood-up, real
browser session against the real dev server would surface, but that
the unit-test suite cannot express.

**Why this template exists.** On 2026-04-19 the deep-test subagent
reported green minutes before Charles hit 8 bugs (retro:
`docs/superpowers/retros/2026-04-19-w1u-retrospective.md`). Root cause:
the 14 curl smokes it ran verified endpoint-shape but never (a) ran a
fresh build, (b) asserted numeric parity across related surfaces, or
(c) exercised schema enum variations not in seed data. This template
encodes the missing steps. **It is not optional.**

---

## Required checks (in order, halt on first fail)

A deep-test run that skips any of these MUST report SKIPPED, not
PASSED. "14 items ✅" with no evidence per item is the pattern the
retro indicted.

### 1. `bun run smoke` — non-negotiable

Run `bun run smoke --since-ref=<commit-range-under-test>` FIRST,
before any other verification. The script's exit code is the first
input to your pass/fail decision. Do not attempt to reproduce its
internal checks in an ad-hoc way — the script is the canonical
minimum and is maintained alongside the retrospective.

If the script fails, record the failing step(s) verbatim in your
report and STOP. Do not proceed to subsequent checks. A failing smoke
invalidates downstream reasoning.

If the script WARNS (e.g. enum-coverage gap, no touched actions), the
deep-test still continues but MUST note the warning text in the
report summary, not bury it.

### 2. Unit / type / lint passes

Run in parallel, record each result:

- `bunx tsc --noEmit` — expect exit 0.
- `bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**'` —
  expect 0 fails. Pre-existing skips/parse-fails must be called out by
  count, not glossed over.
- `bun run lint` — expect 0 errors.

### 3. Numeric cross-surface assertions

For EVERY contract-level rebate, spend, or margin figure the day's
commits touched, verify the number reads identically on every surface
that displays it. Minimum bar:

- **Earned (YTD):** contracts-list earned column == contract-detail
  header card == Transactions ledger sum (all through
  `sumEarnedRebatesYTD` — CLAUDE.md canonical reducer registry).
- **Collected:** same three surfaces via `sumCollectedRebatesFromRows`.
- **Spend (trailing 12 months):** contracts-list SPEND column ==
  contract-detail "Current Spend" card. Precedence must match
  (periods → COG-by-contract → COG-by-vendor).

`bun run smoke` step 4 performs this for 3 contracts automatically;
IF the day's work introduced a new surface not yet covered by the
script, add that surface to the script (same PR) AND cross-probe it
by hand in this deep-test run. Paste the probe command + output.

### 4. Enum variation coverage

Before declaring green, run `bun run qa:sanity`. Its output is the
authoritative record of seed coverage. Additionally, for any schema
enum or enum-like string field (e.g. `ContractTerm.appliesTo`,
`evaluationPeriod`, `paymentCadence`, `rebateMethod`,
`BaselineType`, `VolumeType`) that the day's commits changed a
caller of: confirm at least one seeded row exists per value. The
retro's Bucket A exists precisely because `appliesTo:
"specific_category"` was never seeded, and the non-default branch of
every caller was therefore unreachable from the running app.

If a gap is found, either (a) land a seed amendment in the same PR,
or (b) open a follow-up and explicitly note "untestable via seed" in
the report.

### 5. AI actions — every one, every time

Any AI server-action touched (grep `lib/actions/**/*.ts` for
`generateText`, `generateObject`, `claude`, `anthropic`, `openai`,
or the action names `getRebateOptimizerInsights`,
`generateRenewalBrief`, etc.) MUST be exercised:

- With a real API key if the budget allows (prefer — AI schema drift
  is only caught live).
- With a mocked client otherwise. NEVER skip with "exists / file
  present". The retro's bug #3 was a shipped AI action that only
  failed at runtime, with no unit coverage of the failure path.

For each AI action verified, confirm:

1. Happy path returns a value matching the expected shape (Zod
   parse-back if schemas are used).
2. A known-bad input (empty terms, malformed rebate history, etc.)
   surfaces a **useful error message** with the action name in it —
   NOT a Next.js prod-stripped digest.
3. A `ModelCache` / `RebateInsightCache` / analogous cache row was
   created on success.

### 6. Touched-page manual smoke

For every page that renders output from a touched action file: open
the dev server (the smoke script leaves it running; reuse it), curl
or browser the page with a `demo-facility@tydei.com` session, and
confirm no 500 or client-side error in the dev server log. If the
day's commits moved/renamed Server Actions, verify the action hash
in the HTML response is present in `.next/server/app/...` manifest
— the retro's bug #1 was exactly this stale-hash case.

---

## What "explicit cross-surface assertion" looks like

NOT good enough:

```
✅ getContract returns correct rebateEarnedYTD
```

(Measures: one surface, in isolation. Doesn't catch drift against
the list column or the ledger.)

Good:

```
EARNED (YTD) cross-surface parity — Arthrex Lighthouse (cmo4...wfwb):
  contracts-list column         = $4,218.00
  contract-detail header card   = $4,218.00
  Transactions ledger sum       = $4,218.00
  YTD <= lifetime invariant     = 4,218.00 <= 9,102.50 ✓
  all via sumEarnedRebatesYTD (lib/contracts/rebate-earned-filter.ts)
```

---

## Report format (required)

Save the report to
`docs/superpowers/qa/deep-test-<YYYY-MM-DD>-<short-sha>.md`. Paste
the same contents into the response you return to the orchestrator.

The report MUST include these sections, in order:

### 1. Header

```
# Deep-test report — <YYYY-MM-DD>
Subject SHA(s): <sha1>..<shaN>
Since ref:      <the --since-ref used>
Smoke output:   attached below (full)
Overall:        PASS | PASS-WITH-WARNINGS | FAIL
```

### 2. Checklist ledger

Each of the 6 required checks gets its own row with an explicit
status, duration, and one-line evidence. No "✅" without an
accompanying artifact (command output, file path, log line, DB
probe result).

```
| # | Check                                | Status | Evidence                                         |
|---|--------------------------------------|--------|--------------------------------------------------|
| 1 | bun run smoke                        | PASS   | (see attached smoke output, 0 failures)          |
| 2 | tsc + vitest + lint                  | PASS   | tsc 0 errors · vitest 1834/0/2 pass/fail/skip    |
| 3 | numeric cross-surface                | PASS   | 3 contracts × 2 metrics × 3 surfaces, see §4     |
| 4 | enum variation coverage              | WARN   | ContractTerm.appliesTo: specific_category=0 rows |
| 5 | AI actions exercised                 | PASS   | both real-API; see §6 & cache rows in §7         |
| 6 | touched-page manual smoke            | PASS   | 4 pages / 0 500s / 0 client errors               |
```

### 3. Touched-file inventory

Output of `git diff <since-ref>...HEAD --name-only`, grouped by
directory. Call out anything under `lib/actions/`, `lib/rebates/`,
`lib/contracts/`, `prisma/`, and `app/api/` specifically — those are
the highest-risk surfaces.

### 4. Golden-number table

The numbers from step 3. One row per (contract, metric) pair. All
columns come from the real DB, not from the test mocks.

### 5. Enum coverage probe

Output of `bun run qa:sanity` + any additional probes done in
step 4 of this checklist.

### 6. AI action transcripts

For each AI action exercised, include:
- The action name and input fixture used.
- The command that exercised it (real API vs mock).
- The raw output (first 40 lines is fine; truncate with `…` marker).
- The error path verification (malformed input → what error surfaced).

### 7. Smoke script attachment

Paste the full stdout of `bun run smoke --since-ref=<ref>` at the
bottom of the report, not just the final line. The per-check
detail lines are the fingerprint of what was actually verified.

### 8. "Known limitations of this run"

Any check that could not be exercised, with a reason. Examples:
"skipped enum coverage for `evaluationPeriod` because seed doesn't
include `monthly` (backlog B2)." Do not pretend to have checked
something you didn't.

---

## Anti-patterns to avoid

The retro calls these out as the exact failure modes of the
2026-04-19 run:

- **"Endpoint shape ✓" as the only evidence.** HTTP 200 with a
  stripped digest body is a silent failure. Parse the page, pick a
  number, cross-check it.
- **Reusing a stale dev server.** Always let the smoke script boot
  a fresh `next dev` on a known port — the retro's bug cluster was
  partially mediated by a stale `.next` cache.
- **Skipping AI actions because they cost money.** Mock them —
  don't pretend they were verified. Bug #3 was a shipped AI path
  with zero coverage.
- **"1831 tests passing" as an overall quality signal.** The retro's
  summary: *"Our unit tests verified that each box in the diagram
  works. The bugs lived on the arrows between boxes."* Cross-seam
  assertions are the arrows. Numbers per-box are not the same thing.

---

## Changelog

- 2026-04-19: initial template (W1.U retro Fix 5 / Backlog B7).
