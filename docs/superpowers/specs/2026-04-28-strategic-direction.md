# 2026-04-28 — Strategic direction (spec)

**Status:** brainstorm / direction-setting
**Author:** session w/ Vick on 2026-04-28
**Trigger:** Vick's frustration at the back-and-forth pattern. Quote:
> "do research on how you can make this app better… idk why we keep going back and forth"

We've been firefighting individual PO bug reports for two weeks. New bugs keep landing because the *shape* of the codebase generates them. This doc steps back, identifies the architectural patterns producing the recurring bug classes, and proposes a direction that stops the back-and-forth.

The PO is fundamentally right that "this app is just a fancy calculator" — the recommendations below all flow from that framing. A calculator's job is to compute the right number from inputs and display it consistently. Most current bug volume comes from manual-entry overrides, side-effects-as-recomputes, and cached values that never invalidate.

## 1. The three shapes generating most current bugs

Cluster of last 30+ PO-reported bugs (analyzed across `6e37040`, `bec3297`, `c834006`):

### 1.1 Cached values that never invalidate (~40% of recent bug volume)

Every bug of the form "the number didn't update after I…" is a cache-invalidation gap. Examples:

- **`Contract.currentMarketShare`** — manual entry that doesn't recompute when COG shifts. Wrote silent $0 rebate rows for the entire `market_share` term type until last week.
- **`Contract.complianceRate`** — same shape; never re-syncs. Quietly drives compliance term drift.
- **`Contract.annualValue`** — written once from `totalValue / years`; if dates change, the field is stale. Surfaced today as 16 of 21 demo contracts having `annualValue` ±25% off the calendar math.
- **Market-share card** — TanStack Query without invalidation tags; we shipped `staleTime: 0` as a band-aid yesterday and proper invalidation today.

**Why it keeps happening:** the codebase mixes "fields that the user manually edits" with "fields that the system should compute" without distinguishing them at the type level. Both look identical in the schema. There's no contract that says "this field is canonically derived; never write to it manually."

### 1.2 Fields not flowing form → action (~25% of recent bug volume)

Form has the value, action receives a different shape, write loses it. Examples:

- **AI tier `spendMax`** — extracted by AI, derived by mapper, then `new-contract-client.tsx:511` hard-coded `spendMax: undefined`, throwing the value away. Took two commits because the logic lived in two places.
- **`amortizationShape: "variable"`** — picker captured the value, preview hard-coded `"symmetrical"` regardless. User selected variable, contract was created mismatched.
- **W1.Y-A "edit-save" regression** — `updateContract` schema didn't recognize tie-in fields added later; edit silently dropped them.

**Why it keeps happening:** form state, validator schema, and action `data: { ... }` shape are three independent typings of the same record. Drift between them is invisible to TypeScript. Every new field is a new opportunity for one of the three to forget about it.

### 1.3 Side-effect recomputes that fail silently (~20% of recent bug volume)

`bulkImportCOGRecords` uses dynamic imports to call `recomputeMatchStatusesForVendor` + `recomputeCaseSupplyContractStatus` AFTER its writes commit. Errors are caught with `console.warn`. If recompute fails, the import reports success but downstream cards are stale. No transaction boundary, no retry queue.

Same pattern in `contract-terms.ts` (calls `recomputeAccrualForContract` inline on save), `contracts.ts` (1,451 lines, mixes update + recompute), and `case-costing` import.

**Why it keeps happening:** every action that writes also dispatches recomputes, and there's no orchestrator. The action's contract is "I wrote and best-effort triggered a recompute"; the user's contract is "this number reflects the new state." The two don't align under failure.

The remaining ~15% of bugs are honest one-off mistakes (typos, missing tooltips, unspecified-yet design decisions). Those don't matter for direction.

## 2. The four interventions that stop the back-and-forth

In priority order. Each addresses one or more of the three shapes above.

### 2.1 Mint computed-only fields (kills shape 1.1)

For `currentMarketShare`, `complianceRate`, `annualValue`:

- Remove the form input.
- Make the field read-only on the contract-detail page with a "last computed at" timestamp + "Refresh" button.
- Persist the field still — it's a cache for query speed — but only writers are the recompute path, never a user form.
- A nightly cron (or on-demand via the Refresh button) recomputes from the canonical source and updates `lastComputedAt`.
- Type-level signal: `Contract.currentMarketShare: ComputedField<number>` — a brand type that lints against direct write.

This kills the silent $0 rebate class entirely. Engine-input oracles already prove the math; this just plumbs it where the form used to live.

### 2.2 Form↔action↔schema unification (kills shape 1.2)

Each entity has ONE Zod schema that is the source of truth for create + update + form + action. Drift is impossible because there's only one shape.

- `lib/validators/contracts.ts` already has `createContractSchema` + `updateContractSchema`. Merge into a single `contractSchema` with `.partial()` for updates.
- The form uses `useForm<z.infer<typeof contractSchema>>`. The action signature is `(input: z.input<typeof contractSchema>)`. Adding a new field requires touching ONE place.
- Add a parity test: every key in the schema must have a matching form input AND must round-trip through the action. A missing form field for a schema field is a build-time error.

