import { describe, it, expect } from "vitest"
import {
  resolveContractForCOG,
  type ResolveContext,
} from "@/lib/cog/match"

const ctx: ResolveContext = {
  pricingByVendorItem: new Map([
    [
      "STK-1",
      [
        {
          contractId: "c-1",
          effectiveStart: new Date("2026-01-01"),
          effectiveEnd: new Date("2027-01-01"),
        },
      ],
    ],
  ]),
  activeContractsByVendor: new Map([
    [
      "v-stryker",
      [
        {
          id: "c-1",
          effectiveDate: new Date("2026-01-01"),
          expirationDate: new Date("2027-01-01"),
        },
      ],
    ],
  ]),
  fuzzyVendorMatch: (name: string) =>
    name.toLowerCase().includes("stryker") ? "v-stryker" : null,
}

describe("resolveContractForCOG cascade", () => {
  it("hits vendorItemNo match first", () => {
    const r = resolveContractForCOG(
      {
        vendorItemNo: "STK-1",
        vendorId: null,
        transactionDate: new Date("2026-04-01"),
        vendorName: "stryker",
      },
      ctx,
    )
    expect(r).toEqual({ contractId: "c-1", mode: "vendorItemNo" })
  })

  it("falls back to vendorId+date when vendorItemNo misses", () => {
    const r = resolveContractForCOG(
      {
        vendorItemNo: "UNKNOWN",
        vendorId: "v-stryker",
        transactionDate: new Date("2026-04-01"),
        vendorName: "x",
      },
      ctx,
    )
    expect(r.mode).toBe("vendorAndDate")
    expect(r.contractId).toBe("c-1")
  })

  it("falls back to fuzzy vendor name when vendorId is missing", () => {
    const r = resolveContractForCOG(
      {
        vendorItemNo: null,
        vendorId: null,
        transactionDate: new Date("2026-04-01"),
        vendorName: "Stryker Corp",
      },
      ctx,
    )
    expect(r.mode).toBe("fuzzyVendorName")
    expect(r.contractId).toBe("c-1")
  })

  it("returns none when nothing matches", () => {
    const r = resolveContractForCOG(
      {
        vendorItemNo: null,
        vendorId: null,
        transactionDate: new Date("2026-04-01"),
        vendorName: "Acme",
      },
      ctx,
    )
    expect(r).toEqual({ contractId: null, mode: "none" })
  })

  it("skips vendorItemNo hit when transaction is outside the effective window", () => {
    const r = resolveContractForCOG(
      {
        vendorItemNo: "STK-1",
        vendorId: "v-stryker",
        transactionDate: new Date("2028-01-01"), // after effectiveEnd
        vendorName: "stryker",
      },
      ctx,
    )
    // All three cascade steps reject on date — resolver returns none.
    expect(r.mode).toBe("none")
    expect(r.contractId).toBeNull()
  })

  it("returns none immediately when transactionDate is missing", () => {
    const r = resolveContractForCOG(
      {
        vendorItemNo: "STK-1",
        vendorId: "v-stryker",
        // Prisma types transactionDate as Date; cast null to model the
        // defensive guard in the resolver.
        transactionDate: null as unknown as Date,
        vendorName: "stryker",
      },
      ctx,
    )
    expect(r).toEqual({ contractId: null, mode: "none" })
  })
})
