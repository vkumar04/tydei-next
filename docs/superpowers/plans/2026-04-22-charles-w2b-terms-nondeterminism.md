# W2.B — Terms & Conditions Non-Determinism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bug where "every time I enter a contract I am getting a
different result on terms and conditions" — contract-detail terms content
must be identical across reloads, with a regression test guaranteeing it.

**Architecture:** Locate-and-classify first: diagnose whether the drift is
(a) AI-regeneration without caching, (b) non-deterministic date/time, or
(c) Prisma queries without `orderBy`. Then apply the class-appropriate fix
and land a regression test that loads the same contract twice and asserts
equality.

**Tech Stack:** Next.js 16 server actions, Prisma 7, Vercel AI SDK (`ai`)
if AI-class, Vitest for regression tests. Existing cache infrastructure
from `renewal-brief.ts` if we need a persistent AI cache.

**Spec:** `docs/superpowers/specs/2026-04-22-charles-w2b-terms-nondeterminism-design.md`

---

## File Structure

Files potentially created/modified (exact set depends on Task 1's locate
result; the plan explicitly re-scopes after Task 1):

- Expected read: `components/facility/contracts/contract-terms-page-client.tsx`
  and/or `components/contracts/contract-detail-client.tsx`
- Expected read: `lib/actions/contract-terms.ts`,
  `lib/actions/contracts/renewal-brief.ts`, any terms-summariser action
- Created: a regression test file under `lib/actions/__tests__/` or
  `lib/actions/contracts/__tests__/` depending on where the action lives

---

## Task 1: Locate the "terms and conditions" surface

**Files:** none modified.

- [ ] **Step 1: Grep the UI for section headers**

Run and record every hit:

```bash
grep -rn -i "terms and conditions\|terms & conditions\|^Terms$\|\"Terms\"" \
  components/ app/ --include="*.tsx" --include="*.ts" | grep -v node_modules | grep -v ".worktrees\|.claude/worktrees"
```

Also:

```bash
grep -rn "Tabs.*[Tt]erms\|TabsTrigger.*[Tt]erms" components/ --include="*.tsx"
```

Record the exact file(s) and line(s) where "Terms" is rendered on a
contract detail page. Expected primaries:

- `components/facility/contracts/contract-terms-page-client.tsx`
  (linked from `app/dashboard/contracts/[id]/terms/page.tsx`)
- possibly a "Terms" tab inside `components/contracts/contract-detail-client.tsx`

- [ ] **Step 2: Identify the feeding server actions**

For each component found in Step 1, grep the imports block for anything
in `lib/actions/`:

```bash
grep -n "from \"@/lib/actions" \
  components/facility/contracts/contract-terms-page-client.tsx \
  components/contracts/contract-detail-client.tsx 2>/dev/null
```

Record the action import paths.

- [ ] **Step 3: Classify the drift cause**

For each feeding action, check three things:

```bash
# Is there an AI call?
grep -n "generateText\|generateObject\|anthropic" <action-file>
# Is there a non-deterministic time source?
grep -n "new Date()\|Date.now()" <action-file>
# Does every Prisma findMany have an orderBy?
grep -nB2 "findMany" <action-file> | grep -A2 "findMany"
```

Write a short `docs/superpowers/diagnostics/2026-04-22-w2b-terms-locate.md`
recording:

1. The surface file(s) rendering "Terms"
2. The action(s) feeding them
3. Which drift class applies (A = AI, B = time, C = ordering, D = other)

If you find **no AI call, no `new Date()`, and all findManys have
`orderBy`**, open a question-mark note instead of a class — there may be
an upstream non-determinism (React Query fetch order, Suspense race)
that needs a second look. **Do not proceed past this task** until a
class is decided.

- [ ] **Step 4: Commit diagnostic**

```bash
git add docs/superpowers/diagnostics/2026-04-22-w2b-terms-locate.md
git commit -m "docs(diagnostics): W2.B locate terms-nondeterminism surface"
```

---

## Task 2: Write the failing regression test

**Files:**
- Create: `lib/actions/__tests__/terms-determinism.test.ts` (or, if the
  action lives in `lib/actions/contracts/`, place under
  `lib/actions/contracts/__tests__/terms-determinism.test.ts`)

