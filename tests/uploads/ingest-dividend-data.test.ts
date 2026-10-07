import { describe, expect, it, vi, beforeEach } from "vitest"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { AccessDeniedError } from "@/lib/auth/access-error"
import { vendorRelatedFacilityWhere } from "@/lib/vendors/related-facilities"

const { requireVendor, facilityFindFirst, payorUpsert, medicareUpsert, proformaUpsert } = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  facilityFindFirst: vi.fn(),
  payorUpsert: vi.fn(),
  medicareUpsert: vi.fn(),
  proformaUpsert: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    facility: { findFirst: facilityFindFirst },
    payorVolumeDataset: { upsert: payorUpsert },
    medicareRateSet: { upsert: medicareUpsert },
    proformaStatement: { upsert: proformaUpsert },
  },
}))
vi.mock("@/lib/actions/auth", () => ({ requireVendor }))

import { ingestPayorVolumeRows } from "@/lib/actions/payor-volume"
import { ingestMedicareRateRows } from "@/lib/actions/medicare-rate-sets"
import { ingestProformaMatrix } from "@/lib/actions/proforma-statements"

const VENDOR_ID = "vendor-stryker"
const USER_ID = "user-rep-1"

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  requireVendor.mockResolvedValue({ user: { id: USER_ID }, vendor: { id: VENDOR_ID } })
  vi.mocked(requireCanMutate).mockResolvedValue({ tier: "super", side: "vendor" })
  facilityFindFirst.mockResolvedValue({ id: "fac-1", name: "Lighthouse Surgical Center" })
  payorUpsert.mockImplementation(async (args: { create: { facilityKey: string; facilityLabel: string } }) => ({
    id: "pv-1",
    facilityKey: args.create.facilityKey,
    facilityLabel: args.create.facilityLabel,
  }))
  medicareUpsert.mockImplementation(async (args: { create: { name: string } }) => ({ id: "rs-1", name: args.create.name }))
  proformaUpsert.mockImplementation(async (args: { create: { facilityKey: string; facilityLabel: string } }) => ({
    id: "pf-1",
    facilityKey: args.create.facilityKey,
    facilityLabel: args.create.facilityLabel,
  }))
})

function facilityScopeWhere(id: string) {
  return {
    where: { id, status: "active", ...vendorRelatedFacilityWhere(VENDOR_ID) },
    select: { id: true, name: true },
  }
}

function vr(group: string, year: string, quarter: string, volume: string): Record<string, string> {
  return { "Procedure Group": group, Year: year, Quarter: quarter, Volume: volume }
}

const VOLUME_ROWS = [
  vr("Total Knee", "2025", "Q1", "10"),
  vr("Total Knee", "2025", "Q2", "20"),
  vr("Total Knee", "2025", "Q3", "30"),
  vr("Total Knee", "2025", "Q4", "40"),
  vr("Hip Arthroscopy", "2025", "1", "5"),
  vr("Hip Arthroscopy", "2025", "2", "7"),
  vr("Total Knee", "2025", "Q4", "1"),
  vr("", "2025", "Q1", "999"),
  vr("Shoulder", "2025", "Q5", "3"),
]

const EXPECTED_GROUPS = [
  {
    group: "Total Knee",
    quarters: [
      { year: 2025, quarter: 1, volume: 10 },
      { year: 2025, quarter: 2, volume: 20 },
      { year: 2025, quarter: 3, volume: 30 },
      { year: 2025, quarter: 4, volume: 41 },
    ],
    totalVolume: 101,
    annualizedVolume: 101,
  },
  {
    group: "Hip Arthroscopy",
    quarters: [
      { year: 2025, quarter: 1, volume: 5 },
      { year: 2025, quarter: 2, volume: 7 },
    ],
    totalVolume: 12,
    annualizedVolume: 24,
  },
]

