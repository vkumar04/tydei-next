import { describe, it, expect } from "vitest"
import {
  isContractDuplicate,
  type ContractForDuplicateCheck,
  type NewContractInput,
} from "../duplicate-check"

const d = (s: string) => new Date(s)

const baseInput = (overrides: Partial<NewContractInput> = {}): NewContractInput => ({
  vendorId: "vendor-1",
  contractType: "pricing",
  effectiveDate: d("2026-03-01"),
  expirationDate: d("2026-09-30"),
  facilityIds: ["fac-1"],
  ...overrides,
})

const baseExisting = (
  overrides: Partial<ContractForDuplicateCheck> = {},
): ContractForDuplicateCheck => ({
  id: "c-existing-1",
  vendorId: "vendor-1",
  contractType: "pricing",
  status: "active",
  effectiveDate: d("2026-01-01"),
  expirationDate: d("2026-12-31"),
  facilityIds: ["fac-1"],
  ...overrides,
})

describe("isContractDuplicate", () => {
  it("returns not-duplicate when existing list is empty", () => {
    expect(isContractDuplicate(baseInput(), [])).toEqual({ isDuplicate: false })
  })

  it("returns not-duplicate when vendor differs", () => {
    const res = isContractDuplicate(baseInput(), [
      baseExisting({ vendorId: "vendor-2" }),
    ])
    expect(res).toEqual({ isDuplicate: false })
  })

  it("returns not-duplicate when contract type differs", () => {
    const res = isContractDuplicate(baseInput(), [
      baseExisting({ contractType: "rebate" }),
    ])
    expect(res).toEqual({ isDuplicate: false })
  })

  it("returns not-duplicate when existing contract is inactive", () => {
    const res = isContractDuplicate(baseInput(), [
      baseExisting({ status: "expired" }),
    ])
    expect(res).toEqual({ isDuplicate: false })
    const res2 = isContractDuplicate(baseInput(), [
      baseExisting({ status: "draft" }),
    ])
    expect(res2).toEqual({ isDuplicate: false })
  })

  it("returns IS duplicate when vendor + type + facility + date-overlap all match", () => {
    const existing = baseExisting({ id: "c-conflict" })
    const res = isContractDuplicate(baseInput(), [existing])
    expect(res.isDuplicate).toBe(true)
    expect(res.conflictId).toBe("c-conflict")
    expect(res.reason).toMatch(/overlapping active contract/i)
  })

  it("returns not-duplicate when date ranges do not overlap", () => {
    const res = isContractDuplicate(
      baseInput({
        effectiveDate: d("2027-01-01"),
        expirationDate: d("2027-12-31"),
      }),
      [baseExisting()],
    )
    expect(res).toEqual({ isDuplicate: false })
  })

  it("returns not-duplicate when facility sets do not overlap", () => {
    const res = isContractDuplicate(baseInput({ facilityIds: ["fac-99"] }), [
      baseExisting({ facilityIds: ["fac-1", "fac-2"] }),
    ])
    expect(res).toEqual({ isDuplicate: false })
  })

  it("treats null expiration as indefinite and overlaps anything after effective", () => {
    // Existing contract effective 2026-01-01 with no expiration.
    const existing = baseExisting({ id: "c-forever", expirationDate: null })
    // New contract far in the future still conflicts.
    const res = isContractDuplicate(
      baseInput({
        effectiveDate: d("2030-01-01"),
        expirationDate: d("2030-06-30"),
      }),
      [existing],
    )
    expect(res.isDuplicate).toBe(true)
    expect(res.conflictId).toBe("c-forever")
  })

  it("treats null expiration on the NEW input as indefinite", () => {
    const existing = baseExisting({
      id: "c-2027",
      effectiveDate: d("2027-06-01"),
      expirationDate: d("2027-12-31"),
    })
    const res = isContractDuplicate(
      baseInput({ effectiveDate: d("2026-01-01"), expirationDate: null }),
      [existing],
    )
    expect(res.isDuplicate).toBe(true)
    expect(res.conflictId).toBe("c-2027")
  })

  it("returns the FIRST conflictId when multiple existing contracts match", () => {
    const res = isContractDuplicate(baseInput(), [
      baseExisting({ id: "c-first" }),
      baseExisting({ id: "c-second" }),
      baseExisting({ id: "c-third" }),
    ])
    expect(res.isDuplicate).toBe(true)
    expect(res.conflictId).toBe("c-first")
  })

  it("ignores inactive contracts even when everything else matches", () => {
    // Inactive candidate appears first; active candidate appears second.
    const res = isContractDuplicate(baseInput(), [
      baseExisting({ id: "c-inactive", status: "expired" }),
      baseExisting({ id: "c-active" }),
    ])
    expect(res.isDuplicate).toBe(true)
    expect(res.conflictId).toBe("c-active")
  })
})
