import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  checkContractExtractWithJev,
  compareContractSelection,
  findDates,
  findIds,
  findMoney,
  type JevContractSelection,
} from "@/lib/ai/jev-contract-check"
import { fakeContract } from "@/tests/support/ai-route-helpers"

const pick = <T>(value: T, confidence = 0.95, text = String(value), line = `Line with ${text}`) => ({ value, text, line, confidence })

const agreeing: JevContractSelection = {
  vendor: pick("Orthomedix"),
  contractNumber: pick("OMX-2026-0417"),
  contractType: { value: "tie_in", confidence: 0.9 },
  effectiveDate: pick("2026-01-01"),
  expirationDate: pick("2028-12-31"),
  totalValue: pick(1_250_000, 0.95, "$1,250,000"),
  capitalCost: pick(785_195, 0.95, "$785,195"),
}

describe("candidate finders", () => {
  it("finds dates in prose, numeric, and ISO forms", () => {
    const got = findDates(["Effective Date: January 1, 2026", "made the 1st day of July, 2026", "Term: 03/15/2026", "Expires: 2030-04-30"]).map((d) => d.value)
    expect(got).toEqual(["2026-01-01", "2026-07-01", "2026-03-15", "2030-04-30"])
  })

  it("scales million and thousand suffixes", () => {
    const got = findMoney(["value of $3.2 million", "cost $785,195", "fee $12k"]).map((m) => m.value)
    expect(got).toEqual([3_200_000, 785_195, 12_000])
  })

  it("keeps only hyphenated identifiers that contain a digit", () => {
    expect(findIds(["Agreement No. ZB-FR-8812 between X-Y", "Ref. IS-TI-2026-09"]).map((i) => i.value)).toEqual(["ZB-FR-8812", "IS-TI-2026-09"])
  })
})

describe("compareContractSelection", () => {
  it("returns nothing when the extraction agrees with the document", () => {
    expect(compareContractSelection(fakeContract({ vendorName: "Orthomedix Surgical" }), agreeing)).toEqual([])
  })

  it("flags a different date, a blank contract number, and a different type", () => {
    const extracted = fakeContract({ effectiveDate: "2026-03-01", contractNumber: undefined, contractType: "usage" })
    const warnings = compareContractSelection(extracted, agreeing)
    expect(warnings.map((w) => w.path[0])).toEqual(["contractNumber", "contractType", "effectiveDate"])
    expect(warnings[0]!.message).toContain('"OMX-2026-0417"')
    expect(warnings[2]!.message).toContain("2026-01-01")
    expect(warnings.every((w) => w.severity === "warning")).toBe(true)
  })

  it("flags an end date the document does not state as a possible evergreen term", () => {
    const warnings = compareContractSelection(fakeContract(), { ...agreeing, expirationDate: { value: null, confidence: 0.9 } })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.message).toMatch(/evergreen/)
  })

  it("ignores low-confidence disagreements and a sub-$0.50 money difference", () => {
    const extracted = fakeContract({ effectiveDate: "2026-03-01", totalValue: 1_250_000.25 })
    const warnings = compareContractSelection(extracted, { ...agreeing, effectiveDate: pick("2026-01-01", 0.4) })
    expect(warnings).toEqual([])
  })
})

describe("checkContractExtractWithJev", () => {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("does nothing without TYPESAFE_API_KEY", async () => {
    expect(await checkContractExtractWithJev({ extracted: fakeContract(), text: "x", logPrefix: "[t]" })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("asks Jev to pick each field from candidates found in the text and reports disagreements", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "k")
    const text = ["Vendor: Orthomedix Surgical", "Contract Number: OMX-2026-0417", "Effective Date: March 1, 2026", "Expiration Date: December 31, 2028"].join("\n")
    fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { questions: Record<string, { criteria: Record<string, string> }> }
      const find = (q: string, needle: string) => Object.entries(body.questions[q]!.criteria).find(([, d]) => d.startsWith(`"${needle}"`))![0]
      return Response.json({
        answers: {
          vendor: { choice: find("vendor", "Orthomedix Surgical"), confidence: 0.9 },
          contractNumber: { choice: find("contractNumber", "OMX-2026-0417"), confidence: 0.95 },
          contractType: { choice: "tie_in", confidence: 0.8 },
          effectiveDate: { choice: find("effectiveDate", "March 1, 2026"), confidence: 0.92 },
          expirationDate: { choice: find("expirationDate", "December 31, 2028"), confidence: 0.92 },
          totalValue: { choice: "none", confidence: 0.6 },
          capitalCost: { choice: "none", confidence: 0.6 },
        },
      })
    })
    const warnings = await checkContractExtractWithJev({ extracted: fakeContract(), text, logPrefix: "[t]" })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ path: ["effectiveDate"] })
    expect(warnings[0]!.message).toContain("2026-03-01")
    expect(warnings[0]!.message).toContain("Effective Date: March 1, 2026")
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("authorization")).toBe("Bearer k")
  })

  it("swallows API failures and returns no warnings", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "k")
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }))
    expect(await checkContractExtractWithJev({ extracted: fakeContract(), text: "Vendor: X", logPrefix: "[t]" })).toEqual([])
    expect(console.warn).toHaveBeenCalled()
  })
})