describe("ingestPayorVolumeRows", () => {
  it("upserts a connected facility's dataset keyed by vendor and facility, scoped through the vendor-related predicate", async () => {
    const result = await ingestPayorVolumeRows(VOLUME_ROWS, { fileName: "aetna.xlsx", facilityId: "fac-1" })
    expect(facilityFindFirst).toHaveBeenCalledWith(facilityScopeWhere("fac-1"))
    const data = {
      facilityId: "fac-1",
      facilityLabel: "Lighthouse Surgical Center",
      fileName: "aetna.xlsx",
      periods: ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"],
      groups: EXPECTED_GROUPS,
      totalAnnualizedVolume: 125,
      uploadedBy: USER_ID,
    }
    expect(payorUpsert).toHaveBeenCalledWith({
      where: { vendorId_facilityKey: { vendorId: VENDOR_ID, facilityKey: "facility:fac-1" } },
      create: { vendorId: VENDOR_ID, facilityKey: "facility:fac-1", ...data },
      update: data,
    })
    expect(result).toEqual({
      facilityKey: "facility:fac-1",
      facilityLabel: "Lighthouse Surgical Center",
      groupCount: 2,
      totalAnnualizedVolume: 125,
    })
  })

  it("upserts an ad-hoc prospect under a lower-cased adhoc key with no facility lookup", async () => {
    const result = await ingestPayorVolumeRows(VOLUME_ROWS, { fileName: "v.csv", adhocName: "  Northside ASC " })
    expect(facilityFindFirst).not.toHaveBeenCalled()
    const call = payorUpsert.mock.calls[0]![0] as {
      where: unknown
      create: Record<string, unknown>
      update: Record<string, unknown>
    }
    expect(call.where).toEqual({ vendorId_facilityKey: { vendorId: VENDOR_ID, facilityKey: "adhoc:northside asc" } })
    expect(call.create).toMatchObject({ vendorId: VENDOR_ID, facilityId: null, facilityLabel: "Northside ASC", facilityKey: "adhoc:northside asc" })
    expect(call.update).toMatchObject({ facilityId: null, facilityLabel: "Northside ASC" })
    expect(result.facilityKey).toBe("adhoc:northside asc")
  })

  it("refuses a facility the vendor has no relationship with and writes nothing", async () => {
    facilityFindFirst.mockResolvedValue(null)
    await expect(ingestPayorVolumeRows(VOLUME_ROWS, { fileName: "v.csv", facilityId: "fac-other" })).rejects.toThrow("Facility not found")
    expect(facilityFindFirst).toHaveBeenCalledWith(facilityScopeWhere("fac-other"))
    expect(payorUpsert).not.toHaveBeenCalled()
  })

  it("requires exactly one of facilityId or adhocName", async () => {
    await expect(ingestPayorVolumeRows(VOLUME_ROWS, { fileName: "v.csv" })).rejects.toThrow("Provide exactly one of facilityId or adhocName")
    await expect(
      ingestPayorVolumeRows(VOLUME_ROWS, { fileName: "v.csv", facilityId: "fac-1", adhocName: "Northside" }),
    ).rejects.toThrow("Provide exactly one of facilityId or adhocName")
    expect(payorUpsert).not.toHaveBeenCalled()
  })

  it("rejects an empty row set", async () => {
    await expect(ingestPayorVolumeRows([], { fileName: "v.csv", adhocName: "N" })).rejects.toThrow("The file contains no data rows")
  })

  it("rejects more than 50,000 rows before touching the database", async () => {
    const rows = Array.from({ length: 50_001 }, () => vr("Knee", "2025", "1", "1"))
    await expect(ingestPayorVolumeRows(rows, { fileName: "v.csv", facilityId: "fac-1" })).rejects.toThrow(
      "The file has 50,001 rows; max is 50,000",
    )
    expect(facilityFindFirst).not.toHaveBeenCalled()
  })

  it("rejects a file with no recognizable procedure groups", async () => {
    await expect(
      ingestPayorVolumeRows([{ Foo: "a", Bar: "b" }], { fileName: "v.csv", adhocName: "N" }),
    ).rejects.toThrow("No procedure groups found")
    expect(payorUpsert).not.toHaveBeenCalled()
  })

  it("rejects more than 500 procedure groups", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => vr(`Group ${i}`, "2025", "1", "1"))
    await expect(ingestPayorVolumeRows(rows, { fileName: "v.csv", adhocName: "N" })).rejects.toThrow(
      "The file has 501 procedure groups; max is 500",
    )
  })

  it("rejects a negative volume as out of range", async () => {
    await expect(
      ingestPayorVolumeRows([vr("Knee", "2025", "1", "-4")], { fileName: "v.csv", adhocName: "N" }),
    ).rejects.toThrow("The file contains out-of-range values (volumes must be non-negative numbers).")
    expect(payorUpsert).not.toHaveBeenCalled()
  })

  it("stops at the read-only write gate before any database access", async () => {
    vi.mocked(requireCanMutate).mockRejectedValue(new AccessDeniedError("Read-only"))
    await expect(ingestPayorVolumeRows(VOLUME_ROWS, { fileName: "v.csv", facilityId: "fac-1" })).rejects.toThrow("Read-only")
    expect(facilityFindFirst).not.toHaveBeenCalled()
    expect(payorUpsert).not.toHaveBeenCalled()
  })

  it("stops when requireVendor denies the caller", async () => {
    requireVendor.mockRejectedValue(new AccessDeniedError("You don't have access to this area."))
    await expect(ingestPayorVolumeRows(VOLUME_ROWS, { fileName: "v.csv", adhocName: "N" })).rejects.toThrow("access")
    expect(requireCanMutate).not.toHaveBeenCalled()
    expect(payorUpsert).not.toHaveBeenCalled()
  })

  it("logs and rewraps a failed upsert", async () => {
    payorUpsert.mockRejectedValue(new Error("P2002"))
    await expect(ingestPayorVolumeRows(VOLUME_ROWS, { fileName: "v.csv", adhocName: "N" })).rejects.toThrow(
      "Failed to save the payor volume dataset",
    )
    expect(console.error).toHaveBeenCalledWith("[ingestPayorVolumeRows]", expect.any(Error), { vendorId: VENDOR_ID })
  })
})

