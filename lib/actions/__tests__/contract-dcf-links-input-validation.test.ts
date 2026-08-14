import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Input-validation / tenant-safety pins for the contract ↔ DCF-proposal link
 * actions (`lib/actions/contract-dcf-links.ts`).
 *
 * Server-action arguments are deserialized client JSON — the declared
 * `contractId: string` is erased at runtime, so a crafted caller can put an
 * OBJECT where a string is declared. Prisma accepts `{ not: "" }` as a valid
 * `StringFilter`, and `deleteMany` is the one shape where that WIDENS the row
 * set instead of failing closed: `unlinkDcfProposalFromContract` went from
 * deleting one link to deleting every link the vendor owned.
 *
 * The fix parses both ids through `contractDcfLinkInputSchema` BEFORE any
 * Prisma predicate is built, and runs the same `assertContractVisible`
 * ownership check the read and link paths already used.
 *
 * `contractDcfLinkMock.deleteMany` is a hand-rolled fake that reproduces
 * Prisma's `StringFilter` semantics against a 4-row store, so the regression
 * test measures the real blast radius (4 of 4 rows) rather than asserting a
 * bare "not called".
 */

interface LinkRow {
  vendorId: string
  contractId: string
  proposalId: string
}

/** Prisma `where` values are either a primitive or a filter object. */
type WhereValue = string | { not?: string; in?: string[] }
interface DeleteManyArgs {
  where: Record<string, WhereValue>
}

const {
  contractFindFirstMock,
  proposalFindFirstMock,
  linkUpsertMock,
  linkDeleteManyMock,
  requireVendorMock,
  requireCanMutateMock,
  linkStore,
} = vi.hoisted(() => {
  const store: LinkRow[] = []

  /**
   * Emulates `prisma.contractDcfLink.deleteMany` closely enough to measure a
   * widened predicate: a primitive matches by equality, an object is treated
   * as a StringFilter (`not` / `in`) exactly as Prisma would.
   */
  const matches = (row: LinkRow, where: Record<string, WhereValue>): boolean =>
    Object.entries(where).every(([key, cond]) => {
      const actual = row[key as keyof LinkRow]
      if (typeof cond === "string") return actual === cond
      if (cond.not !== undefined) return actual !== cond.not
      if (cond.in !== undefined) return cond.in.includes(actual)
      return false
    })

  return {
    contractFindFirstMock: vi.fn(),
    proposalFindFirstMock: vi.fn(),
    linkUpsertMock: vi.fn(),
    linkDeleteManyMock: vi.fn(async ({ where }: DeleteManyArgs) => {
      const doomed = store.filter((r) => matches(r, where))
      for (const row of doomed) store.splice(store.indexOf(row), 1)
      return { count: doomed.length }
    }),
    requireVendorMock: vi.fn(),
    requireCanMutateMock: vi.fn(),
    linkStore: store,
  }
})

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findFirst: contractFindFirstMock },
    dividendProposal: { findFirst: proposalFindFirstMock },
    contractDcfLink: {
      upsert: linkUpsertMock,
      deleteMany: linkDeleteManyMock,
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({ requireVendor: requireVendorMock }))
vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCanMutate: requireCanMutateMock,
}))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import {
  getContractDcfBundle,
  linkDcfProposalToContract,
  unlinkDcfProposalFromContract,
} from "@/lib/actions/contract-dcf-links"
import { contractDcfLinkInputSchema } from "@/lib/validators/dividend-proposals"

const VENDOR_ID = "vendor-1"
/** A real cuid shape — 25 chars, what Prisma actually mints. */
const CUID = "cl9f2k3m40000qzrmn831i7rn"

/** The vendor owns four links across two contracts. */
function seedLinks() {
  linkStore.length = 0
  linkStore.push(
    { vendorId: VENDOR_ID, contractId: "c-1", proposalId: "p-1" },
    { vendorId: VENDOR_ID, contractId: "c-1", proposalId: "p-2" },
    { vendorId: VENDOR_ID, contractId: "c-2", proposalId: "p-3" },
    { vendorId: VENDOR_ID, contractId: "c-2", proposalId: "p-4" },
  )
}

/** Server-action args are client JSON: the declared type is a lie at runtime. */
function craftedIds(): { contractId: string; proposalId: string } {
  return { contractId: { not: "" }, proposalId: { not: "" } } as unknown as {
    contractId: string
    proposalId: string
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  seedLinks()
  requireVendorMock.mockResolvedValue({
    vendor: { id: VENDOR_ID, name: "Acme" },
    user: { id: "u-vendor" },
  })
  requireCanMutateMock.mockResolvedValue({ tier: "admin", side: "vendor" })
  // Default: the contract IS visible to this vendor.
  contractFindFirstMock.mockResolvedValue({ id: "c-1" })
  proposalFindFirstMock.mockResolvedValue({ id: "p-1" })
  linkUpsertMock.mockResolvedValue({ id: "link-1" })
})

