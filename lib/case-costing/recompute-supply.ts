import type { PrismaClient } from "@prisma/client"

/**
 * Recompute `CaseSupply.isOnContract` + `CaseSupply.contractId` for a
 * facility, mirroring what `lib/cog/recompute.ts recomputeMatchStatusesForVendor`
 * does for COG rows.
 *
 * Why this exists (Charles 2026-04-25):
 *
 * `CaseSupply.isOnContract` is the sole input to the Case Costing
 * "On-Contract %" column on the surgeon scorecards and the facility
 * compliance hero. It's currently written ONLY at supply-create time
 * (`lib/actions/cases.ts:380` `importCaseSupplies` defaults
 * `isOnContract: supply.isOnContract ?? false`) and there is no
 * recompute path that flips it as contracts come and go.
 *
 * Result: a fresh demo DB shows "Avg On-Contract 0.0%" because the
 * import never sets the flag, and adding a new contract afterward
 * doesn't update existing supplies. Per CLAUDE.md, every parallel
 * data source needs a canonical writer; this is that writer.
 *
 * Algorithm (mirrors `recomputeMatchStatusesForVendor`):
 *   1. Load every `Case` for the facility with its supplies +
 *      vendorItemNo + dateOfSurgery.
 *   2. Load every active/expiring `Contract` for the facility's
 *      contractFacilities web with its `pricingItems` (vendorItemNo
 *      catalog) + effectiveDate/expirationDate window.
 *   3. For each supply, look up `(vendorItemNo, dateOfSurgery)`
 *      against each contract's pricing window. If any match wins,
 *      stamp `isOnContract=true, contractId=match.id`. Otherwise
 *      `isOnContract=false, contractId=null`.
 *
 * Best-effort and idempotent: safe to call after every contract
 * CRUD, after a COG import, and from a manual "Re-run" button. The
 * caller decides whether to await it (block on the user-visible
 * action) or fire-and-forget (post-write side effect).
 */
export async function recomputeCaseSupplyContractStatus(
  db: PrismaClient,
  facilityId: string,
): Promise<{ scanned: number; flippedOn: number; flippedOff: number }> {
  // Active contract catalog: pricingItems define the join key
  // (vendorItemNo); contract date window bounds the validity period.
  const contracts = await db.contract.findMany({
    where: {
      status: { in: ["active", "expiring"] },
      OR: [
        { facilityId },
        { contractFacilities: { some: { facilityId } } },
      ],
    },
    select: {
      id: true,
      effectiveDate: true,
      expirationDate: true,
      pricingItems: {
        select: { vendorItemNo: true },
      },
    },
  })

  // Build a lookup: vendorItemNo → array of {contractId, start, end}
  // so we can pick the contract whose window contains the supply date.
  const byItem = new Map<
    string,
    Array<{ contractId: string; start: Date; end: Date }>
  >()
  for (const c of contracts) {
    for (const p of c.pricingItems) {
      if (!p.vendorItemNo) continue
      const arr = byItem.get(p.vendorItemNo) ?? []
      arr.push({
        contractId: c.id,
        start: c.effectiveDate,
        end: c.expirationDate,
      })
      byItem.set(p.vendorItemNo, arr)
    }
  }

  // Stream through cases at the facility. Anchored on Case (not
  // CaseSupply) so we can use Case.dateOfSurgery for the window check
  // without an extra join per supply.
  const cases = await db.case.findMany({
    where: { facilityId },
    select: {
      id: true,
      dateOfSurgery: true,
      supplies: {
        select: {
          id: true,
          vendorItemNo: true,
          isOnContract: true,
          contractId: true,
        },
      },
    },
  })

  let scanned = 0
  let flippedOn = 0
  let flippedOff = 0
  // Collect updates; apply in a single $transaction at the end so the
  // recompute is all-or-nothing per call.
  const updates: Array<{ id: string; isOnContract: boolean; contractId: string | null }> = []

  for (const c of cases) {
    for (const s of c.supplies) {
      scanned += 1
      if (!s.vendorItemNo) {
        // No vendorItemNo = can't match. Zero it out only if it was
        // previously stamped on-contract (guards against churn).
        if (s.isOnContract) {
          updates.push({ id: s.id, isOnContract: false, contractId: null })
          flippedOff += 1
        }
        continue
      }
      const candidates = byItem.get(s.vendorItemNo) ?? []
      const dateMs = c.dateOfSurgery.getTime()
      const match = candidates.find(
        (cand) =>
          cand.start.getTime() <= dateMs && cand.end.getTime() >= dateMs,
      )
      if (match) {
        if (!s.isOnContract || s.contractId !== match.contractId) {
          updates.push({
            id: s.id,
            isOnContract: true,
            contractId: match.contractId,
          })
          if (!s.isOnContract) flippedOn += 1
        }
      } else if (s.isOnContract) {
        updates.push({ id: s.id, isOnContract: false, contractId: null })
        flippedOff += 1
      }
    }
  }

  if (updates.length > 0) {
    // Chunk the transaction to keep each write batch tractable.
    const CHUNK = 500
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK)
      await db.$transaction(
        chunk.map((u) =>
          db.caseSupply.update({
            where: { id: u.id },
            data: { isOnContract: u.isOnContract, contractId: u.contractId },
          }),
        ),
      )
    }
  }

  return { scanned, flippedOn, flippedOff }
}
