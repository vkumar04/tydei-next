/**
 * Charles W2.B — contract-detail "terms and conditions" must be
 * byte-identical across two sequential loads.
 *
 * Charles reported: "every time I enter a contract I am getting a
 * different result on terms and conditions." Diagnostic in
 * `docs/superpowers/diagnostics/2026-04-22-w2b-terms-locate.md`
 * classifies the most likely cause as **Class C — missing `orderBy`**
 * on the `products` include in `getContractTerms`:
 *
 *   include: {
 *     tiers: { orderBy: { tierNumber: "asc" } },
 *     products: { select: { vendorItemNo: true } },   // ← no orderBy
 *   }
 *
 * Without `ORDER BY` Postgres makes no stability guarantee for the
 * row order returned by `contract_term_product` — two sequential
 * reads can hand back the same rows in different sequence, which
 * flows straight into `term.products` on the serialized payload.
 *
 * Strategy: use the real DB (so the Postgres ordering hazard is
 * actually exercised), mock only `requireFacility` so the action
 * doesn't demand a session. Pick any contract that has a term,
 * seed a handful of `ContractTermProduct` rows against it to force
 * multi-row ordering to matter, then call `getContractTerms` twice
 * and `expect(second).toStrictEqual(first)`.
 *
 * ── STATUS: this test currently PASSES on main even though the
 *    orderBy is missing, because Postgres returns the small seeded
 *    result in heap-insert order when there is no concurrency. The
 *    plan's Task 2 Step 2 branches on "test unexpectedly passes"
 *    and instructs us to document "could not reproduce" (see the
 *    diagnostic). The fix implementer should still add the orderBy
 *    — it's a real hazard that will manifest under VACUUM /
 *    concurrent writes / larger row counts — and this test stays
 *    in place as a locked-in regression guard once the fix lands.
 *    If the eventual fix decides to sort by a different key, update
 *    the seed data here so the deep-equal remains meaningful.
 *
 * Run with DATABASE_URL in env so prisma can reach the local DB:
 *   DATABASE_URL=postgresql://tydei:tydei_dev_password@localhost:5432/tydei \
 *     bunx vitest run lib/actions/__tests__/terms-determinism.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// ─── Mock auth — facility id is patched in beforeAll to match the
//     real contract row so the round-9 ownership check passes.
const facilityIdRef = { current: "test-facility" }
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    user: { id: "test-user" },
    facility: { id: facilityIdRef.current },
  })),
}))

import { prisma } from "@/lib/db"
import { getContractTerms } from "@/lib/actions/contract-terms"

describe("terms content determinism (Charles W2.B)", () => {
  let contractId: string
  let termId: string
  const seededItemNumbers: string[] = [
    "W2B-DET-ITEM-E",
    "W2B-DET-ITEM-A",
    "W2B-DET-ITEM-C",
    "W2B-DET-ITEM-B",
    "W2B-DET-ITEM-D",
  ]

  beforeAll(async () => {
    // Find any contract that has at least one ContractTerm. We don't
    // care which facility owns it — `getContractTerms` scopes by
    // `contractId` only (auth is stubbed above), so any term-bearing
    // contract gives us the ordering surface.
    const term = await prisma.contractTerm.findFirst({
      select: { id: true, contractId: true, contract: { select: { facilityId: true } } },
    })
    if (!term) {
      throw new Error(
        "[terms-determinism] no ContractTerm in DB — run the seed script first",
      )
    }
    contractId = term.contractId
    termId = term.id
    // Round-9: patch the auth mock so the ownership check passes.
    if (!term.contract.facilityId) {
      throw new Error("[terms-determinism] contract has no facilityId")
    }
    facilityIdRef.current = term.contract.facilityId

    // Seed multiple ContractTermProduct rows in an order that is NOT
    // naturally sorted — if the action ever decides to sort by
    // vendorItemNo or by id internally, the drift hazard disappears.
    // The `skipDuplicates` flag keeps the test re-runnable.
    await prisma.contractTermProduct.createMany({
      data: seededItemNumbers.map((vendorItemNo) => ({
        termId,
        vendorItemNo,
      })),
      skipDuplicates: true,
    })
  })

  afterAll(async () => {
    // Best-effort cleanup — the test seeds 5 rows that we own by prefix.
    await prisma.contractTermProduct.deleteMany({
      where: {
        termId,
        vendorItemNo: { in: seededItemNumbers },
      },
    })
    await prisma.$disconnect()
  })

  it("returns byte-identical content across two sequential calls", async () => {
    const first = await getContractTerms(contractId)
    const second = await getContractTerms(contractId)

    // This is the failure mode we're chasing: the Prisma `products`
    // include has no `orderBy`, so Postgres is free to hand the rows
    // back in a different sequence between the two calls. The deep
    // equality check catches that drift on the serialized payload —
    // the exact same object tree Charles would see rendered on
    // /dashboard/contracts/<id>/terms.
    expect(second).toStrictEqual(first)
  })
})
