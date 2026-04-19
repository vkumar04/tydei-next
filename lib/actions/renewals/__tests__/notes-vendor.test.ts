/**
 * Tests for `listRenewalNotesForVendor` — vendor-gated READ of
 * RenewalNote rows for contracts the vendor owns (W1.8).
 *
 * Covers:
 *   - Ownership guard: contract belongs to another vendor → []
 *   - Happy path: returns notes with `authorName` derived from the
 *     `author` relation, newest-first
 *   - Empty contract: returns []
 *   - Author with null name: `authorName` is null (UI uses fallback)
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface ContractRow {
  id: string
  vendorId: string
}
interface NoteRow {
  id: string
  contractId: string
  note: string
  authorId: string
  createdAt: Date
  author: { name: string | null } | null
}

let contractRows: ContractRow[] = []
let noteRows: NoteRow[] = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { id: string; vendorId?: string }
        }) =>
          contractRows.find(
            (c) =>
              c.id === where.id &&
              (where.vendorId === undefined || c.vendorId === where.vendorId),
          ) ?? null,
      ),
    },
    renewalNote: {
      findMany: vi.fn(
        async ({ where }: { where: { contractId: string } }) =>
          noteRows.filter((n) => n.contractId === where.contractId),
      ),
    },
  },
}))

const requireVendorMock = vi.fn(async () => ({
  vendor: { id: "ven-1" },
  user: { id: "user-v1" },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(),
  requireVendor: () => requireVendorMock(),
}))

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(async () => {}),
}))

// `serialize` on the boundary — in unit tests we bypass it to keep
// Date objects round-trippable via the action's re-hydration step.
vi.mock("@/lib/serialize", () => ({
  serialize: (v: unknown) => v,
}))

import { listRenewalNotesForVendor } from "@/lib/actions/renewals/notes"

beforeEach(() => {
  vi.clearAllMocks()
  contractRows = []
  noteRows = []
  requireVendorMock.mockResolvedValue({
    vendor: { id: "ven-1" },
    user: { id: "user-v1" },
  })
})

describe("listRenewalNotesForVendor", () => {
  it("returns [] when the vendor does not own the contract", async () => {
    contractRows = [{ id: "c-1", vendorId: "ven-OTHER" }]
    noteRows = [
      {
        id: "n-1",
        contractId: "c-1",
        note: "hidden",
        authorId: "u-1",
        createdAt: new Date("2026-04-01"),
        author: { name: "Alice" },
      },
    ]
    const result = await listRenewalNotesForVendor("c-1")
    expect(result).toEqual([])
  })

  it("returns [] when the contract does not exist", async () => {
    const result = await listRenewalNotesForVendor("c-missing")
    expect(result).toEqual([])
  })

  it("returns [] when the contract is owned but has no notes", async () => {
    contractRows = [{ id: "c-1", vendorId: "ven-1" }]
    const result = await listRenewalNotesForVendor("c-1")
    expect(result).toEqual([])
  })

  it("returns notes newest-first with authorName from the author relation", async () => {
    contractRows = [{ id: "c-1", vendorId: "ven-1" }]
    noteRows = [
      {
        id: "n-old",
        contractId: "c-1",
        note: "older",
        authorId: "u-1",
        createdAt: new Date("2026-04-01T00:00:00Z"),
        author: { name: "Alice Andrews" },
      },
      {
        id: "n-new",
        contractId: "c-1",
        note: "newer",
        authorId: "u-2",
        createdAt: new Date("2026-04-10T00:00:00Z"),
        author: { name: "Bob" },
      },
    ]
    const result = await listRenewalNotesForVendor("c-1")
    expect(result).toHaveLength(2)
    expect(result[0].id).toBe("n-new")
    expect(result[0].authorName).toBe("Bob")
    expect(result[1].id).toBe("n-old")
    expect(result[1].authorName).toBe("Alice Andrews")
  })

  it("yields null authorName when the author relation has no name", async () => {
    contractRows = [{ id: "c-1", vendorId: "ven-1" }]
    noteRows = [
      {
        id: "n-1",
        contractId: "c-1",
        note: "legacy seed row",
        authorId: "u-legacy",
        createdAt: new Date("2026-04-01"),
        author: { name: null },
      },
    ]
    const result = await listRenewalNotesForVendor("c-1")
    expect(result).toHaveLength(1)
    expect(result[0].authorName).toBeNull()
  })
})