describe("unlinkDcfProposalFromContract — crafted filter-object ids", () => {
  it("REGRESSION: rejects {not:\"\"} ids before Prisma is touched", async () => {
    await expect(
      unlinkDcfProposalFromContract(craftedIds()),
    ).rejects.toThrowError()

    // The whole point: the predicate is never built, so deleteMany never runs.
    expect(linkDeleteManyMock).not.toHaveBeenCalled()
    // Pre-fix this payload reached deleteMany as a StringFilter and matched
    // every row the vendor owned — 4 of 4 deleted. All four must survive.
    expect(linkStore).toHaveLength(4)
  })

  it("proves the fake deleteMany WOULD have wiped all 4 rows (blast radius)", async () => {
    // Not through the action — straight at the fake, to show the measured
    // pre-fix behaviour the regression test above prevents.
    const { count } = await linkDeleteManyMock({
      where: {
        vendorId: VENDOR_ID,
        contractId: { not: "" },
        proposalId: { not: "" },
      },
    })
    expect(count).toBe(4)
    expect(linkStore).toHaveLength(0)
  })

  it("rejects before the ownership lookup too (no contract read)", async () => {
    await expect(
      unlinkDcfProposalFromContract(craftedIds()),
    ).rejects.toThrowError()
    expect(contractFindFirstMock).not.toHaveBeenCalled()
  })
})

describe("unlinkDcfProposalFromContract — well-formed payload", () => {
  it("builds a where deep-equal to { vendorId, contractId, proposalId }", async () => {
    await unlinkDcfProposalFromContract({
      contractId: "c-1",
      proposalId: "p-1",
    })

    expect(linkDeleteManyMock).toHaveBeenCalledTimes(1)
    const [args] = linkDeleteManyMock.mock.calls[0] as [DeleteManyArgs]
    expect(args.where).toEqual({
      vendorId: VENDOR_ID,
      contractId: "c-1",
      proposalId: "p-1",
    })
    expect(typeof args.where.contractId).toBe("string")
    expect(typeof args.where.proposalId).toBe("string")
  })

  it("removes exactly 1 of the vendor's 4 links", async () => {
    await unlinkDcfProposalFromContract({
      contractId: "c-1",
      proposalId: "p-1",
    })
    expect(linkStore).toHaveLength(3)
    expect(
      linkStore.some((r) => r.contractId === "c-1" && r.proposalId === "p-1"),
    ).toBe(false)
  })

  it("trims the ids before they reach the predicate", async () => {
    await unlinkDcfProposalFromContract({
      contractId: " c-1 ",
      proposalId: " p-1 ",
    })
    const [args] = linkDeleteManyMock.mock.calls[0] as [DeleteManyArgs]
    expect(args.where.contractId).toBe("c-1")
    expect(args.where.proposalId).toBe("p-1")
  })

  it("ignores an attacker-supplied vendorId in the payload", async () => {
    await unlinkDcfProposalFromContract({
      contractId: "c-1",
      proposalId: "p-1",
      vendorId: "vendor-evil",
    } as unknown as { contractId: string; proposalId: string })

    const [args] = linkDeleteManyMock.mock.calls[0] as [DeleteManyArgs]
    expect(args.where.vendorId).toBe(VENDOR_ID)
  })
})

describe("unlinkDcfProposalFromContract — ownership + permission gates", () => {
  it("rejects a contract the vendor cannot see, without deleting", async () => {
    contractFindFirstMock.mockResolvedValue(null)

    await expect(
      unlinkDcfProposalFromContract({
        contractId: "c-other",
        proposalId: "p-1",
      }),
    ).rejects.toThrow(/Contract not found/)

    expect(contractFindFirstMock).toHaveBeenCalledTimes(1)
    expect(linkDeleteManyMock).not.toHaveBeenCalled()
    expect(linkStore).toHaveLength(4)
  })

  it("scopes the ownership lookup to the caller's own vendor", async () => {
    await unlinkDcfProposalFromContract({
      contractId: "c-1",
      proposalId: "p-1",
    })
    const [args] = contractFindFirstMock.mock.calls[0] as [
      { where: { id: string; OR?: unknown[] } },
    ]
    expect(args.where.id).toBe("c-1")
    expect(args.where.OR).toEqual([
      { vendorId: VENDOR_ID },
      { additionalVendorIds: { has: VENDOR_ID } },
    ])
  })

  it("calls requireCanMutate — the read-only tier stays blocked", async () => {
    requireCanMutateMock.mockRejectedValue(new Error("Your access is read-only"))

    await expect(
      unlinkDcfProposalFromContract({ contractId: "c-1", proposalId: "p-1" }),
    ).rejects.toThrow(/read-only/)

    expect(requireCanMutateMock).toHaveBeenCalledTimes(1)
    expect(linkDeleteManyMock).not.toHaveBeenCalled()
    expect(linkStore).toHaveLength(4)
  })
})

