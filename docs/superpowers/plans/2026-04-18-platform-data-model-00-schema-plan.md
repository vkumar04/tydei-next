# Platform Data-Model Reconciliation — Subsystem 0: Schema + Sign-Convention Audit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `COGMatchStatus` enum + `COGRecord.matchStatus` column (with indexes) to the Prisma schema, and surface a sign-convention audit report that catalogs every place in the codebase that computes savings/variance — before subsequent subsystems touch those files.

**Architecture:** Additive schema change — one new enum + one new column with a safe `pending` default + two indexes. No data migration needed (new rows get `pending`; existing seed rows also default to `pending` and get populated when subsystem 5's recompute runs later). The sign-convention audit produces a markdown report inside the plans folder; no code changes this subsystem beyond the schema itself.

**Tech Stack:** Prisma 7, PostgreSQL, `bun run db:push`, `bunx prisma generate`, `bunx tsc --noEmit`, Vitest.

**Parent spec:** `docs/superpowers/specs/2026-04-18-platform-data-model-reconciliation.md`

---

## File structure

**Files touched:**

- Modify: `prisma/schema.prisma` — add `COGMatchStatus` enum + `COGRecord.matchStatus` column + 2 indexes
- Create: `docs/superpowers/plans/2026-04-18-platform-data-model-00-sign-convention-audit.md` — audit report filed during Task 1
- Create: `tests/contracts/match-status-schema.test.ts` — sanity test that the new column is query-able and defaults correctly
- No other code changes. Zero files in `lib/` or `components/` touched.

**Files audited (read-only — no changes this subsystem):**

- `lib/actions/cog-records.ts` (643 lines) — search for `savings`, `variance`, `unitPrice - contractPrice`, `contractPrice - unitPrice` to catalog sign-convention usage
- `lib/actions/dashboard.ts` (475 lines) — same grep
- `lib/actions/contracts.ts` (878 lines) — same grep (but this file was heavily modified during contracts-rewrite; most recent writes should already match the canonical convention)
- `lib/rebates/calculate.ts` — same grep
- `lib/contracts/price-variance.ts` (from contracts-rewrite subsystem 5) — same grep

---

## Task 1: Sign-convention audit report

**Files:**
- Create: `docs/superpowers/plans/2026-04-18-platform-data-model-00-sign-convention-audit.md`

- [ ] **Step 1: Grep for savings-sign usages**

Run:
```bash
cd /Users/vickkumar/code/tydei-next/.worktrees/contracts-00-schema
grep -nE "savings|variance|unitPrice - contractPrice|contractPrice - unitPrice|actualPrice - contractPrice" \
  lib/actions/cog-records.ts \
  lib/actions/dashboard.ts \
  lib/actions/contracts.ts \
  lib/rebates/calculate.ts \
  lib/contracts/price-variance.ts 2>/dev/null
```

Capture every match with file path + line number. These are the sites that need to agree on the canonical sign convention (positive savings = facility paid less than list; positive variance = facility paid more than contract).

- [ ] **Step 2: Write the audit report**

Create `docs/superpowers/plans/2026-04-18-platform-data-model-00-sign-convention-audit.md` with this shape:

```markdown
# Sign Convention Audit — 2026-04-18

Canonical rule (from platform-data-model-reconciliation §4.11):
- `savings` positive = facility paid less than list (win)
- `variancePercent` positive = facility paid more than contract (alert)

## Audit findings

### Matches canonical
(list each correct site)

### Violations to fix (tracked separately — not this subsystem)
(list each violation + file:line + short description)

## Recommendation
If violations exist: file a follow-up ticket / subsystem to correct them.
If none: remove this report after the next platform-data-model subsystem merges.
```

Fill in both sections from the grep output. For each match, read ±5 lines of context and classify as "matches canonical" or "violation".

- [ ] **Step 3: Commit the audit report**

```bash
git add docs/superpowers/plans/2026-04-18-platform-data-model-00-sign-convention-audit.md
git commit -m "docs: sign convention audit — platform-data-model subsystem 0

Catalogs every site in the codebase that computes savings/variance
so subsequent subsystems can enforce the canonical sign convention
(savings positive = facility paid less than list; variance positive
= facility paid more than contract).

Findings inform platform-data-model subsystem 5 (match algorithm +
recompute) and the COG rewrite's subsystem 1 (enrichment engine).

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>"
```

Expected: audit report committed; no code changes yet.

---

## Task 2: Add `COGMatchStatus` enum to schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Locate the enum section of the schema**

Read the top of `prisma/schema.prisma` to confirm the enum section layout. Enums are near the top of the file, before the models.

- [ ] **Step 2: Append the `COGMatchStatus` enum**

Add this enum after the last existing enum in the schema (likely near `CreditTierId` or one of the rebate-related enums added in the contracts-rewrite subsystem 0):

```prisma
enum COGMatchStatus {
  pending                 // not yet enriched
  on_contract             // vendor + item + scope + date all match
  off_contract_item       // vendor matches, item not on any contract
  out_of_scope            // vendor + item match, wrong facility or date
  unknown_vendor          // no vendor match at all
  price_variance          // on contract, but actual price differs from contract price
}
```

- [ ] **Step 3: Validate schema**

Run:
```bash
bunx prisma validate --schema=prisma/schema.prisma
```

Expected: `The schema at prisma/schema.prisma is valid 🚀`

---

## Task 3: Add `matchStatus` column + indexes to `COGRecord`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Locate `model COGRecord` in the schema**

Grep:
```bash
grep -n "^model COGRecord" prisma/schema.prisma
```

Open the model block.

- [ ] **Step 2: Add `matchStatus` field and indexes**

Add the field after the last existing column (typically before the relations block) and add two new `@@index` lines:

```prisma
model COGRecord {
  // ... existing fields remain unchanged

  matchStatus COGMatchStatus @default(pending)

  // ... relations unchanged

  // Existing indexes preserved; add:
  @@index([matchStatus])
  @@index([facilityId, matchStatus])
}
```

Do **not** rearrange existing fields. Place `matchStatus` as the last scalar field before the relations.

- [ ] **Step 3: Validate schema**

Run:
```bash
bunx prisma validate --schema=prisma/schema.prisma
```

Expected: `The schema at prisma/schema.prisma is valid 🚀`

---

## Task 4: Apply schema + regenerate client

**Files:**
- No file edits; DB + generated client update.

- [ ] **Step 1: Confirm Postgres is running**

Run:
```bash
docker ps --format '{{.Names}}' | grep tydei-next-postgres
```

Expected: `tydei-next-postgres-1` in output. If missing, run `docker compose up -d` from `/Users/vickkumar/code/tydei-next/`.

- [ ] **Step 2: Push schema to DB**

Run:
```bash
bun run db:push
```

Expected: `Your database is now in sync with your Prisma schema.` with **zero data-loss warnings**. The change is purely additive, so this is safe on existing data.

- [ ] **Step 3: Regenerate Prisma client + Zod types**

Run:
```bash
bunx prisma generate --schema=prisma/schema.prisma
```

Expected: `✔ Generated Prisma Client` + `✔ Generated Zod Prisma Types`. `lib/generated/zod/index.ts` will grow by ~30-50 lines covering the new enum.

---

## Task 5: Verify existing rows defaulted to `pending`

**Files:**
- No file edits; DB verification.

- [ ] **Step 1: Count rows by match status**

Run:
```bash
bun -e '
import { prisma } from "./lib/db";
const total = await prisma.cOGRecord.count();
const pending = await prisma.cOGRecord.count({ where: { matchStatus: "pending" } });
console.log(`Total: ${total}, Pending: ${pending}`);
await prisma.$disconnect();
'
```

Expected: `Total: N, Pending: N` (all existing rows defaulted to `pending`). If any other value appears, investigate — migration should not have written anything else.

---

## Task 6: Write schema sanity test

**Files:**
- Create: `tests/contracts/match-status-schema.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest"
import { Prisma } from "@prisma/client"

describe("COGMatchStatus schema", () => {
  it("exposes the 6 canonical status values", () => {
    // This assertion leans on Prisma's generated types: if any value is
    // missing at compile time, the test will fail to compile.
    const values: Prisma.COGMatchStatus[] = [
      "pending",
      "on_contract",
      "off_contract_item",
      "out_of_scope",
      "unknown_vendor",
      "price_variance",
    ]
    expect(values).toHaveLength(6)
  })
})
```

- [ ] **Step 2: Run the test**

Run:
```bash
bunx vitest run tests/contracts/match-status-schema.test.ts
```

Expected: `Test Files  1 passed (1)` / `Tests  1 passed (1)`. If the test fails to compile or run, the generated Prisma types don't include the new enum — back up and re-run Task 4.

---

## Task 7: Full verification + baseline build

**Files:**
- No file edits; verification run.

- [ ] **Step 1: Typecheck**

Run:
```bash
bunx tsc --noEmit
```

Expected: exit 0, no errors. The new column is nullable-default-`pending`, so existing Prisma query call sites keep working without changes.

- [ ] **Step 2: Full test suite**

Run:
```bash
bunx vitest run --exclude tests/workflows --exclude tests/visual
```

Expected: all test files pass, including the new `match-status-schema.test.ts`.

- [ ] **Step 3: Reseed + QA sanity**

Run:
```bash
bun run db:seed
```

Expected: `qa-sanity OK` with all seeded QA checks green. The seed doesn't set `matchStatus`, so every seeded COG row still defaults to `pending` (subsystem 5 will later run the canonical matcher to populate real values).

- [ ] **Step 4: Production build**

Run:
```bash
bun run build
```

Expected: `✓ Compiled successfully`. No Zod or generated-type drift errors.

---

## Task 8: Commit the schema change

**Files:**
- Stage: `prisma/schema.prisma`, `lib/generated/zod/index.ts`, `tests/contracts/match-status-schema.test.ts`, `docs/superpowers/plans/2026-04-18-platform-data-model-00-schema-plan.md`

- [ ] **Step 1: Stage files + commit**

Run:
```bash
git add prisma/schema.prisma \
        lib/generated/zod/index.ts \
        tests/contracts/match-status-schema.test.ts \
        docs/superpowers/plans/2026-04-18-platform-data-model-00-schema-plan.md

git commit -m "$(cat <<'EOF'
feat(platform-data-model): subsystem 0 — COGMatchStatus schema

Adds the canonical 6-value match status enum + column + indexes
required by:
- subsequent platform-data-model subsystems (canonical matcher,
  recompute actions)
- COG data rewrite (enrichment engine writes matchStatus on import)
- data-pipeline rewrite (price-discrepancy report filters on status)

Schema additions (all additive, no data-loss warnings):
- enum COGMatchStatus { pending, on_contract, off_contract_item,
  out_of_scope, unknown_vendor, price_variance }
- COGRecord.matchStatus COGMatchStatus @default(pending)
- @@index([matchStatus])
- @@index([facilityId, matchStatus])

Existing seeded COG rows default to 'pending'. Subsystem 5 (match
algorithm + recompute) will populate real values once it lands.

Sign-convention audit committed separately as
docs/superpowers/plans/2026-04-18-platform-data-model-00-sign-convention-audit.md
— catalogs every site that computes savings/variance for cross-
subsystem alignment.

Acceptance:
- prisma validate: valid
- db:push: in sync, zero data-loss warnings
- prisma generate: Zod types regenerated (+~40 lines)
- tsc --noEmit: 0 errors
- vitest: passing (1 new test + 89 existing contracts-rewrite tests)
- db:seed + qa-sanity: 10/10 passing
- next build: compiled successfully

Part of: docs/superpowers/specs/2026-04-18-platform-data-model-reconciliation.md

Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds, pre-commit hooks pass.

- [ ] **Step 2: FF-merge to main**

Run from the main checkout:
```bash
cd /Users/vickkumar/code/tydei-next
git merge --ff-only contracts-rewrite-00-schema
```

Expected: fast-forward succeeds; main now contains the schema change.

---

## Acceptance (whole subsystem)

- `bunx prisma validate` → valid
- `bun run db:push` → in sync, zero data-loss warnings
- `bunx prisma generate` → Zod types regenerated
- `bunx tsc --noEmit` → 0 errors
- `bun run test` → all passing (new `match-status-schema.test.ts` + existing suites)
- `bun run db:seed` → 10/10 QA sanity passing
- `bun run build` → compiled successfully
- Every existing `COGRecord` row reports `matchStatus = "pending"`
- Sign-convention audit report committed

---

## Self-review checklist

- [x] Every task has concrete code/commands, no placeholders
- [x] Sign-convention audit is Task 1 (before schema changes); produces a report that's useful to subsequent subsystems even if this one merges alone
- [x] Schema changes are additive + backward-compatible
- [x] No file path typos (verified against platform-data-model-reconciliation.md §3.1)
- [x] Commit message cross-references parent spec
- [x] Acceptance criteria match the parent spec's subsystem 0 acceptance
