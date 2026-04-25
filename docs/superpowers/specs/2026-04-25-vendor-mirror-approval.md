# Vendor mirror + bidirectional approval workflow — design

Charles 2026-04-25 iMessage:
> "The Vendor contract side should mirror for choices the facility side
> and how they are set up but there should be an approval process when
> the vendor does it that goes back and forth."

Phase 1 has shipped. Phases 2 + 3 below are the remaining work.

## Phase 1 — what shipped 2026-04-25

Goal: stop silently dropping data and notify humans on submit/decision.

- `lib/actions/pending-contracts.ts approvePendingContract` now ports
  the `terms` JSON blob into real `ContractTerm` + `ContractTier`
  rows. Previously these were silently dropped on approve, so every
  vendor-submitted contract appeared as "active" but had no rebate
  structure → accruals were $0 forever.
- `extractPendingTerms` helper does the JSON → typed row conversion
  defensively so a malformed blob doesn't blow the approval.
- New email templates: `pendingContractSubmittedEmail`,
  `pendingContractDecisionEmail`.
- New notification helpers: `notifyFacilityOfPendingContract`,
  `notifyVendorOfPendingDecision`. Both use a new
  `getVendorMemberEmails(vendorId)` peer of the existing facility
  helper.
- Wired from `createPendingContract` → notify facility, and from
  `approvePendingContract` / `rejectPendingContract` /
  `requestRevision` → notify vendor.

Scope explicitly excluded from Phase 1 (would need schema migration):
field parity (capital tie-in, productCategoryId, multi-facility,
performancePeriod, rebatePayPeriod, contractNumber, autoRenewal, etc.).

## Phase 2 — richer flow (1-2 days)

Goal: vendor can mirror the full facility form; revision loop is
truly bidirectional.

### Schema migration

Add to `PendingContract`:

```prisma
model PendingContract {
  // ... existing
  contractNumber         String?
  productCategoryId      String?
  productCategory        ProductCategory? @relation(...)
  multiFacilityIds       String[]
  autoRenewal            Boolean   @default(false)
  terminationNoticeDays  Int       @default(90)
  performancePeriod      String?
  rebatePayPeriod        String?
  gpoAffiliation         String?
  annualValue            Decimal?  @db.Decimal(14, 2)

  // Tie-in capital (mirrors Contract)
  capitalCost            Decimal?  @db.Decimal(14, 2)
  interestRate           Decimal?  @db.Decimal(6, 4)
  termMonths             Int?
  downPayment            Decimal?  @db.Decimal(14, 2)
  paymentCadence         String?
  amortizationShape      String?

  // Counter-proposal (facility-suggested edits)
  counterProposal        Json?
}
```

Plus a `Notification` model:

```prisma
model Notification {
  id        String   @id @default(cuid())
  userId    String
  type      String   // "pending_contract_submitted" | "decision" | etc.
  payload   Json
  readAt    DateTime?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, readAt])
  @@map("notification")
}
```

### Implementation

1. Extend `createPendingContractSchema` + `updatePendingContractSchema`
   in `lib/validators/pending-contracts.ts` with all the new fields.
2. Update `createPendingContract` / `updatePendingContract` to
   persist them.
3. Update the vendor submission UI
   (`components/vendor/contracts/submission/*`) to render the new
   field cards. Most state is already collected — just send it to the
   server. Add a new `tie-in-capital-card.tsx` under
   `components/vendor/contracts/submission/` that mirrors the facility
   tie-in fields.
4. Update `approvePendingContract` to port the new fields onto the
   created `Contract` row (alongside the existing terms + pricing
   port).
5. Add a "Counter" action on `pending-review-dialog.tsx` that
   mutates `pending.counterProposal` (Json) and bumps status to
   `revision_requested`. Vendor sees the counter-proposal in their
   editor, with a side-by-side diff.