function rr(group: string, code: string, rate: string, extra: Record<string, string> = {}): Record<string, string> {
  return { "Procedure Group": group, "CPT Code": code, "Medicare Rate": rate, ...extra }
}

describe("ingestMedicareRateRows", () => {
  it("upserts the parsed rates under the caller's vendor and the trimmed set name", async () => {
    const rows = [
      { ...rr("Total Knee Arthroplasty", "27447", "$9,876.54"), "% Change": "4.5%", Notes: "" },
      { ...rr("Knee Arthroscopy", "", "2101.1"), "% Change": "-1%", Notes: "Bilateral excluded" },
      { ...rr("", "29881", "100"), "% Change": "", Notes: "" },
      { ...rr("Shoulder", "29827", "N/A"), "% Change": "", Notes: "" },
      { ...rr("Total Knee Arthroplasty", "27447", "9900"), "% Change": "", Notes: "" },
    ]
    const result = await ingestMedicareRateRows(rows, { fileName: "cms.xlsx", name: "  CY2026 National  " })
    const rates = [
      { group: "Total Knee Arthroplasty", code: "27447", medicareRate: 9900 },
      { group: "Knee Arthroscopy", code: "—", medicareRate: 2101.1, note: "Bilateral excluded" },
    ]
    expect(medicareUpsert).toHaveBeenCalledWith({
      where: { vendorId_name: { vendorId: VENDOR_ID, name: "CY2026 National" } },
      create: { vendorId: VENDOR_ID, name: "CY2026 National", fileName: "cms.xlsx", rates, uploadedBy: USER_ID },
      update: { fileName: "cms.xlsx", rates, uploadedBy: USER_ID },
    })
    expect(result).toEqual({ id: "rs-1", name: "CY2026 National", rateCount: 2, skipped: 2 })
  })

  it("rejects a file with no recognizable rates", async () => {
    await expect(ingestMedicareRateRows([{ Foo: "x" }], { fileName: "r.csv", name: "Set" })).rejects.toThrow(
      "No rates were recognized",
    )
    expect(medicareUpsert).not.toHaveBeenCalled()
  })

  it("rejects more than 2,000 rows", async () => {
    const rows = Array.from({ length: 2_001 }, (_, i) => rr(`G${i}`, "1", "1"))
    await expect(ingestMedicareRateRows(rows, { fileName: "r.csv", name: "Set" })).rejects.toThrow(
      "The file has 2,001 rows; max is 2,000",
    )
  })

  it("rejects an empty row set and a blank set name", async () => {
    await expect(ingestMedicareRateRows([], { fileName: "r.csv", name: "Set" })).rejects.toThrow("no data rows")
    await expect(ingestMedicareRateRows([rr("Knee", "1", "1")], { fileName: "r.csv", name: "   " })).rejects.toThrow()
    expect(medicareUpsert).not.toHaveBeenCalled()
  })

  it("stops at the read-only write gate", async () => {
    vi.mocked(requireCanMutate).mockRejectedValue(new AccessDeniedError("Read-only"))
    await expect(ingestMedicareRateRows([rr("Knee", "1", "1")], { fileName: "r.csv", name: "Set" })).rejects.toThrow("Read-only")
    expect(medicareUpsert).not.toHaveBeenCalled()
  })

  it("logs and rewraps a failed upsert", async () => {
    medicareUpsert.mockRejectedValue(new Error("timeout"))
    await expect(ingestMedicareRateRows([rr("Knee", "1", "1")], { fileName: "r.csv", name: "Set" })).rejects.toThrow(
      "Failed to save the Medicare rate set",
    )
    expect(console.error).toHaveBeenCalledWith("[ingestMedicareRateRows]", expect.any(Error), { vendorId: VENDOR_ID })
  })
})