describe("linkDcfProposalToContract", () => {
  it("rejects a filter-object id with ZERO Prisma writes", async () => {
    await expect(linkDcfProposalToContract(craftedIds())).rejects.toThrowError()

    expect(linkUpsertMock).not.toHaveBeenCalled()
    expect(contractFindFirstMock).not.toHaveBeenCalled()
    expect(proposalFindFirstMock).not.toHaveBeenCalled()
  })

  it("writes the composite key as primitive strings on the happy path", async () => {
    await linkDcfProposalToContract({ contractId: "c-1", proposalId: "p-1" })

    expect(linkUpsertMock).toHaveBeenCalledTimes(1)
    const [args] = linkUpsertMock.mock.calls[0] as [
      {
        where: { contractId_proposalId: { contractId: string; proposalId: string } }
        create: { vendorId: string; contractId: string; proposalId: string }
      },
    ]
    expect(args.where.contractId_proposalId).toEqual({
      contractId: "c-1",
      proposalId: "p-1",
    })
    expect(typeof args.where.contractId_proposalId.contractId).toBe("string")
    expect(typeof args.where.contractId_proposalId.proposalId).toBe("string")
    expect(args.create.vendorId).toBe(VENDOR_ID)
  })

  it("rejects a contract the vendor cannot see, without writing", async () => {
    contractFindFirstMock.mockResolvedValue(null)

    await expect(
      linkDcfProposalToContract({ contractId: "c-other", proposalId: "p-1" }),
    ).rejects.toThrow(/Contract not found/)
    expect(linkUpsertMock).not.toHaveBeenCalled()
  })

  it("rejects a proposal owned by another vendor, without writing", async () => {
    proposalFindFirstMock.mockResolvedValue(null)

    await expect(
      linkDcfProposalToContract({ contractId: "c-1", proposalId: "p-other" }),
    ).rejects.toThrow(/Proposal not found/)
    expect(linkUpsertMock).not.toHaveBeenCalled()
  })

  it("calls requireCanMutate — the read-only tier stays blocked", async () => {
    requireCanMutateMock.mockRejectedValue(new Error("Your access is read-only"))

    await expect(
      linkDcfProposalToContract({ contractId: "c-1", proposalId: "p-1" }),
    ).rejects.toThrow(/read-only/)

    expect(requireCanMutateMock).toHaveBeenCalledTimes(1)
    expect(linkUpsertMock).not.toHaveBeenCalled()
  })
})

describe("getContractDcfBundle", () => {
  it("rejects a filter-object contractId before touching Prisma", async () => {
    const crafted = { not: "" } as unknown as string

    await expect(getContractDcfBundle(crafted)).rejects.toThrowError()
    expect(contractFindFirstMock).not.toHaveBeenCalled()
  })

  it("rejects a contract the vendor cannot see", async () => {
    contractFindFirstMock.mockResolvedValue(null)
    await expect(getContractDcfBundle("c-other")).rejects.toThrow(
      /Contract not found/,
    )
    // Only the visibility probe ran; the heavy select never did.
    expect(contractFindFirstMock).toHaveBeenCalledTimes(1)
  })
})

describe("contractDcfLinkInputSchema boundaries", () => {
  it("rejects an empty string id", () => {
    expect(
      contractDcfLinkInputSchema.safeParse({ contractId: "", proposalId: "p-1" })
        .success,
    ).toBe(false)
  })

  it("rejects a whitespace-only id (trim runs before min(1))", () => {
    expect(
      contractDcfLinkInputSchema.safeParse({
        contractId: "   ",
        proposalId: "p-1",
      }).success,
    ).toBe(false)
  })

  it("rejects a 65-char id but accepts 64", () => {
    // max(64): 64 passes, 65 is the first rejected length.
    const at64 = "a".repeat(64)
    const at65 = "a".repeat(65)
    expect(at65).toHaveLength(65)
    expect(
      contractDcfLinkInputSchema.safeParse({
        contractId: at64,
        proposalId: "p-1",
      }).success,
    ).toBe(true)
    expect(
      contractDcfLinkInputSchema.safeParse({
        contractId: at65,
        proposalId: "p-1",
      }).success,
    ).toBe(false)
  })

  it("accepts a real 25-char cuid", () => {
    expect(CUID).toHaveLength(25)
    const parsed = contractDcfLinkInputSchema.parse({
      contractId: CUID,
      proposalId: CUID,
    })
    expect(parsed.contractId).toBe(CUID)
  })

  it('trims " c-1 " to "c-1"', () => {
    const parsed = contractDcfLinkInputSchema.parse({
      contractId: " c-1 ",
      proposalId: " p-1 ",
    })
    expect(parsed.contractId).toBe("c-1")
    expect(parsed.proposalId).toBe("p-1")
  })

  it("rejects a filter object where a string is declared", () => {
    expect(
      contractDcfLinkInputSchema.safeParse({
        contractId: { not: "" },
        proposalId: { not: "" },
      }).success,
    ).toBe(false)
  })

  it("STRIPS unknown keys — an injected vendorId does not survive", () => {
    const parsed = contractDcfLinkInputSchema.parse({
      contractId: "c-1",
      proposalId: "p-1",
      vendorId: "vendor-evil",
    })
    expect(Object.keys(parsed).sort()).toEqual(["contractId", "proposalId"])
    expect("vendorId" in parsed).toBe(false)
  })
})
