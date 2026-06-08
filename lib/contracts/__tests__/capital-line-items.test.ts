import { describe, it, expect } from "vitest"
import { normalizeCapitalLineItems } from "@/lib/contracts/capital-line-items"
import type { ContractCapitalLineItem } from "@/lib/generated/prisma/client"

function mkLineItem(
  overrides: Partial<ContractCapitalLineItem>,
): ContractCapitalLineItem {
  return {
    id: "li-1",
    contractId: "c-1",
    description: "Robot",
    itemNumber: null,
    serialNumber: null,
    contractTotal: 100000 as unknown as ContractCapitalLineItem["contractTotal"],
    initialSales: 0 as unknown as ContractCapitalLineItem["initialSales"],
    interestRate: 0 as unknown as ContractCapitalLineItem["interestRate"],
    termMonths: 60,
    paymentType: "fixed",
    paymentCadence: "monthly",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ContractCapitalLineItem
}

describe("normalizeCapitalLineItems — paymentCadence (2026-06-08)", () => {
  // Bug "monthly amortization schedule going back to monthly again — I
  // selected semi annual": semi_annual was missing from the cadence
  // allow-list, so it silently downgraded to monthly.
  it.each(["monthly", "quarterly", "semi_annual", "annual"] as const)(
    "preserves %s cadence",
    (cadence) => {
      const [item] = normalizeCapitalLineItems({
        id: "c-1",
        name: "Tie-in",
        capitalLineItems: [mkLineItem({ paymentCadence: cadence })],
      })
      expect(item.paymentCadence).toBe(cadence)
    },
  )

  it("falls back to monthly for an unknown/blank cadence", () => {
    for (const raw of [null, undefined, "", "weekly", "biannual"]) {
      const [item] = normalizeCapitalLineItems({
        id: "c-1",
        name: "Tie-in",
        capitalLineItems: [
          mkLineItem({
            paymentCadence: raw as ContractCapitalLineItem["paymentCadence"],
          }),
        ],
      })
      expect(item.paymentCadence).toBe("monthly")
    }
  })
})
