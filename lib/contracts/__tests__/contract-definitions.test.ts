import { describe, it, expect } from "vitest"
import { ContractType, RebateType, TermType } from "@prisma/client"
import {
  CONTRACT_TYPE_DEFINITIONS,
  REBATE_TYPE_DEFINITIONS,
  TERM_TYPE_DEFINITIONS,
} from "@/lib/contract-definitions"

describe("contract definitions coverage", () => {
  it("has a definition for every ContractType enum value", () => {
    for (const v of Object.values(ContractType)) {
      expect(CONTRACT_TYPE_DEFINITIONS[v]).toBeDefined()
      expect(CONTRACT_TYPE_DEFINITIONS[v].label.length).toBeGreaterThan(0)
    }
  })

  it("has a definition for every TermType enum value", () => {
    for (const v of Object.values(TermType)) {
      expect(TERM_TYPE_DEFINITIONS[v]).toBeDefined()
      expect(TERM_TYPE_DEFINITIONS[v].label.length).toBeGreaterThan(0)
    }
  })

  it("has a definition for every RebateType enum value", () => {
    for (const v of Object.values(RebateType)) {
      expect(REBATE_TYPE_DEFINITIONS[v]).toBeDefined()
      expect(REBATE_TYPE_DEFINITIONS[v].label.length).toBeGreaterThan(0)
    }
  })
})
