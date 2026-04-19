/**
 * Pricing CSV export endpoint — Charles R5.14.
 *
 * Verifies facility scoping: returns CSV for a contract that belongs to
 * the caller's facility, 403 for one that doesn't.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const contractFindFirst = vi.fn()
const pricingFindMany = vi.fn()
const memberFindFirst = vi.fn()
const getSession = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findFirst: (args: unknown) => contractFindFirst(args) },
    contractPricing: { findMany: (args: unknown) => pricingFindMany(args) },
    member: { findFirst: (args: unknown) => memberFindFirst(args) },
  },
}))

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: (args: unknown) => getSession(args) } },
}))

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}))

// Import route AFTER mocks.
import { GET } from "@/app/api/contracts/[id]/pricing/export/route"

function mkReq() {
  return new Request("http://localhost/api/contracts/c-1/pricing/export")
}
function mkParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { id: "user-1" } })
  memberFindFirst.mockResolvedValue({
    organization: { facility: { id: "fac-a" } },
  })
})

describe("GET /api/contracts/[id]/pricing/export", () => {
  it("returns 401 when no session", async () => {
    getSession.mockResolvedValue(null)
    const res = await GET(mkReq(), mkParams("c-1"))
    expect(res.status).toBe(401)
  })

  it("returns 403 when the contract is owned by another facility", async () => {
    contractFindFirst.mockResolvedValue(null)
    const res = await GET(mkReq(), mkParams("c-other"))
    expect(res.status).toBe(403)
    // Confirm the scope filter was applied.
    expect(contractFindFirst).toHaveBeenCalledWith({
      where: { id: "c-other", facilityId: "fac-a" },
      select: { id: true },
    })
    expect(pricingFindMany).not.toHaveBeenCalled()
  })

  it("returns 200 + CSV for a facility-owned contract", async () => {
    contractFindFirst.mockResolvedValue({ id: "c-1" })
    pricingFindMany.mockResolvedValue([
      {
        vendorItemNo: "ABC-1",
        description: "Widget, with, comma",
        category: "Implant",
        unitPrice: { toString: () => "12.50" },
        listPrice: { toString: () => "20.00" },
        uom: "EA",
        effectiveDate: new Date("2026-01-01"),
        expirationDate: null,
      },
    ])

    const res = await GET(mkReq(), mkParams("c-1"))
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Type")).toContain("text/csv")
    expect(res.headers.get("Content-Disposition")).toContain(
      `filename="contract-c-1-pricing-`,
    )

    const body = await res.text()
    const lines = body.split("\n")
    expect(lines[0]).toBe(
      "vendorItemNo,description,category,unitPrice,listPrice,uom,effectiveDate,expirationDate",
    )
    // RFC 4180 quoting for the comma-containing description.
    expect(lines[1]).toBe(
      'ABC-1,"Widget, with, comma",Implant,12.50,20.00,EA,2026-01-01,',
    )
  })
})
