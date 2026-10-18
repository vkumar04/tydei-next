import { describe, it, expect, vi, beforeEach } from "vitest"

type Call = { model: string; op: string; arg: unknown }

const { calls, counts } = vi.hoisted(() => ({
  calls: [] as Array<{ model: string; op: string; arg: unknown }>,
  counts: { contract: 0, contractProductCategory: 0 } as Record<string, number>,
}))

function result(model: string, op: string): unknown {
  if (op === "findMany") return []
  if (op === "updateMany" || op === "deleteMany") return { count: 0 }
  if (op === "count") return counts[model] ?? 0
  if (model === "productCategory" && op === "findFirst") return null
  if (model === "categoryMapping" && op === "findFirst") return null
  return {}
}

function recorder(): unknown {
  return new Proxy(
    {},
    {
      get: (_t, model: string) =>
        new Proxy(
          {},
          {
            get: (_m, op: string) => async (arg: unknown) => {
              calls.push({ model, op, arg })
              return result(model, op)
            },
          },
        ),
    },
  )
}

const { productCategoryFindFirst } = vi.hoisted(() => ({ productCategoryFindFirst: vi.fn() }))

vi.mock("@/lib/db", () => {
  const tx = recorder() as Record<string, Record<string, (a: unknown) => Promise<unknown>>>
  const txWithCategories = new Proxy(tx, {
    get: (t, model: string) =>
      model === "productCategory"
        ? new Proxy(t.productCategory, {
            get: (m, op: string) =>
              op === "findFirst"
                ? async (arg: unknown) => {
                    calls.push({ model, op, arg })
                    return productCategoryFindFirst(arg)
                  }
                : m[op],
          })
        : t[model],
  })
  const prisma = new Proxy(recorder() as Record<string, unknown>, {
    get: (t, key: string) =>
      key === "$transaction"
        ? async (fn: (tx: unknown) => Promise<unknown>) => fn(txWithCategories)
        : t[key],
  })
  return { prisma }
})

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: async () => ({ facility: { id: "f1" }, user: { id: "u1" } }),
}))
vi.mock("@/lib/actions/auth-permissions", () => ({ requireCanMutate: vi.fn(async () => ({})) }))
vi.mock("@/lib/cog/recompute", () => ({ recomputeMatchStatusesForVendor: vi.fn(async () => {}) }))
vi.mock("@/lib/contracts/refresh-metrics-for-vendor", () => ({
  refreshContractMetricsForVendor: vi.fn(async () => ({})),
}))
vi.mock("@/lib/actions/contracts/recompute-accrual", () => ({
  recomputeAccrualForContract: vi.fn(async () => ({})),
}))
vi.mock("@/lib/categories/resolve", () => ({ removeInverseCategoryMapping: vi.fn(async () => {}) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const OWN = { OR: [{ facilityId: "f1" }, { contractFacilities: { some: { facilityId: "f1" } } }] }

function find(model: string, op: string): Call[] {
  return calls.filter((c) => c.model === model && c.op === op)
}

beforeEach(() => {
  calls.length = 0
  counts.contract = 0
  counts.contractProductCategory = 0
  productCategoryFindFirst.mockReset()
  productCategoryFindFirst
    .mockResolvedValueOnce({ id: "cat-old", name: "Joints", parentId: null })
    .mockResolvedValueOnce({ id: "cat-new", name: "Ortho", parentId: null })
})

describe("remapCOGCategory — taxonomy retarget stays inside the caller's tenant", () => {
  it("only repoints contracts the caller owns", async () => {
    const { remapCOGCategory } = await import("@/lib/actions/cog-category-mapping")
    await remapCOGCategory({ cogCategory: "Joints", contractCategory: "Ortho" })

    expect(find("contract", "updateMany")[0]?.arg).toEqual({
      where: { productCategoryId: "cat-old", ...OWN },
      data: { productCategoryId: "cat-new" },
    })
    expect(find("contractProductCategory", "updateMany")[0]?.arg).toEqual({
      where: { productCategoryId: "cat-old", contract: OWN },
      data: { productCategoryId: "cat-new" },
    })
    expect(find("contractProductCategory", "findMany")[0]?.arg).toMatchObject({
      where: { productCategoryId: "cat-new", contract: OWN },
    })
  })

  it("keeps the old taxonomy row and its children when another tenant's contract still uses it", async () => {
    counts.contract = 1
    const { remapCOGCategory } = await import("@/lib/actions/cog-category-mapping")
    await remapCOGCategory({ cogCategory: "Joints", contractCategory: "Ortho" })

    expect(find("productCategory", "updateMany")).toHaveLength(0)
    expect(find("productCategory", "delete")).toHaveLength(0)
  })

  it("reparents and deletes the old row once nothing references it", async () => {
    const { remapCOGCategory } = await import("@/lib/actions/cog-category-mapping")
    await remapCOGCategory({ cogCategory: "Joints", contractCategory: "Ortho" })

    expect(find("productCategory", "updateMany")[0]?.arg).toEqual({
      where: { parentId: "cat-old" },
      data: { parentId: "cat-new" },
    })
    expect(find("productCategory", "delete")[0]?.arg).toEqual({ where: { id: "cat-old" } })
  })
})
