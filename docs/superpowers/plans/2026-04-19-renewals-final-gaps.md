# Renewals — close final audit gaps

After today's W1.1–W1.6, two items still open from the parity audit. Ship
in parallel.

## W1.7 — Counter-Propose dialog UI

W1.3 landed the `countered` enum + `counterContractChangeProposal` server
action + statusMap. The button is currently STUBBED on both review UIs
(`components/contracts/contract-change-proposals-card.tsx` and
`components/facility/contracts/proposal-review-list.tsx`) — disabled
with a TODO comment. Ship the dialog.

Scope:
- Dialog with textarea for counter-terms + optional message field
- On submit, call `counterContractChangeProposal(id, { counterTerms,
  message })`
- Toast success + invalidate relevant TanStack queries (proposals list,
  contract detail)
- Both review surfaces reuse the same dialog

## W1.8 — Vendor RenewalNote timeline

Facility side renders notes; vendor side doesn't. v0 spec §19 says the
vendor detail dialog should include a "Renewal Notes" timeline tab
showing notes sorted by createdAt.

Scope:
- New tab or section in `components/vendor/renewals/vendor-renewal-pipeline.tsx`'s
  detail dialog (or wherever the vendor renewal detail surface is)
- Calls `listRenewalNotes(contractId)` via a TanStack hook
- Renders notes as a vertical timeline with author + relative timestamp
- Read-only for now (notes compose stays on the facility side per
  current `requireFacility` guard — spec's "vendor-only" was rejected in
  earlier audit)