6. In-app `Notification` records: write a row whenever the email
   path fires; render an unread-count badge in the vendor + facility
   nav. Use `requireVendor()` / `requireFacility()` to scope.
7. Test plan: vendor submits → facility request-revision → vendor
   edits + resubmits → facility approves. Assert state transitions,
   email send count, Notification row count, and that the resulting
   `Contract` has the same field set as a facility-created equivalent
   (parity test).

### Files (Phase 2)

- `prisma/schema.prisma` (migration)
- `lib/validators/pending-contracts.ts`
- `lib/actions/pending-contracts.ts`
- `components/vendor/contracts/submission/*` (new tie-in card +
  field additions)
- `components/facility/contracts/pending-review-dialog.tsx` (counter
  action)
- `components/shared/notification-bell.tsx` (new)
- `lib/actions/notifications.ts` (Notification model writes)
- `lib/actions/__tests__/pending-contracts-roundtrip.test.ts` (new)

## Phase 3 — full bidirectional editing on approved contracts (week+)

Goal: after approval, vendor can propose edits to live `Contract` and
facility can accept/counter — true GPO-style amendment loop.

### Existing scaffolding to leverage

`ContractChangeProposal` model already exists at
`prisma/schema.prisma:1056` with status enum `pending | approved |
rejected | revision_requested | countered`. The component
`components/vendor/contracts/change-proposal-form.tsx` is partially
built. Wire `/vendor/contracts/[id]/edit` to create a
`ContractChangeProposal` instead of mutating the contract directly.

### Implementation

1. Vendor's "Edit Contract" route (`app/vendor/contracts/[id]/edit`)
   creates a `ContractChangeProposal` with the diff. Uses the same
   submission cards as the new-contract form, pre-filled with the
   current contract values.
2. Facility-side review UI: render the proposal as a side panel on
   the contract detail page. Show diff (proposed vs current).
   Actions: approve / reject / counter / request revision.
3. On approve: write a `applyProposal()` helper that mutates
   `Contract` + `ContractTerm` + `ContractTier` from the JSON diff.
   Critical: route every numeric value through the canonical-helpers
   table — especially `toDisplayRebateValue` /
   `fromDisplayRebateValue` for tier rebates (the unit-scaling rule
   in `docs/architecture/recurring-bug-patterns.md`).
4. Audit trail: append-only `ContractChangeProposalEvent` model
   (id, proposalId, actor, action, payload Json, createdAt).
5. Parity test: `proposal-applied contracts pass canonical-reducer
   assertions identical to directly-edited contracts` —
   `lib/actions/__tests__/contracts-list-vs-detail-parity.test.ts`
   already has the framework, extend it.

### Files (Phase 3)

- `prisma/schema.prisma` (ContractChangeProposalEvent migration)
- `lib/actions/contract-proposals.ts` (CRUD + applyProposal)
- `app/vendor/contracts/[id]/edit/page.tsx` (route to new form)
- `components/vendor/contracts/change-proposal-form.tsx` (finish)
- `components/contracts/contract-proposal-side-panel.tsx` (new)
- `lib/actions/__tests__/contract-proposals.test.ts` (new)
- `lib/actions/__tests__/proposal-applied-parity.test.ts` (new)

## Open product questions (pending Charles input)

- Does the vendor see the facility's COG when proposing a
  contract? (i.e. can the vendor pre-fill `ContractPricing` items
  from the facility's existing COG rows?)
- For amendments after approval: should the original contract stay
  active during proposal review, or pause? Affects rebate accrual.
- Do GPO-affiliated contracts need a third party in the approval
  loop?

## Open technical questions

- Counter-proposal storage: dedicated column on `PendingContract` vs
  reuse `ContractChangeProposal`? Phase 2 picks dedicated for
  simplicity; revisit when Phase 3 lands.
- Notification model vs a queue: in-process `Notification` rows are
  fine for now; if email volume grows, consider Vercel Queues for
  durable retry semantics.
