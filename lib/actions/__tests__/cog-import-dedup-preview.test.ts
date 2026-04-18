/**
 * Tests for `previewCOGImportDuplicates` — subsystem 3 of the COG data
 * rewrite. The action combines pending (pre-persist) import rows with
 * the facility's existing COG rows, feeds them into the pure
 * `detectDuplicates` helper, and returns the resulting report without
 * writing anything. All dependencies are mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type CogRow = {
  id: string
  facilityId: string
  inventoryNumber: string
  vendorItemNo: string | null
  transactionDate: Date
  unitCost: number
  quantity: number
  vendorName: string | null
}

let existingRows: CogRow[] = []

const cogFindMany = vi.fn(
  async ({ where }: { where: { facilityId: string }; select: unknown }) => {
    return existingRows.filter((r) => r.facilityId === where.facilityId)
  },
)

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      findMany: (args: {
        where: { facilityId: string }
        select: unknown
      }) => cogFindMany(args),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: async () => ({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  }),
}))

import { previewCOGImportDuplicates } from "@/lib/actions/cog-import/dedup-preview"

beforeEach(() => {
  vi.clearAllMocks()
  existingRows = []
})

describe("previewCOGImportDuplicates", () => {
  it("returns an empty report when there are no existing rows and no input", async () => {
    const report = await previewCOGImportDuplicates({ records: [] })

    expect(report.groups).toEqual([])
    expect(report.exactMatchCount).toBe(0)
    expect(report.partialMatchCount).toBe(0)
  })

  it("scopes the findMany query to the caller's facility only", async () => {
    existingRows = [
      {
        id: "existing-own",
        facilityId: "fac-1",
        inventoryNumber: "INV-1",
        vendorItemNo: "V-1",
        transactionDate: new Date("2026-01-01T00:00:00Z"),
        unitCost: 10,
        quantity: 1,
        vendorName: "Acme",
      },
      {
        id: "existing-other",
        facilityId: "fac-2",
        inventoryNumber: "INV-1",
        vendorItemNo: "V-1",
        transactionDate: new Date("2026-01-01T00:00:00Z"),
        unitCost: 10,
        quantity: 1,
        vendorName: "Acme",
      },
    ]

    const report = await previewCOGImportDuplicates({
      records: [
        {
          inventoryNumber: "INV-1",
          vendorItemNo: "V-1",
          transactionDate: "2026-01-01T00:00:00Z",
          unitCost: 10,
          quantity: 1,
          vendorName: "Acme",
        },
      ],
    })

    expect(cogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { facilityId: "fac-1" } }),
    )
    // Exact match between the ONE existing row for this facility and the
    // new row. The other-facility existing row must not be included.
    expect(report.exactMatchCount).toBe(2)
    expect(report.groups).toHaveLength(1)
    expect(report.groups[0]?.matchKey).toBe("both")
  })

  it("detects exact duplicates between a pending row and an existing row", async () => {
    existingRows = [
      {
        id: "e-1",
        facilityId: "fac-1",
        inventoryNumber: "INV-9",
        vendorItemNo: "VIN-9",
        transactionDate: new Date("2026-02-15T00:00:00Z"),
        unitCost: 10,
        quantity: 1,
        vendorName: "Acme",
      },
    ]

    const report = await previewCOGImportDuplicates({
      records: [
        {
          inventoryNumber: "INV-9",
          vendorItemNo: "VIN-9",
          transactionDate: "2026-02-15T00:00:00Z",
          unitCost: 12,
          quantity: 1,
        },
      ],
    })

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0]?.matchKey).toBe("both")
    expect(report.groups[0]?.isExactMatch).toBe(true)
    expect(report.groups[0]?.records).toHaveLength(2)
    expect(report.exactMatchCount).toBe(2)
    expect(report.partialMatchCount).toBe(0)
  })

  it("detects partial inventory_number matches when vendorItemNo differs", async () => {
    existingRows = [
      {
        id: "e-1",
        facilityId: "fac-1",
        inventoryNumber: "INV-7",
        vendorItemNo: "VIN-A",
        transactionDate: new Date("2026-03-01T00:00:00Z"),
        unitCost: 10,
        quantity: 1,
        vendorName: null,
      },
    ]

    const report = await previewCOGImportDuplicates({
      records: [
        {
          inventoryNumber: "INV-7",
          vendorItemNo: "VIN-B",
          transactionDate: "2026-03-01T00:00:00Z",
          unitCost: 10,
          quantity: 1,
        },
      ],
    })

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0]?.matchKey).toBe("inventory_number")
    expect(report.groups[0]?.isExactMatch).toBe(false)
    expect(report.partialMatchCount).toBe(2)
    expect(report.exactMatchCount).toBe(0)
  })

  it("detects duplicates that only exist among the pending input rows", async () => {
    existingRows = []

    const report = await previewCOGImportDuplicates({
      records: [
        {
          inventoryNumber: "X-1",
          vendorItemNo: "V-1",
          transactionDate: "2026-04-01T00:00:00Z",
          unitCost: 5,
          quantity: 1,
        },
        {
          inventoryNumber: "X-1",
          vendorItemNo: "V-1",
          transactionDate: "2026-04-01T00:00:00Z",
          unitCost: 5,
          quantity: 1,
        },
      ],
    })

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0]?.matchKey).toBe("both")
    expect(report.groups[0]?.records).toHaveLength(2)
    expect(report.exactMatchCount).toBe(2)
  })

  it("parses ISO date strings into Date objects before dedup", async () => {
    existingRows = [
      {
        id: "e-1",
        facilityId: "fac-1",
        inventoryNumber: "INV-DATE",
        vendorItemNo: "VIN-DATE",
        transactionDate: new Date("2026-05-15T00:00:00Z"),
        unitCost: 10,
        quantity: 1,
        vendorName: null,
      },
    ]

    // Different time-of-day on same calendar date (UTC) — still an exact
    // match since dedup normalizes to YYYY-MM-DD.
    const report = await previewCOGImportDuplicates({
      records: [
        {
          inventoryNumber: "INV-DATE",
          vendorItemNo: "VIN-DATE",
          transactionDate: "2026-05-15T12:30:00Z",
          unitCost: 10,
          quantity: 1,
        },
      ],
    })

    expect(report.groups).toHaveLength(1)
    expect(report.groups[0]?.matchKey).toBe("both")
  })

  it("does not call any prisma write method", async () => {
    existingRows = [
      {
        id: "e-1",
        facilityId: "fac-1",
        inventoryNumber: "INV-NW",
        vendorItemNo: "V-NW",
        transactionDate: new Date("2026-01-01T00:00:00Z"),
        unitCost: 1,
        quantity: 1,
        vendorName: null,
      },
    ]

    await previewCOGImportDuplicates({
      records: [
        {
          inventoryNumber: "INV-NW",
          vendorItemNo: "V-NW",
          transactionDate: "2026-01-01T00:00:00Z",
          unitCost: 1,
          quantity: 1,
        },
      ],
    })

    // The mocked prisma only exposes findMany — but we assert it was
    // the only method invoked by checking call count.
    expect(cogFindMany).toHaveBeenCalledTimes(1)
  })
})
