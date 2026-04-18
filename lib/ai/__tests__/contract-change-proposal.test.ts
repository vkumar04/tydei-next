import { describe, it, expect } from "vitest"
import type { Prisma } from "@prisma/client"
import {
  buildContractChangeProposal,
  serializeProposalForUi,
  isAiContractChangePayload,
  type ContractChangeProposalInput,
} from "../contract-change-proposal"

// Prisma's Json columns are modeled as `InputJsonValue` on write and
// `JsonValue` on read. `buildContractChangeProposal` emits the former;
// `serializeProposalForUi` consumes the latter. Tests bridge the two by
// round-tripping through JSON (mirrors what Prisma does at the DB layer).
const asJsonValue = (v: unknown): Prisma.JsonValue =>
  JSON.parse(JSON.stringify(v)) as Prisma.JsonValue

const baseInput: ContractChangeProposalInput = {
  contractId: "contract_abc",
  kind: "pricing",
  reasoning: "Unit price dropped from $12.50 to $11.80 per tier-2 threshold hit.",
  confidence: 0.82,
  beforeSnapshot: { unitPrice: 12.5 },
  afterSnapshot: { unitPrice: 11.8 },
}

describe("buildContractChangeProposal", () => {
  it("passes through required fields verbatim", () => {
    const result = buildContractChangeProposal(baseInput)
    expect(result.contractId).toBe("contract_abc")
    expect(result.status).toBe("pending")
    expect(result.proposalType).toBe("contract_edit")
    expect(result.vendorMessage).toBe(baseInput.reasoning)
  })

  it("embeds the semantic payload in the changes JSON with discriminator", () => {
    const result = buildContractChangeProposal(baseInput)
    const changes = result.changes as Record<string, unknown>
    expect(changes.source).toBe("ai_advisor")
    expect(changes.kind).toBe("pricing")
    expect(changes.reasoning).toBe(baseInput.reasoning)
    expect(changes.beforeSnapshot).toEqual({ unitPrice: 12.5 })
    expect(changes.afterSnapshot).toEqual({ unitPrice: 11.8 })
  })

  describe("confidence clamp", () => {
    it("passes through in-range values", () => {
      const r = buildContractChangeProposal({ ...baseInput, confidence: 0.5 })
      expect((r.changes as Record<string, unknown>).confidence).toBe(0.5)
    })

    it("clamps > 1 down to 1", () => {
      const r = buildContractChangeProposal({ ...baseInput, confidence: 2 })
      expect((r.changes as Record<string, unknown>).confidence).toBe(1)
    })

    it("clamps < 0 up to 0", () => {
      const r = buildContractChangeProposal({ ...baseInput, confidence: -5 })
      expect((r.changes as Record<string, unknown>).confidence).toBe(0)
    })

    it("coerces NaN to 0", () => {
      const r = buildContractChangeProposal({ ...baseInput, confidence: Number.NaN })
      expect((r.changes as Record<string, unknown>).confidence).toBe(0)
    })

    it("coerces Infinity to 1", () => {
      const r = buildContractChangeProposal({ ...baseInput, confidence: Number.POSITIVE_INFINITY })
      expect((r.changes as Record<string, unknown>).confidence).toBe(1)
    })
  })

  it("accepts every semantic kind", () => {
    const kinds: ContractChangeProposalInput["kind"][] = [
      "pricing",
      "term_addition",
      "term_modification",
      "status_change",
      "facility_scope",
      "other",
    ]
    for (const kind of kinds) {
      const r = buildContractChangeProposal({ ...baseInput, kind })
      expect((r.changes as Record<string, unknown>).kind).toBe(kind)
    }
  })
})

describe("isAiContractChangePayload", () => {
  it("returns true for a well-formed AI payload", () => {
    const result = buildContractChangeProposal(baseInput)
    expect(isAiContractChangePayload(result.changes)).toBe(true)
  })

  it("returns false for a vendor-authored shape (no source field)", () => {
    expect(isAiContractChangePayload({ someVendorKey: "value" })).toBe(false)
  })

  it("returns false for null / primitives", () => {
    expect(isAiContractChangePayload(null)).toBe(false)
    expect(isAiContractChangePayload(undefined)).toBe(false)
    expect(isAiContractChangePayload("string")).toBe(false)
    expect(isAiContractChangePayload(42)).toBe(false)
  })
})

describe("serializeProposalForUi", () => {
  it("converts a Prisma row into AiAdvisoryProposal shape", () => {
    const created = buildContractChangeProposal(baseInput)
    const submittedAt = new Date("2026-04-18T12:00:00Z")
    const row = {
      id: "proposal_xyz",
      changes: asJsonValue(created.changes),
      submittedAt,
      vendorMessage: baseInput.reasoning,
    }
    const ui = serializeProposalForUi(row)
    expect(ui.id).toBe("proposal_xyz")
    expect(ui.kind).toBe("contract_change")
    expect(ui.title).toBe("Pricing change")
    expect(ui.reasoning).toBe(baseInput.reasoning)
    expect(ui.confidence).toBe(0.82)
    expect(ui.generatedAt).toBe(submittedAt)
    expect(ui.suggestion).toEqual({
      before: { unitPrice: 12.5 },
      after: { unitPrice: 11.8 },
    })
  })

  it("produces distinct titles per kind", () => {
    const mk = (kind: ContractChangeProposalInput["kind"]) => {
      const created = buildContractChangeProposal({ ...baseInput, kind })
      return serializeProposalForUi({
        id: "p",
        changes: asJsonValue(created.changes),
        submittedAt: new Date(),
        vendorMessage: null,
      }).title
    }
    expect(mk("pricing")).toBe("Pricing change")
    expect(mk("term_addition")).toBe("New term added")
    expect(mk("term_modification")).toBe("Term modification")
    expect(mk("status_change")).toBe("Contract status change")
    expect(mk("facility_scope")).toBe("Facility scope change")
    expect(mk("other")).toBe("Contract change")
  })

  it("throws when the row's changes JSON is not AI-authored", () => {
    expect(() =>
      serializeProposalForUi({
        id: "p_vendor",
        changes: { vendorSubmitted: true },
        submittedAt: new Date(),
        vendorMessage: null,
      }),
    ).toThrow(/not an AI-authored proposal/)
  })
})
