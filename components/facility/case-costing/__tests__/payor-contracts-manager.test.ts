/**
 * Pure-logic tests for the PayorContractsManager helpers (repo
 * convention: component logic is tested as exported pure functions —
 * vitest runs in a node environment, so there is no render testing).
 * The manual-rate parser feeds both the "New Contract" save path and
 * the "Add to Existing" import path.
 */
import { describe, it, expect } from "vitest"
import { parseCPTRatesFromText } from "@/components/facility/case-costing/payor-contracts-manager"

describe("parseCPTRatesFromText", () => {
  it("parses comma-separated code, description, rate lines", () => {
    expect(parseCPTRatesFromText("99213, Office Visit, 150.00")).toEqual([
      { cptCode: "99213", description: "Office Visit", rate: 150 },
    ])
  })

  it("parses pipe-separated lines and dollar-prefixed rates", () => {
    expect(parseCPTRatesFromText("27447 | Total Knee | $15,000.00")).toEqual([
      { cptCode: "27447", description: "Total Knee", rate: 15000 },
    ])
  })

  it("parses code-plus-rate lines with no description", () => {
    expect(parseCPTRatesFromText("99214 $200.50")).toEqual([
      { cptCode: "99214", description: "", rate: 200.5 },
    ])
  })

  it("parses multiple lines and skips blanks and junk", () => {
    const text = [
      "99213, Office Visit, 150.00",
      "",
      "not a rate line",
      "27447 | Total Knee | 15000",
    ].join("\n")
    const rates = parseCPTRatesFromText(text)
    expect(rates).toHaveLength(2)
    expect(rates.map((r) => r.cptCode)).toEqual(["99213", "27447"])
  })

  it("returns empty for empty input", () => {
    expect(parseCPTRatesFromText("")).toEqual([])
  })
})
