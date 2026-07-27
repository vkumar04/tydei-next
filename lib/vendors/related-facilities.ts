import type { Prisma } from "@/lib/generated/prisma/client"

/**
 * Facilities a vendor has a real relationship with: a contract (including
 * grouped membership via `additionalVendorIds`), COG sales history, a
 * submitted/draft PendingContract, or an ACCEPTED Connection.
 *
 * Charles 2026-07-27: promoted out of `lib/actions/vendor-prospective.ts`
 * (where it lived as a file-local helper for the prospective/reports facility
 * pickers) so the vendor "New Contract" picker can reuse the SAME predicate
 * instead of re-inlining it. That picker listed EVERY active facility in the
 * system — harmless while every vendor submission still needed facility
 * approval, a cross-tenant hazard once one-way submissions auto-activate
 * (`lib/connections/operating-mode.ts`).
 *
 * IMPORTANT — this is a *visibility* predicate, not a write grant. It is
 * deliberately broad (COG history alone qualifies) because it answers "which
 * facilities may this vendor see in a picker". Minting a LIVE contract onto a
 * facility's tenant needs the much narrower `canAutoActivate` gate (an
 * accepted Connection row); never substitute this predicate for that one.
 * It is also partly self-satisfiable — a vendor can submit a PendingContract
 * against any facility id it names, which then makes that facility match the
 * `pendingContracts` arm — so treat it as ergonomics, never as a boundary.
 *
 * The Connection arm is pinned to `accepted` on purpose: `sendConnectionInvite`
 * lets a vendor mint a `pending` row against any facility it can name, so a
 * bare existence check would let a vendor add ANY facility to its own picker
 * (and to the prospective/reports surfaces that share this predicate) in one
 * call. It is here at all because auto-activation keys off exactly this
 * relationship — without it a vendor whose only tie to a facility is a fresh
 * accepted connection saw an EMPTY picker, and the submission form fell
 * through to its facility-less standalone path instead of attaching the
 * contract to the facility it is actually connected to.
 */
export function vendorRelatedFacilityWhere(
  vendorId: string,
): Prisma.FacilityWhereInput {
  return {
    OR: [
      {
        contracts: {
          some: {
            OR: [
              { vendorId },
              { additionalVendorIds: { has: vendorId } },
            ],
          },
        },
      },
      { cogRecords: { some: { vendorId } } },
      { pendingContracts: { some: { vendorId } } },
      { connections: { some: { vendorId, status: "accepted" } } },
    ],
  }
}
