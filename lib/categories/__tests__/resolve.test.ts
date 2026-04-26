/**
 * Tests for the ProductCategory canonical-name resolver. Mirrors the
 * shape of lib/vendors/__tests__/resolve.test.ts at the function-level.
 *
 * Charles prod feedback: pricing-file + COG imports were storing
 * free-form category strings ("Ortho-Extremity", "ortho-extremity",
 * "Ortho Extremity ") which split downstream Market Share queries.
 * The resolver canonicalizes them to a single existing-row name.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const findManyMock = vi.fn()
const findFirstMock = vi.fn()
const createMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    productCategory: {
      findMany: (a: unknown) => findManyMock(a as never),
      findFirst: (a: unknown) => findFirstMock(a as never),
      create: (a: unknown) => createMock(a as never),
    },
  },
}))

beforeEach(() => {
  findManyMock.mockReset()
  findFirstMock.mockReset()
  createMock.mockReset()
})

describe("resolveCategoryName", () => {
  it("trims + case-insensitive matches against existing names", async () => {
    findManyMock.mockResolvedValue([
      { id: "1", name: "Ortho-Extremity" },
      { id: "2", name: "Ortho-Sports Med" },
    ])
    const { resolveCategoryName } = await import("../resolve")
    expect(await resolveCategoryName("ortho-extremity")).toBe("Ortho-Extremity")
    expect(await resolveCategoryName("  Ortho-Extremity  ")).toBe(
      "Ortho-Extremity",
    )
    expect(await resolveCategoryName("ORTHO-SPORTS MED")).toBe(
      "Ortho-Sports Med",
    )
  })

  it("collapses whitespace mismatches", async () => {
    findManyMock.mockResolvedValue([{ id: "1", name: "Ortho Extremity" }])
    const { resolveCategoryName } = await import("../resolve")
    expect(await resolveCategoryName("Ortho  Extremity")).toBe(
      "Ortho Extremity",
    )
    expect(await resolveCategoryName("ortho   extremity")).toBe(
      "Ortho Extremity",
    )
  })

  it("returns null for un-matched input when createMissing=false", async () => {
    findManyMock.mockResolvedValue([{ id: "1", name: "Ortho-Extremity" }])
    const { resolveCategoryName } = await import("../resolve")
    expect(await resolveCategoryName("Unknown Category")).toBeNull()
  })

  it("creates new row tagged with source when createMissing=true", async () => {
    findManyMock.mockResolvedValue([])
    createMock.mockResolvedValue({ name: "New Category" })
    const { resolveCategoryName } = await import("../resolve")
    const result = await resolveCategoryName("New Category", {
      createMissing: true,
      source: "pricing_file",
    })
    expect(result).toBe("New Category")
    expect(createMock).toHaveBeenCalledWith({
      data: { name: "New Category", source: "pricing_file" },
      select: { name: true },
    })
  })

  it("returns null on empty / nullish input", async () => {
    const { resolveCategoryName } = await import("../resolve")
    expect(await resolveCategoryName(null)).toBeNull()
    expect(await resolveCategoryName("")).toBeNull()
    expect(await resolveCategoryName("   ")).toBeNull()
  })
})

describe("resolveCategoryNamesBulk", () => {
  it("returns a Map keyed by normalized input → canonical name", async () => {
    findManyMock.mockResolvedValue([
      { id: "1", name: "Ortho-Extremity" },
      { id: "2", name: "Ortho-Sports Med" },
    ])
    const { resolveCategoryNamesBulk } = await import("../resolve")
    const result = await resolveCategoryNamesBulk([
      "ortho-extremity",
      "Ortho-Extremity ",
      "ORTHO-SPORTS MED",
      null,
    ])
    expect(result.get("ortho-extremity")).toBe("Ortho-Extremity")
    expect(result.get("ortho-sports med")).toBe("Ortho-Sports Med")
  })

  it("creates missing categories tagged with source when enabled", async () => {
    findManyMock.mockResolvedValue([])
    createMock.mockImplementation(async ({ data }: { data: { name: string } }) => ({
      name: data.name,
    }))
    const { resolveCategoryNamesBulk } = await import("../resolve")
    const result = await resolveCategoryNamesBulk(["Brand New", "Other"], {
      createMissing: true,
      source: "cog",
    })
    expect(result.get("brand new")).toBe("Brand New")
    expect(result.get("other")).toBe("Other")
    expect(createMock).toHaveBeenCalledTimes(2)
    expect(createMock).toHaveBeenCalledWith({
      data: { name: "Brand New", source: "cog" },
      select: { name: true },
    })
  })
})
