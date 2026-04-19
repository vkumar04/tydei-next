import { describe, it, expect } from "vitest"
import { ContractType } from "@prisma/client"
import { getScoreBenchmark } from "@/lib/contracts/score-benchmarks"

describe("getScoreBenchmark", () => {
  it("returns a benchmark for every ContractType enum value", () => {
    for (const t of Object.values(ContractType)) {
      const b = getScoreBenchmark(t)
      expect(b).toBeDefined()
      expect(b.complianceScore).toBeGreaterThanOrEqual(0)
      expect(b.complianceScore).toBeLessThanOrEqual(100)
    }
  })
})
