import { describe, expect, it } from "vitest"
import { toRichExtractedContract } from "@/lib/ai/contract-extract-mapper"

describe("toRichExtractedContract", () => {
  it("lifts the flat contract number and total value", () => {
    const rich = toRichExtractedContract({
      contractName: "Ortho",
      contractNumber: "OMX-2026-0417",
      totalValue: 1_250_000,
      capitalCost: 785_195,
    })
    expect(rich.contractId).toBe("OMX-2026-0417")
    expect(rich.totalValue).toBe(1_250_000)
    expect(rich.tieInDetails?.capitalEquipmentValue).toBe(785_195)
  })

  it("keeps a rich contractId when present", () => {
    const rich = toRichExtractedContract({ contractId: "R-1", contractNumber: "F-1" })
    expect(rich.contractId).toBe("R-1")
    expect(rich.totalValue).toBeNull()
  })
})
