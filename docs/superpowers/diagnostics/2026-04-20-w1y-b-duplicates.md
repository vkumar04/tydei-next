# Duplicate contracts — W1.Y-B diagnostic (theoretical)

_Script:_ `scripts/diagnose-duplicate-contracts.ts`
_facilityId:_ `cmo4sbr8p0004wthl91ubwfwb` (Lighthouse Community Hospital)
_window:_ last 24h

## Environment note

The diagnostic script was authored and reviewed, but the local Prisma client
could not connect to the dev DB from this worktree (error captured below:
`SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` —
`DATABASE_URL` not populated in the worktree shell). The script is committed
so Charles can re-run it with a proper env. Below is the theoretical
classification that drives the structural fix regardless of what the live
snapshot would show.

```
error: SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string
 clientVersion: "7.7.0",
      at <anonymous> (/Users/vickkumar/code/tydei-next/node_modules/pg-pool/index.js:45:11)
```

## Classification framework

For each duplicate group, the `gap from first (ms)` column tells us which
layer let the dup through:

| Gap from first | Root cause | Where the fix lives |
|---|---|---|
| < 1000 ms | Double-click raced past the idempotency map (cache was written but the second request hit before `idempotencyPut` flushed through the event loop — or the client generated a NEW uuid on remount) | Client: idempotency key must be STABLE across the form session (useRef, not useMemo on a recomputed dep). Server: DB soft-dedupe catches if this still escapes. |
| 1-30 s | Two separate submit paths running side-by-side (e.g., manual form + AI-extract-review submit, or a background retry after a network blip) | Client: every submit path must pass an idempotency key. Server: DB soft-dedupe. |
| 30-60 s | TTL-expired replay. User closed the tab, reopened it, re-submitted with a freshly-generated key. The idempotency map forgot the first submission. | Server: DB soft-dedupe on `(facilityId, vendorId, name, effectiveDate)` within 30s. |
| > 60 s | Almost certainly genuine — user intentionally created two similar contracts. Do NOT dedupe. | n/a |
| Different `createdBy` | Two users submitting independently. Out of scope for W1.Y-B. | n/a |

## W1.W-E coverage (prior attempt)

`19b38ab` — W1.W-E1 — added an in-memory idempotency cache scoped by
`(user:facility:key)` with a 30s TTL. `createContract` short-circuits the
prisma write when the same key arrives twice inside the window. This covers
the "fast double-click inside the same form session" path (gap < 30s, same
key), but leaves three holes:

1. **Alternate submit path bypasses the client key.** Any future surface
   that calls `createContract` without generating a uuid lets duplicates
   through silently. Grep confirmed today only one caller
   (`components/contracts/new-contract-client.tsx`) invokes it via
   `useCreateContract`, and that caller already passes a ref-stable key
   (lines 118-122, 582, 643) — but the structural guarantee needs to be at
   the DB, not in per-site audits.
2. **TTL-expired re-submit.** If the user re-enters the form 31+ seconds
   after the first attempt (page-nav, stale form, react-query retry), the
   in-memory cache has forgotten the original, a new `crypto.randomUUID()`
   is generated, and the idempotency path is a no-op.
3. **Multi-instance deploys.** The cache is process-local. Two Next.js
   server instances behind a load balancer each have their own map; a
   request that lands on a different instance is a miss.

## Fix plan (matches plan Tasks 2 + 3)

- Task 2 — Audit every submit path. Today `createContract` has exactly one
  UI caller (`components/contracts/new-contract-client.tsx` via
  `hooks/use-contracts.ts::useCreateContract`), and the two submit functions
  there (`handleSubmit`, `handleSaveAsDraft`) BOTH already pass
  `idempotencyKey: idempotencyKeyRef.current`. The ref is initialized once
  at mount (useRef, not useMemo), so the key is stable across every click
  inside a given form session. No missing paths. The client-layer fix is
  therefore a *regression test* per path (it.each over the ones plan
  enumerated) so future new paths notice if they forget to pass a key.
- Task 3 — DB-level 30s soft-dedupe. Catches every hole above. In
  `createContract`, before the `prisma.contract.create`, find any contract
  row with the same `(facilityId, vendorId, name, effectiveDate)` created
  in the last 30s; if one exists, return the serialized row instead of
  writing a new one. Keyed on the user's perception of "same contract"
  regardless of session or key.

## Expected duplicate classes once the DB is reachable

Given Charles' iMessage screenshot ("Single Site Agreement - DePuy Synthes
Joint Reconstruction" — tie-in) showed a dup landed AFTER W1.W-E shipped,
and the single UI path already wires the key, the most likely class is:

- **Gap 30-120s, same createdBy, same key-or-no-key.** TTL-expired replay
  or a second tab. Fix: DB soft-dedupe.

If the live diagnostic instead reveals a sub-second gap with the same key,
that points at a React remount (e.g., Suspense boundary or parent-state
churn) that broke the `useRef`; in that case, also tighten the client side
to survive remounts (e.g., hoist the key to a URL search param or store).
No evidence of that today.