const STATEMENT: string[][] = [
  ["Steady State Proforma", "", ""],
  ["Revenue - standard billing rate", "$267,441,411", "22,286.78"],
  ["Revenue contractual adjustment", "(235,348,442)", "(19,612.37)"],
  ["Salary and benefits", "(2,987,260)", "248.94"],
  ["Medical supplies and services", "12,316,248", "35.5%"],
  ["Management fees", "0", ""],
  ["Case volume", "12000", ""],
  ["Total expenses", "15,303,508", ""],
  ["Marketing", "50,000", ""],
]

const EXPECTED_LINE_ITEMS = {
  standardBillingRevenue: 267441411,
  contractualAdjustment: 235348442,
  salaryBenefits: 2987260,
  medicalSupplies: 12316248,
  smallEquipment: 0,
  officeExpenses: 0,
  legal: 0,
  computerServices: 0,
  managementFees: 0,
  billingCollection: 0,
  otherOutsideServices: 0,
  insurance: 0,
  administrative: 0,
  rentTiUtilities: 0,
  otherFacility: 0,
  repairsMaintenance: 0,
  propTax: 0,
  stateTaxes: 0,
  softwareMaintenance: 0,
  equipRentInterestOther: 0,
  caseVolume: 12000,
}

const EXPECTED_MATCHED = [
  "standardBillingRevenue",
  "contractualAdjustment",
  "salaryBenefits",
  "medicalSupplies",
  "managementFees",
  "caseVolume",
]

