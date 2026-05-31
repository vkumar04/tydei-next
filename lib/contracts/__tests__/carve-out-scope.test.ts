import { describe, it, expect } from "vitest"
import { isCarveOutScopeLocked } from "@/lib/contracts/carve-out-scope"

describe("isCarveOutScopeLocked", () => {
  it("locks scope for carve_out terms", () => {
    expect(isCarveOutScopeLocked("carve_out")).toBe(true)
  })

  it("leaves every other term type editable", () => {
    for (const t of [
      "spend_rebate",
      "volume_rebate",
      "market_share",
      "po_rebate",
      "price_reduction",
      "compliance_rebate",
    ]) {
      expect(isCarveOutScopeLocked(t)).toBe(false)
    }
  })

  it("treats null/undefined as not locked", () => {
    expect(isCarveOutScopeLocked(null)).toBe(false)
    expect(isCarveOutScopeLocked(undefined)).toBe(false)
  })
})
