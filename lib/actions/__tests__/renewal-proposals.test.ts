/**
 * Tests for submitRenewalProposal / reviewRenewalProposal —
 * renewal proposal actions (renewals-rewrite spec §4.2).
 *
 * Exercises vendor ownership scoping, validation delegation, Prisma
 * enum mapping (renewal → contract_edit, submitted → pending,
 * countered → revision_requested), and audit emission.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface ContractRow {
  id: string
  vendorId: string
  facilityId: string | null
  effectiveDate: Date
  expirationDate: Date
  facility: { name: string } | null
}

interface ProposalRow {
  id: string
  contractId: string
  vendorId: string
  vendorName: string
  facilityId: string | null
  facilityName: string | null
  proposalType: string
  status: string
  changes: unknown
  proposedTerms: unknown
  vendorMessage: string | null
  submittedAt: Date
  reviewedAt: Date | null
  reviewedBy: string | null
  reviewNotes: string | null
}

let contractRows: ContractRow[] = []
let proposalRows: ProposalRow[] = []
let lastCreate: Record<string, unknown> | null = null
let lastUpdate: { where: unknown; data: Record<string, unknown> } | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { id: string; vendorId?: string }
        }) => {
          const row = contractRows.find(
            (c) =>
              c.id === where.id &&
              (!where.vendorId || c.vendorId === where.vendorId),
          )
          return row ?? null
        },
      ),
    },
    contractChangeProposal: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        lastCreate = data
        const row: ProposalRow = {
          id: "prop-new",
          contractId: data.contractId as string,
          vendorId: data.vendorId as string,
          vendorName: data.vendorName as string,
          facilityId: (data.facilityId as string | null) ?? null,
          facilityName: (data.facilityName as string | null) ?? null,
          proposalType: data.proposalType as string,
          status: data.status as string,
          changes: data.changes,
          proposedTerms: data.proposedTerms,
          vendorMessage: (data.vendorMessage as string | null) ?? null,
          submittedAt: new Date("2026-04-18T00:00:00Z"),
          reviewedAt: null,
          reviewedBy: null,
          reviewNotes: null,
        }
        proposalRows.push(row)
        return row
      }),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { id: string; facilityId?: string | null }
        }) => {
          const row = proposalRows.find(
            (p) =>
              p.id === where.id &&
              (where.facilityId === undefined ||
                p.facilityId === where.facilityId),
          )
          return row ?? null
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
          const row = proposalRows.find((p) => p.id === where.id)
          if (!row) throw new Error("not found")
          const next: ProposalRow = {
            ...row,
            ...(data as Partial<ProposalRow>),
          }
          const idx = proposalRows.findIndex((p) => p.id === where.id)
          proposalRows[idx] = next
          return next
        },
      ),
    },
  },
}))

const requireVendorMock = vi.fn(async () => ({
  vendor: { id: "vendor-1", name: "Acme Supply" },
  user: { id: "user-vendor" },
}))
const requireFacilityMock = vi.fn(async () => ({
  facility: { id: "fac-1", name: "Tydei General" },
  user: { id: "user-facility" },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireVendor: () => requireVendorMock(),
  requireFacility: () => requireFacilityMock(),
}))

const logAuditMock = vi.fn(async (_args: Record<string, unknown>) => {})
vi.mock("@/lib/audit", () => ({
  logAudit: (args: Record<string, unknown>) => logAuditMock(args),
}))

import {
  submitRenewalProposal,
  reviewRenewalProposal,
} from "@/lib/actions/renewals/proposals"

beforeEach(() => {
  vi.clearAllMocks()
  contractRows = []
  proposalRows = []
  lastCreate = null
  lastUpdate = null
})

function seedContract(overrides: Partial<ContractRow> = {}): ContractRow {
  const row: ContractRow = {
    id: "c-1",
    vendorId: "vendor-1",
    facilityId: "fac-1",
    effectiveDate: new Date("2025-01-01T00:00:00Z"),
    expirationDate: new Date("2026-01-01T00:00:00Z"),
    facility: { name: "Tydei General" },
    ...overrides,
  }
  contractRows.push(row)
  return row
}

function seedProposal(overrides: Partial<ProposalRow> = {}): ProposalRow {
  const row: ProposalRow = {
    id: "prop-1",
    contractId: "c-1",
    vendorId: "vendor-1",
    vendorName: "Acme Supply",
    facilityId: "fac-1",
    facilityName: "Tydei General",
    proposalType: "contract_edit",
    status: "pending",
    changes: {},
    proposedTerms: {},
    vendorMessage: null,
    submittedAt: new Date("2026-04-18T00:00:00Z"),
    reviewedAt: null,
    reviewedBy: null,
    reviewNotes: null,
    ...overrides,
  }
  proposalRows.push(row)
  return row
}

describe("submitRenewalProposal", () => {
  it("maps renewal → contract_edit + submitted → pending and persists snapshots", async () => {
    seedContract()

    await submitRenewalProposal({
      contractId: "c-1",
      proposedTerms: {
        effectiveDate: "2026-06-01",
        expirationDate: "2027-06-01",
        priceChangePercent: -5,
      },
      notes: "Proposing renewal with 5% price reduction",
    })

    expect(lastCreate?.proposalType).toBe("contract_edit")
    expect(lastCreate?.status).toBe("pending")
    expect(lastCreate?.vendorId).toBe("vendor-1")
    expect(lastCreate?.vendorName).toBe("Acme Supply")
    expect(lastCreate?.facilityId).toBe("fac-1")
    expect(lastCreate?.facilityName).toBe("Tydei General")

    const changes = lastCreate?.changes as Record<string, unknown>
    expect(changes.source).toBe("renewal_proposal")
    expect(changes.kind).toBe("renewal")
    expect(changes.notes).toBe("Proposing renewal with 5% price reduction")

    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "renewal.proposal_submitted" }),
    )
  })

  it("throws when vendor doesn't own the contract", async () => {
    seedContract({ vendorId: "vendor-other" })

    await expect(
      submitRenewalProposal({
        contractId: "c-1",
        proposedTerms: {
          effectiveDate: "2026-06-01",
          expirationDate: "2027-06-01",
        },
        notes: "x",
      }),
    ).rejects.toThrow(/not found/i)

    expect(lastCreate).toBeNull()
  })

  it("throws when proposed terms are invalid (expiration ≤ effective)", async () => {
    seedContract()

    await expect(
      submitRenewalProposal({
        contractId: "c-1",
        proposedTerms: {
          effectiveDate: "2026-06-01",
          expirationDate: "2026-06-01", // equal → invalid
        },
        notes: "bad dates",
      }),
    ).rejects.toThrow(/strictly after/i)
  })

  it("throws when priceChangePercent is out of range", async () => {
    seedContract()

    await expect(
      submitRenewalProposal({
        contractId: "c-1",
        proposedTerms: {
          effectiveDate: "2026-06-01",
          expirationDate: "2027-06-01",
          priceChangePercent: 200,
        },
        notes: "absurd",
      }),
    ).rejects.toThrow(/out of range/i)
  })
})

describe("reviewRenewalProposal", () => {
  it("approves → status 'approved' + reviewedBy + audit", async () => {
    seedProposal()

    await reviewRenewalProposal({
      proposalId: "prop-1",
      decision: "approved",
    })

    expect(lastUpdate?.data.status).toBe("approved")
    expect(lastUpdate?.data.reviewedBy).toBe("user-facility")
    expect(lastUpdate?.data.reviewedAt).toBeInstanceOf(Date)
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "renewal.proposal_reviewed" }),
    )
  })

  it("maps 'countered' → Prisma 'revision_requested' and persists note", async () => {
    seedProposal()

    await reviewRenewalProposal({
      proposalId: "prop-1",
      decision: "countered",
      note: "Please lower the expiration by six months",
    })

    expect(lastUpdate?.data.status).toBe("revision_requested")
    expect(lastUpdate?.data.reviewNotes).toBe(
      "Please lower the expiration by six months",
    )
  })

  it("throws when 'rejected' without a ≥10-char note", async () => {
    seedProposal()

    await expect(
      reviewRenewalProposal({
        proposalId: "prop-1",
        decision: "rejected",
        note: "nope",
      }),
    ).rejects.toThrow(/note/i)

    expect(lastUpdate).toBeNull()
  })

  it("throws when the proposal isn't owned by the facility", async () => {
    seedProposal({ facilityId: "fac-other" })

    await expect(
      reviewRenewalProposal({
        proposalId: "prop-1",
        decision: "approved",
      }),
    ).rejects.toThrow(/not found/i)
  })
})
