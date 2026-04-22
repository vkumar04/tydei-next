# Charles W2.B — Terms & Conditions non-determinism on contract detail

**Date:** 2026-04-22
**Author:** Vick (via superpowers brainstorming)
**Reporter:** Charles (iMessage, 2026-04-22 12:42 PM)

## Problem

Charles (iMessage): *"Also every time I enter a contract I am getting a
different result on terms and conditions."*

Something on the contract-detail page renders differently on each page load,
regardless of which contract is viewed. This is a user-trust issue: Charles
can't tell which rendering is correct, so he can't trust any of them.

## Working hypothesis

One of the following is true:

1. **AI-generated field regenerates per request.** A server action calling
   Anthropic (e.g., `renewal-brief.ts`, `rebate-optimizer-insights.ts`,
   or a terms-summariser) runs on every visit with no caching, producing a
   different completion each time.
2. **Non-deterministic date/time.** A `new Date()` inside a terms rendering
   path shifts the displayed value.
3. **Random ordering.** A list of terms is rendered from a `Set`, a Prisma
   query without `orderBy`, or `Math.random()` sort.

I'd guess (1) — "different result" sounds like prose-level variation, not
date drift.

## Approach

### Step 1 — Locate the "terms and conditions" surface

Grep the contract-detail page tree for the literal string
`"terms and conditions"`, `"Terms"`, `"T&C"`, or related section headers.
Identify:

- Which component renders the section
- Which server action feeds it
- Whether the action uses `generateText` / `generateObject` / an LLM call
- Whether the action is wrapped in `unstable_cache` or `cache()` or has any
  deterministic fallback

### Step 2 — Diagnostic run

Load the same contract twice in a browser (or twice via server-action unit
call in a vitest) and capture both renderings. Diff them. Confirm the
hypothesis class before writing a fix.

### Step 3 — Fix based on class

- **If LLM-generated:** either (a) persist the result to a
  `ContractAiSummary` row keyed by `(contractId, inputsHash)` and return
  cached on hit, or (b) wrap in `unstable_cache` with a tag that invalidates
  only when the underlying contract fields change. Must follow the
  CLAUDE.md AI-action error path: `console.error` before re-throw, surface
  a user-facing message that names the action.
- **If date-based:** source the date from the contract row, not `new Date()`.
- **If unordered:** add `orderBy` to the Prisma query or stabilise sort key
  upstream.

### Step 4 — Regression test

A vitest that calls the server action twice against the same contract in the
same test and asserts `deepEqual` on the output. Place under
`lib/actions/__tests__/` or the action's own `__tests__` folder.

## Non-goals

- Changing the substance of the terms text.
- Re-designing the Terms section UI.
- Any other bug in the W2.A Arthrex cluster.

## Success criteria

1. Regression test exists and would have caught the drift.
2. Loading the same contract detail page five times in a row shows
   identical terms-and-conditions content every time.
3. If the fix uses a cache, cache invalidation is tied to contract edits
   (not a TTL that hides future drift).
