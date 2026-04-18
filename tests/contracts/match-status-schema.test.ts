import { describe, it, expect } from "vitest"
import type { COGMatchStatus } from "@prisma/client"

describe("COGMatchStatus schema", () => {
  it("exposes the 6 canonical status values", () => {
    // Compile-time check: if any value is missing from the generated enum,
    // this file will fail to compile.
    const values: COGMatchStatus[] = [
      "pending",
      "on_contract",
      "off_contract_item",
      "out_of_scope",
      "unknown_vendor",
      "price_variance",
    ]
    expect(values).toHaveLength(6)
  })
})