- [ ] **Step 1: Write the test**

Replace `<TERMS_ACTION>` with the action name resolved in Task 1 Step 2
and `<action-module>` with its import path. Replace the `prepare` block
with whatever auth/seed the action needs — look at an existing test in
the same directory (e.g. `renewal-brief.test.ts`) for the pattern.

```ts
import { describe, it, expect, beforeAll } from "vitest"
import { prisma } from "@/lib/db"
import { <TERMS_ACTION> } from "<action-module>"

describe("terms content determinism (W2.B)", () => {
  let contractId: string

  beforeAll(async () => {
    // Seed or locate a contract. If the test mirrors renewal-brief.test.ts,
    // copy its `beforeAll` block which seeds a facility + contract.
    const c = await prisma.contract.findFirst({
      where: { facilityId: "cmo4sbr8p0004wthl91ubwfwb" },
      select: { id: true },
    })
    if (!c) throw new Error("No demo contract found for determinism test")
    contractId = c.id
  })

  it("returns byte-identical content across two sequential calls", async () => {
    const first = await <TERMS_ACTION>(contractId)
    const second = await <TERMS_ACTION>(contractId)
    expect(second).toStrictEqual(first)
  })
})
```

If the action requires a `requireFacility()` session, stub the session
the same way an existing test in the directory does (grep for
`vi.mock.*auth`).

- [ ] **Step 2: Run to confirm it FAILS**

```bash
bunx vitest run lib/actions/__tests__/terms-determinism.test.ts --reporter=verbose
```

Expected: test fails with a deep-equal diff, OR fails on first call
(e.g., seeding issue). If it fails on seeding, fix the seed — do NOT
proceed past a "passing" test at this stage. We need a test that fails
for the *right* reason.

If the test unexpectedly PASSES on the first try, one of two things is
true: (a) the drift doesn't reproduce in a vitest runner (likely a
client-side/React-only issue), or (b) the bug is already gone. In case
(a), pivot: reproduce in a Playwright test under `tests/workflows/` that
loads the page twice in a real browser. In case (b), document it as
"could not reproduce" and stop.

- [ ] **Step 3: Commit failing test**

```bash
git add lib/actions/__tests__/terms-determinism.test.ts
git commit -m "test(contracts): W2.B failing determinism test for terms content"
```

---

## Task 3: Apply the class-appropriate fix

**Files:** depends on Task 1 Step 3 class.

Pick **one** sub-step below based on the class. Do not apply multiple
classes' fixes; if the diagnostic listed multiple causes, file follow-up
work rather than bundling.

### Class A — AI regeneration without cache

- [ ] **Step 1: Mirror the `renewal-brief.ts` caching pattern**

Read `lib/actions/contracts/renewal-brief.ts` fully. It already has the
blueprint: `ContractAiSummary` (or similar) persisted row keyed by
`(contractId, inputsHash)`, cache-hit returns the stored row, cache-miss
calls `generateText` and persists.

In the terms action, adopt the same structure. Key fields to copy:

- `inputsHash` derivation (hash of relevant contract fields — see
  `renewal-brief.ts` for the exact `crypto.createHash('sha256')` call)
- Persistence model (reuse `ContractAiSummary` with a new `kind:
  "terms_summary"` discriminator, OR add a new model —
  discuss with Vick before adding a migration)
- CLAUDE.md AI-action error path: `console.error('[<action>]', err,
  { facilityId, contractId })` before rethrow; user-facing message names
  the action.

If a new Prisma model is needed, **pause and ask Vick** before writing
the migration — this plan doesn't pre-approve schema changes.

### Class B — `new Date()` / `Date.now()` in the action

- [ ] **Step 1: Replace with contract field**

Change the offending `new Date()` to the appropriate contract date
(e.g. `contract.effectiveDate`, `contract.expirationDate`,
`contract.createdAt`). Reference the actual Prisma field — `grep "model
Contract " -A 60 prisma/schema.prisma` to confirm names.

### Class C — missing `orderBy`

- [ ] **Step 1: Add stable `orderBy` to each offending findMany**

