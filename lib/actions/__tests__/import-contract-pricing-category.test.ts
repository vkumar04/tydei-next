/**
 * Regression coverage for #4b (Vick 2026-05-31): the contract-linked
 * pricing import must canonicalize category VALUES the same way COG import
 * does, so cogCategoryCoveredByContract (match.ts) lines up. Pre-fix the
 * action stored `category` raw and "Ortho Extremity" vs "Ortho-Extremity"
 * silently dropped COG coverage.
 *
 * We mock auth + prisma + the category resolver so we only exercise the
 * action's own canonicalization wiring.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const contractFindUniqueOrThrow = vi.fn(async (_a?: unknown) => ({ id: "c1" }))
const createManyMock = vi.fn(async (args: { data: unknown[] }) => ({
  count: args.data.length,
}))
const deleteManyMock = vi.fn(async (_a?: unknown) => ({ count: 0 }))
const resolveCategoryNamesBulkMock = vi.fn()
const populateCarveOutMock = vi.fn(async (_id?: string) => ({
  termsFound: 0,
  productsLinked: 0,
  carveOutSkuCount: 0,
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { findUniqueOrThrow: (a: unknown) => contractFindUniqueOrThrow(a) },
    $transaction: async (
      cb: (tx: unknown) => Promise<unknown>,
    ) =>
      cb({
        contractPricing: {
          deleteMany: (a: unknown) => deleteManyMock(a),
          createMany: (a: { data: unknown[] }) => createManyMock(a),
        },
      }),
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: async () => ({ facility: { id: "fac-1" }, user: { id: "u1" } }),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id }),
}))

vi.mock("@/lib/categories/resolve", () => ({
  resolveCategoryNamesBulk: (...args: unknown[]) =>
    resolveCategoryNamesBulkMock(...args),
  // Bug 5: importContractPricing now guards categories through this.
  isPlaceholderCategory: (s: string) =>
    !s?.trim() || /^[\d.,\s/+\-–—]+$/.test(s.trim()),
}))

vi.mock("@/lib/contracts/populate-carveout-terms", () => ({
  populateCarveOutTermsForContract: (id: string) => populateCarveOutMock(id),
}))

describe("importContractPricing — category canonicalization (#4b)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Resolver maps the normalized raw key → existing canonical name.
    resolveCategoryNamesBulkMock.mockResolvedValue(
      new Map([["ortho extremity", "Ortho-Extremity"]]),
    )
  })

  it("writes the canonical category name, not the raw file value", async () => {
    const { importContractPricing } = await import("@/lib/actions/pricing-files")

    await importContractPricing({
      contractId: "c1",
      items: [
        { vendorItemNo: "SKU-1", unitPrice: 10, category: "Ortho Extremity" },
      ],
    })

    // Resolver was called with createMissing + the pricing_file source,
    // mirroring the COG import path.
    expect(resolveCategoryNamesBulkMock).toHaveBeenCalledWith(
      ["Ortho Extremity"],
      { createMissing: true, source: "pricing_file" },
    )

    expect(createManyMock).toHaveBeenCalledTimes(1)
    const written = createManyMock.mock.calls[0][0].data as Array<{
      category?: string
    }>
    expect(written[0].category).toBe("Ortho-Extremity")
  })

  it("falls back to the trimmed raw value when the resolver has no match", async () => {
    resolveCategoryNamesBulkMock.mockResolvedValueOnce(new Map())
    const { importContractPricing } = await import("@/lib/actions/pricing-files")

    await importContractPricing({
      contractId: "c1",
      items: [{ vendorItemNo: "SKU-9", unitPrice: 5, category: "  Spine  " }],
    })

    const written = createManyMock.mock.calls[0][0].data as Array<{
      category?: string
    }>
    expect(written[0].category).toBe("Spine")
  })
})
