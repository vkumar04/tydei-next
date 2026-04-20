# Charles W1.Y-B — Duplicate contract create

**Date:** 2026-04-20
**Reporter:** Charles (iMessage 2026-04-20 11:37 AM)
**Prior attempt:** `19b38ab` — W1.W-E "E1: double-click idempotency key" — inadequate.

## Problem

*"Still letting multilple contracts get created."* Charles posted a screenshot showing the new-contract form with a freshly-filed contract ("Single Site Agreement - DePuy Synthes Joint Reconstruction" — contract type tie-in) and a duplicate created. W1.W-E added a 30s-TTL in-memory idempotency map keyed on `(user+facility:key)` to dedupe on double-click. Duplicates are still landing, so either:

- (a) the idempotency path is not hit (alternate submit route — e.g., AI-extracted contract → submit bypasses the key generation)
- (b) the TTL is too short and a slow second click misses the cache
- (c) a different "Create" button (dialog, import, AI review page) has no idempotency wiring at all
- (d) the client generates a NEW `crypto.randomUUID()` on re-render so two attempts get different keys

## Approach

### Step 0 — Diagnostic

Script `scripts/diagnose-duplicate-contracts.ts`:

- List all `Contract` rows for the demo facility created in the last 24h.
- Group by `(name, vendorId, effectiveDate, facilityId, contractType)` tuples.
- Print duplicates: `rowId | createdAt | createdByUserId` per group.
- Surface `auditLog` / `Activity` entries tied to each duplicate to infer which UI path created it.
- Save to `docs/superpowers/diagnostics/2026-04-20-w1y-b-duplicates.md`.

Use the diagnostic output to isolate the submit path.

### Step 1 — Fix root-cause

Depending on diagnostic (most likely candidate paths):

- **AI extract → review → submit.** The "Create Contract" button on `components/contracts/ai-extract-review.tsx` may not pass an idempotency key. Wire one.
- **`contract-form.tsx` without key.** Any surface that mounts `contract-form.tsx` without providing an idempotency key falls back to no-key → server accepts. Tighten the server to REQUIRE an idempotency key on create and reject requests without one (non-breaking: add the key to every existing client at the same time).
- **Server-side DB uniqueness.** Add a soft uniqueness rule: same `(facilityId, vendorId, name, effectiveDate)` within 30s rejects as a duplicate. Complements the idempotency cache; catches alternate paths we missed.

### Step 2 — Regression tests

`lib/actions/__tests__/contract-create-dedupe-paths.test.ts`:

- One test per submit path (manual form, AI extract review, PDF import dialog if it exists). Double-click simulation on each must produce exactly one `prisma.contract.create`.
- Narrow test naming: `it("deduplicates double-submit from the <path> flow (Charles iMessage 2026-04-20)")`.
- Plus a DB-level uniqueness test covering the 30s soft-dedupe fallback.

## Files

- `scripts/diagnose-duplicate-contracts.ts`
- `docs/superpowers/diagnostics/2026-04-20-w1y-b-duplicates.md`
- `lib/actions/contracts.ts` — tighten idempotency
- Every submit-path client (`contract-form.tsx`, `ai-extract-review.tsx`, any import dialog)
- `lib/actions/__tests__/contract-create-dedupe-paths.test.ts`

## Out of scope

- Cross-user dedupe (users on different sessions submitting the same contract — separate privilege question).
