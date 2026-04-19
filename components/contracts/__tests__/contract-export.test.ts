import { describe, it, expect } from "vitest"
import { buildContractsCSV } from "@/components/contracts/contract-export"

describe("buildContractsCSV", () => {
  it("emits a header row and one row per contract", () => {
    const csv = buildContractsCSV([
      {
        name: "Stryker Spine",
        vendorName: "Stryker",
        contractType: "usage",
        status: "active",
        effectiveDate: "2025-01-01",
        expirationDate: "2027-01-01",
        totalValue: 1_000_000,
        spend: 600_000,
        rebateEarned: 30_000,
      },
    ])
    const lines = csv.split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("Contract Name")
    expect(lines[1]).toContain("Stryker Spine")
    expect(lines[1]).toContain("Stryker")
    expect(lines[1]).toContain("1000000")
  })

  it("quotes fields containing commas, quotes, or newlines", () => {
    const csv = buildContractsCSV([
      {
        name: 'Acme, Corp.',
        vendorName: 'O"Brien',
        contractType: "usage",
        status: "active",
        effectiveDate: "2025-01-01",
        expirationDate: "2027-01-01",
        totalValue: 0,
        spend: 0,
        rebateEarned: 0,
      },
    ])
    const dataLine = csv.split("\n")[1]
    expect(dataLine.startsWith('"Acme, Corp."')).toBe(true)
    expect(dataLine).toContain('"O""Brien"')
  })
})