describe("ingestProformaMatrix", () => {
  it("upserts parsed line items for a connected facility, scoped through the vendor-related predicate", async () => {
    const result = await ingestProformaMatrix(STATEMENT, { fileName: "pl.xlsx", facilityId: "fac-1" })
    expect(facilityFindFirst).toHaveBeenCalledWith(facilityScopeWhere("fac-1"))
    const data = {
      facilityId: "fac-1",
      facilityLabel: "Lighthouse Surgical Center",
      fileName: "pl.xlsx",
      lineItems: EXPECTED_LINE_ITEMS,
      matchedFields: EXPECTED_MATCHED,
      uploadedBy: USER_ID,
    }
    expect(proformaUpsert).toHaveBeenCalledWith({
      where: { vendorId_facilityKey: { vendorId: VENDOR_ID, facilityKey: "facility:fac-1" } },
      create: { vendorId: VENDOR_ID, facilityKey: "facility:fac-1", ...data },
      update: data,
    })
    expect(result).toEqual({
      facilityKey: "facility:fac-1",
      facilityLabel: "Lighthouse Surgical Center",
      matchedCount: 6,
      unmatchedLabels: ["Marketing"],
      lineItems: EXPECTED_LINE_ITEMS,
    })
  })

  it("upserts an ad-hoc prospect statement without a facility lookup", async () => {
    await ingestProformaMatrix(STATEMENT, { fileName: "pl.csv", adhocName: "Northside ASC" })
    expect(facilityFindFirst).not.toHaveBeenCalled()
    const call = proformaUpsert.mock.calls[0]![0] as { where: unknown; create: Record<string, unknown> }
    expect(call.where).toEqual({ vendorId_facilityKey: { vendorId: VENDOR_ID, facilityKey: "adhoc:northside asc" } })
    expect(call.create).toMatchObject({ facilityId: null, facilityLabel: "Northside ASC" })
  })

  it("refuses a facility outside the vendor's relationships", async () => {
    facilityFindFirst.mockResolvedValue(null)
    await expect(ingestProformaMatrix(STATEMENT, { fileName: "pl.csv", facilityId: "fac-other" })).rejects.toThrow("Facility not found")
    expect(proformaUpsert).not.toHaveBeenCalled()
  })

  it("rejects a statement missing required lines with the recognized count and the missing fields", async () => {
    const thin = [
      ["Revenue - standard billing rate", "100"],
      ["Salary and benefits", "10"],
    ]
    await expect(ingestProformaMatrix(thin, { fileName: "pl.csv", adhocName: "N" })).rejects.toThrow(
      "Only 2 P&L lines were recognized (missing medicalSupplies).",
    )
    expect(proformaUpsert).not.toHaveBeenCalled()
  })

  it("rejects more than 5,000 matrix rows", async () => {
    const big = Array.from({ length: 5_001 }, () => ["x", "1"])
    await expect(ingestProformaMatrix(big, { fileName: "pl.csv", adhocName: "N" })).rejects.toThrow(
      "The file has 5,001 rows; a P&L statement should be well under 5,000",
    )
  })

  it("rejects an empty matrix", async () => {
    await expect(ingestProformaMatrix([], { fileName: "pl.csv", adhocName: "N" })).rejects.toThrow("The file contains no rows")
  })

  it("rejects out-of-range amounts", async () => {
    const huge = STATEMENT.map((r) => (r[0] === "Medical supplies and services" ? [r[0]!, "9".repeat(15)] : r))
    await expect(ingestProformaMatrix(huge, { fileName: "pl.csv", adhocName: "N" })).rejects.toThrow("out-of-range amounts")
    expect(proformaUpsert).not.toHaveBeenCalled()
  })

  it("stops at the read-only write gate", async () => {
    vi.mocked(requireCanMutate).mockRejectedValue(new AccessDeniedError("Read-only"))
    await expect(ingestProformaMatrix(STATEMENT, { fileName: "pl.csv", facilityId: "fac-1" })).rejects.toThrow("Read-only")
    expect(facilityFindFirst).not.toHaveBeenCalled()
    expect(proformaUpsert).not.toHaveBeenCalled()
  })

  it("logs and rewraps a failed upsert", async () => {
    proformaUpsert.mockRejectedValue(new Error("deadlock"))
    await expect(ingestProformaMatrix(STATEMENT, { fileName: "pl.csv", adhocName: "N" })).rejects.toThrow(
      "Failed to save the P&L statement",
    )
    expect(console.error).toHaveBeenCalledWith("[ingestProformaMatrix]", expect.any(Error), { vendorId: VENDOR_ID })
  })
})
