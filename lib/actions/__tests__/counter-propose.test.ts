/**
 * Tests for counterContractChangeProposal — facility-side counter-proposal
 * action that backs the W1.7 Counter-Propose dialog.
 *
 * Asserts facility ownership scoping, status → "countered", notes
 * persistence, min-length guard, non-pending refusal, and audit emission.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface ProposalRow {
  id: string
  contractId: string
  status: string
  reviewNotes: string | null
  reviewedAt: Date | null
  reviewedBy: string | null
  contract: { facilityId: string }
}

let proposalRows: ProposalRow[] = []
let lastUpdate: { where: unknown; data: Record<string, unknown> } | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    contractChangeProposal: {
      findUniqueOrThrow: vi.fn(
        async ({ where }: { where: { id: string } }) => {
          const row = proposalRows.find((p) => p.id === where.id)
          if (!row) throw new Error("not found")
          return row
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Record<string, unknown>
        }) => {
          lastUpdate = { where, data }
          const idx = proposalRows.findIndex((p) => p.id === where.id)
          if (idx < 0) throw new Error("not found")
          proposalRows[idx] = {
            ...proposalRows[idx],
            ...(data as Partial<ProposalRow>),
          }
          return proposalRows[idx]
        },
      ),
    },
  },
}))

const requireFacilityMock = vi.fn(async () => ({
  facility: { id: "fac-1", name: "Tydei General" },
  user: { id: "user-facility" },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: () => requireFacilityMock(),
}))

const logAuditMock = vi.fn(async (_args: Record<string, unknown>) => {})
vi.mock("@/lib/audit", () => ({
  logAudit: (args: Record<string, unknown>) => logAuditMock(args),
}))

// serialize is transparent for our payloads; mock as identity to avoid
// pulling Prisma types at test time.
vi.mock("@/lib/serialize", () => ({
  serialize: <T>(v: T) => v,
}))

import { counterContractChangeProposal } from "@/lib/actions/contracts/proposals"

function seedProposal(overrides: Partial<ProposalRow> = {}): ProposalRow {
  const row: ProposalRow = {
    id: "prop-1",
    contractId: "c-1",
    status: "pending",
    reviewNotes: null,
    reviewedAt: null,
    reviewedBy: null,
    contract: { facilityId: "fac-1" },
    ...overrides,
  }
  proposalRows.push(row)
  return row
}

beforeEach(() => {
  vi.clearAllMocks()
  proposalRows = []
  lastUpdate = null
})

describe("counterContractChangeProposal", () => {
  it("flips a pending proposal to 'countered' with notes + reviewer", async () => {
    seedProposal()

    await counterContractChangeProposal(
      "prop-1",
      "We propose a 2-year term at 3% rebate instead.",
    )

    expect(lastUpdate?.where).toEqual({ id: "prop-1" })
    expect(lastUpdate?.data.status).toBe("countered")
    expect(lastUpdate?.data.reviewNotes).toBe(
      "We propose a 2-year term at 3% rebate instead.",
    )
    expect(lastUpdate?.data.reviewedBy).toBe("user-facility")
    expect(lastUpdate?.data.reviewedAt).toBeInstanceOf(Date)

    // Persisted row reflects the new status.
    expect(proposalRows[0].status).toBe("countered")

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "contract_change_proposal.countered",
        entityType: "contract_change_proposal",
        entityId: "prop-1",
      }),
    )
  })

  it("rejects a proposal owned by a different facility", async () => {
    seedProposal({ contract: { facilityId: "fac-other" } })

    await expect(
      counterContractChangeProposal(
        "prop-1",
        "Counter-terms that are long enough",
      ),
    ).rejects.toThrow(/forbidden/i)

    expect(lastUpdate).toBeNull()
  })

  it("rejects a non-pending proposal", async () => {
    seedProposal({ status: "approved" })

    await expect(
      counterContractChangeProposal(
        "prop-1",
        "Counter-terms that are long enough",
      ),
    ).rejects.toThrow(/cannot counter-propose/i)

    expect(lastUpdate).toBeNull()
  })

  it("enforces a minimum 10-char note", async () => {
    seedProposal()

    await expect(
      counterContractChangeProposal("prop-1", "too short"),
    ).rejects.toThrow(/min 10/i)

    expect(lastUpdate).toBeNull()
  })
})
