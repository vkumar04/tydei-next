import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * This route is where a real IDOR hid before the 2026-06-18 pre-prod audit —
 * the auth-scope scanner explicitly extended into app/api/** because of it
 * (server-action-auth-scope-scanner.test.ts). It now serves two tenants, so the
 * scoping has to stay correct for both.
 *
 * A vendor reaching it is deliberate: gating on a facility made the AI
 * amendment reader unreachable from the vendor portal, which is what the user
 * hit. Vendors still cannot write the contract — their extracted changes seed a
 * ChangeProposal.
 */
const SOURCE = readFileSync(
  join(process.cwd(), "app/api/ai/extract-amendment/route.ts"),
  "utf8",
)

const code = SOURCE.split("\n")
  .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
  .join("\n")

describe("extract-amendment tenant scoping", () => {
  it("scopes the contract read through a canonical ownership helper for BOTH tenants", () => {
    expect(code).toContain("contractOwnershipWhere(contractId, facility.id)")
    expect(code).toContain("contractOwnershipWhereVendor(contractId, vendor")
  })

  it("never reads a contract by bare id", () => {
    // The IDOR shape: `where: { id: contractId }` with no tenant predicate.
    expect(code).not.toMatch(/where:\s*\{\s*id:\s*contractId\s*\}/)
  })

  it("rejects a caller belonging to neither tenant", () => {
    expect(code).toMatch(/if\s*\(!facility\s*&&\s*!vendor\)/)
    expect(code).toContain("No facility or vendor associated with this account")
  })

  it("attributes AI usage to whichever tenant called", () => {
    // Was hardcoded `vendorId: null`, so a vendor's spend billed to nobody.
    expect(code).toMatch(/facilityId:\s*facility\?\.id\s*\?\?\s*null/)
    expect(code).toMatch(/vendorId:\s*vendor\?\.id\s*\?\?\s*null/)
    expect(code).not.toMatch(/vendorId:\s*null\s*,/)
  })
})