For each `prisma.X.findMany({ where: ... })` that produces part of the
terms payload, append an explicit `orderBy`. Prefer a natural sort key
(`{ tierIndex: "asc" }`, `{ sequence: "asc" }`); fall back to
`{ id: "asc" }` if no business-meaningful key exists.

### Class D — something else

- [ ] **Step 1: Stop and document**

Write a note in `docs/superpowers/diagnostics/2026-04-22-w2b-terms-locate.md`
describing what the actual cause is, and ask Vick for direction. Do not
try to fix an unknown cause.

---

## Task 4: Verify the regression test now PASSES

**Files:** none.

- [ ] **Step 1: Re-run the test**

```bash
bunx vitest run lib/actions/__tests__/terms-determinism.test.ts --reporter=verbose
```

Expected: PASS.

If still failing, the fix didn't address the actual cause — go back to
Task 1 Step 3 and reclassify. Don't weaken the test to make it pass.

- [ ] **Step 2: Commit the fix**

```bash
git add <files-changed-in-task-3>
git commit -m "fix(contracts): W2.B pin terms content to deterministic source"
```

(Adjust commit wording to match the actual class — e.g., "cache AI-
generated terms", "stable orderBy on tier list", "source date from
contract row not now()".)

---

## Task 5: Full verify

**Files:** none.

- [ ] **Step 1: Typecheck**

```bash
bunx tsc --noEmit 2>&1 | tail -20
```

Expected: 0 errors.

- [ ] **Step 2: Full test run**

```bash
bunx vitest run --exclude '**/.claude/**' --exclude '**/.worktrees/**' 2>&1 | tail -30
```

Expected: all green. Any unrelated failure: investigate; do not suppress.

- [ ] **Step 3: Dev-server smoke**

```bash
rm -rf .next
bun run dev
```

In a browser, open the contract detail Terms tab (or `/contracts/[id]/terms`)
for the demo Arthrex contract. **Reload the page five times** and
confirm the terms content is identical every time (you can use the
browser DevTools "Preserve log" + a screenshot diff, or just eyeball it
against Task 1's classification).

If the smoke surfaces any regression on other tabs of the contract
detail page (the terms action might share code with other surfaces),
stop and investigate.

- [ ] **Step 4: Post summary**

Report to Vick:

```
W2.B shipped. Class: <A|B|C|D>.
Regression test: lib/actions/__tests__/terms-determinism.test.ts (passes).
Smoke: 5x reload → identical output.
```

---

## Self-Review

**Spec coverage:**

- Spec Step 1 ("Locate the surface") → Task 1.
- Spec Step 2 ("Diagnostic run") → subsumed into Task 1 Step 3 +
  Task 2's failing test (the test *is* the diagnostic run for
  server-side drift).
- Spec Step 3 ("Fix based on class") → Task 3 with explicit A/B/C/D
  branches.
- Spec Step 4 ("Regression test") → Tasks 2 and 4.
- Spec success criteria (1) regression test exists and would have
  caught → Task 2 lands the failing test before the fix. (2) five
  reloads identical → Task 5 Step 3. (3) cache invalidation tied to
  contract edits → covered by class-A fix reusing `renewal-brief.ts`'s
  inputsHash pattern, which invalidates on field change.

**Placeholder scan:** `<TERMS_ACTION>` and `<action-module>` in Task 2
are template placeholders the subagent fills in from Task 1's output —
these are intentional hand-offs, not deferred work. Task 1 explicitly
records the values needed. The class-dependent "pick one" in Task 3 is
not a placeholder — each class has its own concrete steps. "Ask Vick
before adding a migration" in Class A is a real escalation, not a TODO.

**Type consistency:** The regression test imports by name from the
path Task 1 records; no symbols are referenced that aren't resolved by
Task 1. `strictEqual` on the action's return shape implicitly types the
test against the action itself — no ad-hoc type declarations.

**TDD discipline:** Task 2 (failing test) strictly precedes Task 3
(fix) strictly precedes Task 4 (test passes). Task 5 enforces the full
verify checklist from CLAUDE.md before anything is declared shipped.