This kills the "field collected but lost" class. New fields can't slip past one of the three layers.

### 2.3 Recompute orchestrator (kills shape 1.3)

Replace dynamic-imported recompute calls with a single `lib/contracts/recompute-orchestrator.ts` that:

- Wraps the Prisma write AND its dependent recomputes in a single `prisma.$transaction`.
- If any recompute throws, the whole import rolls back (or in the durable-queue alternative below: enqueues with retries).
- Surfaces per-step success/failure to the action result so the UI can show "Imported 46k rows; 1 recompute step failed (retry pending)".

For long-running recomputes that exceed transaction time budgets, replace the dynamic-import pattern with a durable queue (BullMQ or Vercel Queues — already on the platform's roadmap). Each recompute is a job. Failures retry with exponential backoff. The UI shows a "recompute pending" badge until the job completes.

This kills the silent-stale class entirely. The user sees "still computing" instead of seeing wrong numbers and not knowing.

### 2.4 Targeted UX density wins from v0 (the "feels incomplete" complaint)

v0 doesn't have better data — it has better information density per pixel. Three small ports, ~4–6 hours total, that close the "this dashboard feels thin" gap:

1. **Secondary KPIs in hero metrics** (~20 LOC). v0's dashboard cards show primary + secondary value (e.g., "Active Contracts: 12 | $4.2M value"). Tydei's hero has the data but doesn't anchor secondary values to primary.
2. **Inline metadata on alert rows** (~40 LOC). v0 alerts show vendor + facility + dollar amount inline; tydei requires drill-down. Cuts decision time 3×.
3. **ROI-ranked recommendation hero on Rebate Optimizer** (~30 LOC). v0 surfaces "Smith & Nephew: $50K away from 6% tier = $9K upside" prominently. Tydei has the engine; the recommendation card is buried.

These don't fix bugs but they reduce the "the app feels incomplete" complaint that motivates many of the design questions arriving as bug reports.

## 3. What this changes about how we work

Today: PO files a bug. We fix it. PO files another bug from the same root cause. We fix it. Repeat.

After 2.1–2.3 land: most of those bug classes are architecturally impossible. The bugs that remain are real domain decisions ("should commitment apply per-category or rolled up?") that *should* be conversations, not whack-a-mole.

The engine + oracle pattern from the last week is the inner ring of this: it makes math drift impossible. Sections 2.1–2.3 are the next ring out: they make data-flow drift impossible. Once both rings are tight, "PO sends 4 screenshots a day" should drop to "PO sends 1 screenshot a week, and it's a real product question."

## 4. Sequencing recommendation

Three plans, executable independently:

1. **`computed-only-fields.md`** — Plan #1. Mint `Contract.currentMarketShare` + `complianceRate` + `annualValue` as read-only/computed. Add nightly recompute job + manual refresh. Remove form inputs. ~1.5 days.
2. **`schema-unification.md`** — Plan #2. Merge create+update schemas into one. Add form↔schema parity test. Audit for fields the action drops today (W1.Y-A class). ~1 day.
3. **`recompute-orchestrator.md`** — Plan #3. Extract recompute trigger out of `bulkImportCOGRecords`, `contracts.ts:updateContract`, `contract-terms.ts`. Wrap in transaction OR durable-queue. ~2 days for the transactional version, ~1 week for queues.

The three v0 UX ports (§2.4) can run in parallel as a single ~half-day batch — they don't depend on the architectural work and they'd visibly reduce the "feels incomplete" complaint while the architecture work is in flight.

## 5. What this spec is NOT

- Not a list of bugs to fix. Bug fixes for the existing 6 deferred items (D, J, L, N, O, #13) are still useful but they shouldn't drive direction.
- Not a rewrite. Each plan above is incremental — small surface area, ships independently, each one ships value the day it merges.
- Not a v0 port. v0 has a few patterns to absorb but its data layer (localStorage) is genuinely worse than tydei's; we're not trying to copy v0 wholesale.
- Not engine work. The engines are already in good shape — canonical reducers, oracles, parity tests. The remaining drift is in the *plumbing* around them.

## 6. Rough impact estimate

- **Plan #1 alone** kills probably 8–10 of the past month's PO bugs and prevents a similar volume going forward. Highest ROI of the three.
- **Plan #2** is mostly defensive — it doesn't fix anything user-visible immediately but it makes the next 6 months of feature additions ~2× faster because schema drift doesn't bite.
- **Plan #3** is the biggest investment but produces the clearest user-facing artifact ("recompute pending" instead of stale numbers).
- **§2.4 UX ports** produce immediate visible improvement at minimal risk.

If only one is shippable: Plan #1.
If two: Plan #1 + §2.4.
If three: Plan #1 + #2 + §2.4. Defer #3 until after Q1 because it interacts with platform-level decisions (Vercel Queues GA, durable-execution patterns).

## 7. References

- Pain pattern audit: ran 2026-04-28, summarized inline above.
- v0 port analysis: ran 2026-04-28, summarized inline above.
- Source-level oracle spec (`2026-04-26-source-level-oracle-design.md`) — the inner ring; this doc is the next ring out.
- v0 reference codebase: `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/`.
