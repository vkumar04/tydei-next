/**
 * Tests for listRenewalNotes / createRenewalNote / deleteRenewalNote —
 * facility-side renewal note actions (renewals-rewrite spec §4.2).
 *
 * Exercises ownership scoping via contractOwnershipWhere, note
 * validation, author-only delete guard, audit emission, and sort.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface ContractRow {
  id: string
}
interface NoteRow {
  id: string
  contractId: string
  note: string
  authorId: string
  createdAt: Date
}

let contractRows: ContractRow[] = []
let noteRows: NoteRow[] = []
let lastCreateData: Record<string, unknown> | null = null
let lastDeleteWhere: Record<string, unknown> | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(
        async ({ where }: { where: { id: string; OR?: unknown } }) => {
          // Caller passes contractOwnershipWhere(id, facilityId) which
          // includes an `id` key — we just filter by id for test.
          return contractRows.find((c) => c.id === where.id) ?? null
        },
      ),
    },
    renewalNote: {
      findMany: vi.fn(
        async ({ where }: { where: { contractId: string } }) =>
          noteRows.filter((n) => n.contractId === where.contractId),
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          noteRows.find((n) => n.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        lastCreateData = data
        // Mirror the DB NOT NULL constraint — reject null authorId.
        if (typeof data.authorId !== "string" || data.authorId.length === 0) {
          throw new Error(
            "null value in column \"authorId\" violates not-null constraint",
          )
        }
        const row: NoteRow = {
          id: "note-new",
          contractId: data.contractId as string,
          note: data.note as string,
          authorId: data.authorId,
          createdAt: new Date("2026-04-18T12:00:00Z"),
        }
        noteRows.push(row)
        return row
      }),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        lastDeleteWhere = where
        noteRows = noteRows.filter((n) => n.id !== where.id)
        return { id: where.id }
      }),
    },
  },
}))

const requireFacilityMock = vi.fn(async () => ({
  facility: { id: "fac-1" },
  user: { id: "user-1" },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: () => requireFacilityMock(),
}))

const logAuditMock = vi.fn(async (_args: Record<string, unknown>) => {})
vi.mock("@/lib/audit", () => ({
  logAudit: (args: Record<string, unknown>) => logAuditMock(args),
}))

import {
  listRenewalNotes,
  createRenewalNote,
  deleteRenewalNote,
} from "@/lib/actions/renewals/notes"

beforeEach(() => {
  vi.clearAllMocks()
  contractRows = []
  noteRows = []
  lastCreateData = null
  lastDeleteWhere = null
  requireFacilityMock.mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  })
})

describe("listRenewalNotes", () => {
  it("returns [] when the facility doesn't own the contract", async () => {
    contractRows = [] // ownership check yields null
    noteRows = [
      {
        id: "n-1",
        contractId: "c-1",
        note: "test",
        authorId: "user-1",
        createdAt: new Date(),
      },
    ]

    const result = await listRenewalNotes("c-1")
    expect(result).toEqual([])
  })

  it("returns notes sorted newest-first", async () => {
    contractRows = [{ id: "c-1" }]
    noteRows = [
      {
        id: "n-old",
        contractId: "c-1",
        note: "old",
        authorId: "user-1",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "n-new",
        contractId: "c-1",
        note: "new",
        authorId: "user-1",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      },
    ]

    const result = await listRenewalNotes("c-1")
    expect(result.map((n) => n.id)).toEqual(["n-new", "n-old"])
  })
})

describe("createRenewalNote", () => {
  it("creates with authorId = session user and logs audit", async () => {
    contractRows = [{ id: "c-1" }]

    const result = await createRenewalNote({
      contractId: "c-1",
      note: "Need to negotiate tier 2",
    })

    expect(lastCreateData?.authorId).toBe("user-1")
    expect(lastCreateData?.contractId).toBe("c-1")
    expect(lastCreateData?.note).toBe("Need to negotiate tier 2")
    expect(result.id).toBe("note-new")

    expect(logAuditMock).toHaveBeenCalledTimes(1)
    const firstCall = logAuditMock.mock.calls[0] as unknown as [
      {
        userId: string
        action: string
        entityType: string
        entityId: string
        metadata: { contractId: string; noteLength: number }
      },
    ]
    const audit = firstCall[0]
    expect(audit.action).toBe("renewal.note_created")
    expect(audit.entityType).toBe("renewal_note")
    expect(audit.metadata.noteLength).toBe("Need to negotiate tier 2".length)
  })

  it("throws when contract is not owned by facility", async () => {
    contractRows = [] // no ownership

    await expect(
      createRenewalNote({ contractId: "c-other", note: "hi there" }),
    ).rejects.toThrow(/contract not found/i)
    expect(logAuditMock).not.toHaveBeenCalled()
  })

  it("throws when note is empty (validation)", async () => {
    contractRows = [{ id: "c-1" }]

    await expect(
      createRenewalNote({ contractId: "c-1", note: "   " }),
    ).rejects.toThrow(/cannot be empty/i)
  })

  it("trims whitespace from note before persisting", async () => {
    contractRows = [{ id: "c-1" }]

    await createRenewalNote({
      contractId: "c-1",
      note: "  trimmed note  ",
    })

    expect(lastCreateData?.note).toBe("trimmed note")
  })

  it("always persists authorId (never null) — mirrors DB NOT NULL", async () => {
    contractRows = [{ id: "c-1" }]

    await createRenewalNote({
      contractId: "c-1",
      note: "hi",
    })

    // authorId must be a non-empty string, matching the NOT NULL column.
    expect(typeof lastCreateData?.authorId).toBe("string")
    expect((lastCreateData?.authorId as string).length).toBeGreaterThan(0)
    expect(lastCreateData?.authorId).toBe("user-1")
  })

  it("rejects create when session has no user id (null authorId)", async () => {
    contractRows = [{ id: "c-1" }]
    // Simulate a session that somehow has an empty user id. The DB
    // NOT NULL constraint (mirrored in the prisma mock) must reject.
    requireFacilityMock.mockResolvedValueOnce({
      facility: { id: "fac-1" },
      user: { id: "" },
    })

    await expect(
      createRenewalNote({ contractId: "c-1", note: "hi" }),
    ).rejects.toThrow(/not-null/i)
  })
})

describe("deleteRenewalNote", () => {
  it("deletes when the caller is the author", async () => {
    contractRows = [{ id: "c-1" }]
    noteRows = [
      {
        id: "n-1",
        contractId: "c-1",
        note: "mine",
        authorId: "user-1",
        createdAt: new Date(),
      },
    ]

    await deleteRenewalNote("n-1")

    expect(lastDeleteWhere).toEqual({ id: "n-1" })
    expect(logAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "renewal.note_deleted" }),
    )
  })

  it("throws when the caller is not the author", async () => {
    contractRows = [{ id: "c-1" }]
    noteRows = [
      {
        id: "n-1",
        contractId: "c-1",
        note: "not yours",
        authorId: "user-other",
        createdAt: new Date(),
      },
    ]

    await expect(deleteRenewalNote("n-1")).rejects.toThrow(/author/i)
    expect(lastDeleteWhere).toBeNull()
  })

  it("throws when the note's contract isn't owned by the facility", async () => {
    contractRows = [] // ownership check fails
    noteRows = [
      {
        id: "n-1",
        contractId: "c-other",
        note: "hidden",
        authorId: "user-1",
        createdAt: new Date(),
      },
    ]

    await expect(deleteRenewalNote("n-1")).rejects.toThrow(/not found/i)
    expect(lastDeleteWhere).toBeNull()
  })

  it("throws when the note doesn't exist", async () => {
    await expect(deleteRenewalNote("missing")).rejects.toThrow(/not found/i)
  })
})
