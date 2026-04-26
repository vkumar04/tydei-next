# Role model — server-action authorization spec

**Status:** canonical
**Origin:** Charles audit suggestion #5 — formalize the role boundaries that produced 17 BLOCKERs across 14 audit rounds.

## The 4 roles

| Role | Source | Owns | Cannot do |
|---|---|---|---|
| `admin` | `Member.role === "admin"` on the platform-org | Cross-tenant taxonomy: `Vendor.update/deactivate`, `ProductCategory.update/delete`, `VendorNameMapping.confirm/delete`. Platform settings. | (no restrictions vs other roles, but should not write tenant-owned data unless impersonating) |
| `facility` | `Member.organization.facility !== null` | Everything scoped by `facility.id`: contracts, COG records, pricing, invoices, POs, rebates, alerts, reports for that facility. | Touch other facilities' data; mutate global taxonomy. |
| `vendor` | `Member.organization.vendor !== null` | Everything scoped by `vendor.id`: pending contracts they submitted, change proposals on their contracts, vendor profile, vendor PO/invoice submissions. | Touch other vendors' data; touch facility-only data. |
| `unauthenticated` | no session | Public marketing pages, login, signup. | Anything else. |

## The auth helpers

All in `lib/actions/auth.ts`:

```ts
requireAuth()      // → { user, session }                 — any logged-in user
requireFacility()  // → { user, session, facility }       — facility membership
requireVendor()    // → { user, session, vendor }         — vendor membership
requireAdmin()     // → { user, session }                 — admin role
```

Pattern: every server action MUST call exactly one of these as its first
operation. The auth-scope scanner (`lib/actions/__tests__/server-action-auth-scope-scanner.test.ts`)
enforces this for the prisma-write half by failing CI when a write
runs without a tenant-scoped where clause.

## Per-action ACL

Reads and writes are gated by entity ownership in addition to the role.
Convention: derive the tenant id from the session (NOT from input), and
use it in either:

1. **Compound where**: `{id, facilityId: facility.id}` / `{id, vendorId: vendor.id}` / `{id, organizationId}`
2. **Canonical helper**: `contractOwnershipWhere(contractId, facility.id)` for reads on the multi-facility-aware Contract table.

### Decision matrix — when to use which

| Scenario | Helper |
|---|---|
| Contract by id, facility-side | `contractOwnershipWhere(id, facility.id)` (handles multi-facility shared contracts) |
| Contract by id, vendor-side | `{ id, vendorId: vendor.id }` (vendor sees only their own) |
| ContractTerm/Tier/etc. by id | Resolve `contractId` from the row, then `contractOwnershipWhere` |
| Rebate by id | `findFirstOrThrow({ where: { id, contractId } })` (eliminates existence oracle) |
| PendingContract by id, vendor | `{ id, vendorId: vendor.id }` |
| PendingContract by id, facility | `{ id, facilityId: facility.id }` |
| Vendor profile (read) | by id is fine — Vendor is shared-read |
| Vendor profile (write) | `requireAdmin()` — Vendor is shared-write-restricted |
| Member by id | `assertCallerCanManage(session.user.id, target.organizationId)` |
| Connection by id | `assertCallerOnConnection(session.user.id, connectionId)` |
| S3 key (download/delete) | `assertKeyVisibleToUser(key)` — checks the key appears in a row the user can reach |

## Authoritative identity

Three rules, in order of importance:

1. **Identity comes from `requireX()`, not from input.** A vendor's `vendorId` is `vendor.id`, not `input.vendorId`. A facility's `facilityId` is `facility.id`. The reviewer-of-record on an audit row is `user.id`, not `input.reviewedBy`.
2. **Joined identity comes from the row, not from input.** When persisting a child entity (e.g. PendingContract, Invoice), look up the parent (Contract, PurchaseOrder) and copy its identity (facilityId, vendorId) onto the child rather than trusting the client.
3. **Cross-tenant references are validated.** When a client provides a foreign id (e.g. `tieInContractId`, `purchaseOrderId`), verify it belongs to the caller's tenant before persisting.

## "use server" hygiene

- Every export of a `"use server"` file is auto-registered as an RPC entry point. There is no exception.
- Internal helpers MUST live in non-`"use server"` modules (convention: `lib/contracts/`, `lib/rebates/`, `lib/cog/`). The files under `lib/actions/` are the RPC surface.
- The dispatcher pattern: a small set of `lib/actions/<entity>/*.ts` exports actions. Each action calls `requireX()`, validates input, and delegates compute to a helper in `lib/<entity>/`. The helper does NOT auth-check (its caller did).

## Notification helpers

Notification fan-out actions (`notifyFacilityOfPendingContract`,
`notifyVendorOfPendingDecision`, `sendAlertNotification`, etc.) are
post-write hooks. They REQUIRE `requireAuth()` at the boundary so an
unauthenticated RPC can't fire spoofed notifications, but the
authoritative "who triggered this" comes from the calling action's
session, not from the helper's session. Best-effort error handling:
notification failures must NEVER block the underlying mutation.

## Test enforcement

Three CI scanners enforce the model:

1. **`auth-gate-scanner.test.ts`** — every page.tsx in `app/dashboard/`, `app/vendor/`, `app/admin/` references the matching `requireX()` guard.
2. **`server-action-auth-scope-scanner.test.ts`** — every raw-id prisma op in a `"use server"` file scopes by tenant or uses a canonical helper. Operates in baseline mode — fails on net-new findings.
3. **`rebate-value-scaling-drift.test.ts`** — every rebateValue interpolation goes through the canonical scaling helper (related but different invariant).

## Stale-baseline rule

When you fix an entry on the auth-scope scanner's `BASELINE_HITS`, the
test fails with "stale baseline entries — remove them." This forces
the list to shrink over time and prevents the baseline from quietly
accumulating new debt.

## What's deferred (not in this doc)

- **Sub-roles within facility/vendor**: `viewer` vs `editor` vs `owner` granularity inside an org. The current implementation uses `Member.role` ∈ `{owner, admin, member}` from better-auth defaults. `assertCallerCanManage` checks for owner/admin. Finer granularity (e.g. read-only viewers, contract-creator-but-not-deleter) is a future product call.
- **Audit trail**: every privileged action should log to `AuditLog`. Most do; coverage is uneven. A separate spec should enumerate which actions MUST log.
