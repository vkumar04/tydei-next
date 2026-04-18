import { describe, it, expect } from "vitest"
import {
  contractExtractionPrompt,
  columnMappingPrompt,
  vendorDedupProposalPrompt,
  itemDedupProposalPrompt,
  divisionInferencePrompt,
  matchStatusExplainerPrompt,
} from "../prompts"

describe("contractExtractionPrompt", () => {
  it("returns a non-empty system + user pair", () => {
    const { system, user } = contractExtractionPrompt("INVOICE 2026 vendor: Medline")
    expect(system.length).toBeGreaterThan(50)
    expect(user.length).toBeGreaterThan(0)
  })

  it("embeds the PDF text in the user half", () => {
    const pdfText = "ACME CORP CONTRACT 2026 effective 2026-01-01"
    const { user } = contractExtractionPrompt(pdfText)
    expect(user).toContain(pdfText)
  })

  it("keeps the system half stable across calls (cache prefix invariant)", () => {
    const a = contractExtractionPrompt("pdf A").system
    const b = contractExtractionPrompt("pdf B").system
    expect(a).toBe(b)
  })

  it("appends hints when supplied", () => {
    const { user } = contractExtractionPrompt("x", { hints: ["spend-rebate contract", "vendor is Medline"] })
    expect(user).toContain("spend-rebate contract")
    expect(user).toContain("Medline")
  })

  it("omits the hint block when no hints provided", () => {
    const { user } = contractExtractionPrompt("x")
    expect(user).not.toContain("Caller hints")
  })
})

describe("columnMappingPrompt", () => {
  it("returns a non-empty system + user pair", () => {
    const { system, user } = columnMappingPrompt(
      ["Vendor Name", "Qty"],
      [
        { key: "vendor", label: "Vendor", required: true },
        { key: "quantity", label: "Quantity", required: false },
      ],
    )
    expect(system.length).toBeGreaterThan(50)
    expect(user.length).toBeGreaterThan(0)
  })

  it("lists every source header in the user prompt", () => {
    const { user } = columnMappingPrompt(
      ["Vendor", "Qty", "Proveedor"],
      [{ key: "vendor", label: "Vendor", required: true }],
    )
    expect(user).toContain("Vendor")
    expect(user).toContain("Qty")
    expect(user).toContain("Proveedor")
  })

  it("marks required fields visibly", () => {
    const { user } = columnMappingPrompt(
      ["x"],
      [
        { key: "a", label: "A", required: true },
        { key: "b", label: "B", required: false },
      ],
    )
    expect(user).toContain("[REQUIRED]")
  })

  it("includes sample rows when provided (first 3 only)", () => {
    const samples = [
      { Vendor: "Medline", Qty: "10" },
      { Vendor: "J&J", Qty: "5" },
      { Vendor: "Stryker", Qty: "2" },
      { Vendor: "SHOULD_NOT_APPEAR", Qty: "99" },
    ]
    const { user } = columnMappingPrompt(
      ["Vendor", "Qty"],
      [{ key: "vendor", label: "Vendor", required: true }],
      samples,
    )
    expect(user).toContain("Medline")
    expect(user).toContain("Stryker")
    expect(user).not.toContain("SHOULD_NOT_APPEAR")
  })

  it("omits sample block when no sample rows are provided", () => {
    const { user } = columnMappingPrompt(
      ["x"],
      [{ key: "a", label: "A", required: true }],
    )
    expect(user).not.toContain("Sample data rows")
  })
})

describe("vendorDedupProposalPrompt", () => {
  it("returns a non-empty system + user pair", () => {
    const { system, user } = vendorDedupProposalPrompt("Medlyne Industries", [
      { id: "v1", name: "Medline Industries" },
    ])
    expect(system.length).toBeGreaterThan(50)
    expect(user).toContain("Medlyne Industries")
    expect(user).toContain("Medline Industries")
  })

  it("embeds the candidate name and existing vendor ids", () => {
    const { user } = vendorDedupProposalPrompt("Johnson & Johnson", [
      { id: "abc", name: "J&J" },
      { id: "def", name: "Stryker" },
    ])
    expect(user).toContain("Johnson & Johnson")
    expect(user).toContain("abc")
    expect(user).toContain("def")
  })

  it("includes aliases when provided", () => {
    const { user } = vendorDedupProposalPrompt("JnJ", [
      { id: "v1", name: "Johnson & Johnson", aliases: ["J&J", "JNJ"] },
    ])
    expect(user).toContain("J&J")
    expect(user).toContain("JNJ")
    expect(user).toContain("aliases")
  })

  it("mentions the 0.6 confidence threshold in the system prompt", () => {
    const { system } = vendorDedupProposalPrompt("x", [])
    expect(system).toContain("0.6")
  })
})

describe("itemDedupProposalPrompt", () => {
  it("returns a non-empty system + user pair", () => {
    const { system, user } = itemDedupProposalPrompt(
      { sku: "ABC-123", description: "Suture 4-0 Vicryl" },
      [{ sku: "ABC-123", description: "Stapler cartridge" }],
    )
    expect(system.length).toBeGreaterThan(50)
    expect(user).toContain("ABC-123")
    expect(user).toContain("Suture 4-0 Vicryl")
    expect(user).toContain("Stapler cartridge")
  })

  it("names the three recommended actions in the system prompt", () => {
    const { system } = itemDedupProposalPrompt(
      { sku: "x", description: "y" },
      [],
    )
    expect(system).toContain("keep_existing")
    expect(system).toContain("replace")
    expect(system).toContain("keep_both")
  })
})

describe("divisionInferencePrompt", () => {
  it("returns a non-empty system + user pair", () => {
    const { system, user } = divisionInferencePrompt(
      "Spinal pedicle screw 4.5mm",
      "Medtronic",
      ["Ortho Spine", "Cardiac", "General Surgery"],
    )
    expect(system.length).toBeGreaterThan(50)
    expect(user).toContain("Spinal pedicle screw 4.5mm")
    expect(user).toContain("Medtronic")
    expect(user).toContain("Ortho Spine")
  })

  it("instructs Claude to allow null output", () => {
    const { system } = divisionInferencePrompt("x", "y", ["A"])
    expect(system.toLowerCase()).toContain("null")
  })
})

describe("matchStatusExplainerPrompt", () => {
  it("returns a non-empty system + user pair", () => {
    const { system, user } = matchStatusExplainerPrompt(
      "PRICE_MISMATCH",
      { name: "Medline 2026 Supplies Agreement" },
    )
    expect(system.length).toBeGreaterThan(50)
    expect(user).toContain("PRICE_MISMATCH")
    expect(user).toContain("Medline 2026 Supplies Agreement")
  })

  it("handles the no-contract case", () => {
    const { user } = matchStatusExplainerPrompt("NO_CONTRACT", null)
    expect(user).toContain("NO_CONTRACT")
    expect(user).toContain("No matching contract")
  })

  it("includes optional reason when provided", () => {
    const { user } = matchStatusExplainerPrompt(
      "PRICE_MISMATCH",
      { name: "X" },
      "unit price diverged by 12%",
    )
    expect(user).toContain("unit price diverged by 12%")
  })

  it("keeps system half stable across different row payloads (cache prefix invariant)", () => {
    const a = matchStatusExplainerPrompt("PRICE_MISMATCH", { name: "A" }).system
    const b = matchStatusExplainerPrompt("NO_CONTRACT", null).system
    expect(a).toBe(b)
  })
})
