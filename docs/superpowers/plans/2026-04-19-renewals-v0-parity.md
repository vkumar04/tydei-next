# Renewals v0 parity — investigate + fix

Six gaps found in the v0 parity audit (after de-speculating the audit's
claims). Dispatch 5 parallel subagents in isolated worktrees.

## Items

### W1.1 — Performance history not wired to detail modal
- `components/facility/renewals/renewals-mappers.ts:95` hardcodes
  `performanceHistory: []`
- Detail modal at `renewal-detail-tabs.tsx:228` always shows "insufficient
  history"
- Helper `lib/renewals/performance-history.ts` exists but is never called
- Fix: call `getPerformanceHistory(contractId)` when the detail modal
  opens (lazy load), or fold into `getExpiringContracts`

### W1.2 — RenewalNote.authorId is nullable with no User relation
- `prisma/schema.prisma`: `authorId String?` with no `@relation`
- Risk: orphaned notes, no audit trail
- Fix: tighten to `String @relation(fields:[authorId], references:[id])`;
  backfill existing NULLs (pick a system user OR delete orphans); `bun
  run db:push`; add back-relation to User model

### W1.3 — ProposalStatus enum missing `countered`
- `prisma/schema.prisma` enum has only pending/approved/rejected/
  revision_requested
- Fix: add `countered`; update `lib/renewals/proposal-review.ts` to
  handle; update any UI that renders status badges

### W1.4 — Proposal actions `initiateRenewal` vs `submitRenewalProposal`
- Vendor pipeline dialog uses `initiateRenewal`
- Separate `submitRenewalProposal` action also exists — unclear which is
  canonical
- Fix: investigate both; consolidate to one; rewire the UI to the
  canonical action; delete the redundant one

### W1.5 — ICS calendar export stubbed
- Button text "Export Calendar" at `vendor-renewals-client.tsx:126`
- No `.ics` generator implementation
- Fix: implement `lib/renewals/exports/ics.ts` (RFC 5545); wire download
  handler on both facility and vendor pages

### W1.6 — Renewal checklist not persistent
- `lib/renewals/engine.ts::generateRenewalTasks` computes 5 tasks on each
  render
- No DB model; users cannot mark tasks complete
- Fix: add `RenewalTask` model (contractId, taskKey, completed,
  completedBy, completedAt); CRUD actions; checkbox UI in detail modal

## Rubric (every task)

1. Reproduce the gap on the live dev server (port 3000). Cookie at
   `/tmp/c.txt` = demo-facility@tydei.com; re-login via
   `/api/auth/sign-in/email` with
   `{"email":"demo-facility@tydei.com","password":"demo-facility-2024"}`
   if stale.
2. Implement the minimal fix in an isolated worktree.
3. If schema changes: edit `prisma/schema.prisma`, run
   `bun run db:push` to apply to local DB, then `bunx prisma generate
   --config prisma/prisma.config.ts` (though `db:push` usually does it).
4. Write a Vitest regression if server-side.
5. `bunx tsc --noEmit` → 0 errors before commit.
6. Commit with `fix(renewals): ...`. Don't push.
7. Report branch + SHA + files + brief root-cause explanation.
