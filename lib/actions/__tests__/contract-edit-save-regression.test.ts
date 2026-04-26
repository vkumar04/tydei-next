import { describe, it, expect, vi, beforeEach } from "vitest"

// Charles W1.Y-A — the contract-edit flow persists "only the beginning
// values" on reload. W1.W-E (commit 19b38ab) fixed contractType flips +
// adding a brand-new term, but other field domains are still dropped.
//
// This test mirrors the save sequence the edit-contract client runs
// (updateContract → updateContractTerm → upsertContractTiers per term)
// and asserts that every field domain the form can edit lands in the
// corresponding prisma call. A drop in ANY domain fails the test for
// that specific field — the failed assertion names it so the
// diagnostic row of "which field domain reverts" is self-documenting.
//
// Domains covered:
//   - Contract scalar (name, description, dates, values, cadence, flags)
//   - Contract multi-facility + category joins
//   - Contract tie-in capital (W1.T — 6 columns on Contract)
//   - Contract amortization shape (symmetrical vs custom)
//   - Contract `additionalFacilityIds` (multi-facility picker)
//   - Term scalar (evaluationPeriod, paymentTiming, appliesTo,
//     rebateMethod, baselines, scope)
//   - Tier (spendMin, spendMax, volumeMin/Max, rebateType, rebateValue)

const {
  contractFindUniqueOrThrowMock,
  contractFindUniqueMock,
  contractUpdateMock,
  facilityDeleteManyMock,
  facilityCreateManyMock,
  categoryDeleteManyMock,
  categoryCreateManyMock,
  amortDeleteManyMock,
  amortCreateManyMock,
  termUpdateMock,
  termFindUniqueMock,
  tierDeleteManyMock,
  tierCreateMock,
  termProductDeleteManyMock,
  termProductCreateManyMock,
  logAuditMock,
  recomputeVendorMock,
  recomputeScoreMock,
  recomputeAccrualMock,
} = vi.hoisted(() => ({
  contractFindUniqueOrThrowMock: vi.fn(),
  contractFindUniqueMock: vi.fn().mockResolvedValue({
    facilityId: "fac-1",
    contractFacilities: [],
  }),
  contractUpdateMock: vi.fn(),
  facilityDeleteManyMock: vi.fn(),
  facilityCreateManyMock: vi.fn(),
  categoryDeleteManyMock: vi.fn(),
  categoryCreateManyMock: vi.fn(),
  amortDeleteManyMock: vi.fn(),
  amortCreateManyMock: vi.fn(),
  termUpdateMock: vi.fn(),
  termFindUniqueMock: vi.fn(),
  tierDeleteManyMock: vi.fn(),
  tierCreateMock: vi.fn(),
  termProductDeleteManyMock: vi.fn(),
  termProductCreateManyMock: vi.fn(),
  logAuditMock: vi.fn(),
  recomputeVendorMock: vi.fn(),
  recomputeScoreMock: vi.fn(),
  recomputeAccrualMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: contractFindUniqueOrThrowMock,
      findUnique: contractFindUniqueMock,
      update: contractUpdateMock,
    },
    contractFacility: {
      deleteMany: facilityDeleteManyMock,
      createMany: facilityCreateManyMock,
    },
    contractProductCategory: {
      deleteMany: categoryDeleteManyMock,
      createMany: categoryCreateManyMock,
    },
    contractAmortizationSchedule: {
      deleteMany: amortDeleteManyMock,
      createMany: amortCreateManyMock,
    },
    contractTerm: {
      update: termUpdateMock,
      findUnique: termFindUniqueMock,
      // Round-9 BLOCKER: contract-terms ownership check.
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ contractId: "c-1" }),
    },
    contractTier: {
      deleteMany: tierDeleteManyMock,
      create: tierCreateMock,
    },
    contractTermProduct: {
      deleteMany: termProductDeleteManyMock,
      createMany: termProductCreateManyMock,
    },
    productCategory: {
      // resolveCategoryIdsToNames calls findMany. Empty mock is fine —
      // the resolver falls through to pass-through when nothing matches.
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))
vi.mock("@/lib/audit", () => ({
  logAudit: logAuditMock,
}))
vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: recomputeVendorMock,
}))
vi.mock("@/lib/actions/contracts/scoring", () => ({
  recomputeContractScore: recomputeScoreMock,
}))
vi.mock("@/lib/actions/contracts/recompute-accrual", () => ({
  recomputeAccrualForContract: recomputeAccrualMock,
}))
vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(v: T) => v,
}))
vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: (id: string) => ({ id }),
  contractsOwnedByFacility: () => ({}),
  facilityScopeClause: () => ({}),
}))
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

import { updateContract } from "@/lib/actions/contracts"
import {
  updateContractTerm,
  upsertContractTiers,
} from "@/lib/actions/contract-terms"

// "Beginning" row as loaded by the edit form. All asserted edits below
// are DIFFERENT from these baseline values.
const baseline = {
  id: "c-1",
  vendorId: "v-1",
  contractType: "tie_in" as const,
  name: "BEGINNING-NAME",
  capitalCost: 100_000,
  downPayment: 0,
  interestRate: 0.05,
  termMonths: 36,
  paymentCadence: "monthly" as const,
  amortizationShape: "symmetrical" as const,
}

beforeEach(() => {
  vi.clearAllMocks()
  contractFindUniqueOrThrowMock.mockResolvedValue({ id: baseline.id })
  contractUpdateMock.mockImplementation(({ data }) =>
    Promise.resolve({ ...baseline, ...data }),
  )
  termUpdateMock.mockResolvedValue({
    id: "term-1",
    contractId: baseline.id,
    tiers: [],
  })
  termFindUniqueMock.mockResolvedValue({ contractId: baseline.id })
  tierDeleteManyMock.mockResolvedValue({ count: 0 })
  tierCreateMock.mockImplementation(({ data }) =>
    Promise.resolve({ id: "tier-new", ...data }),
  )
  facilityDeleteManyMock.mockResolvedValue({ count: 0 })
  facilityCreateManyMock.mockResolvedValue({ count: 0 })
  categoryDeleteManyMock.mockResolvedValue({ count: 0 })
  categoryCreateManyMock.mockResolvedValue({ count: 0 })
  amortDeleteManyMock.mockResolvedValue({ count: 0 })
  amortCreateManyMock.mockResolvedValue({ count: 0 })
  termProductDeleteManyMock.mockResolvedValue({ count: 0 })
  termProductCreateManyMock.mockResolvedValue({ count: 0 })
  logAuditMock.mockResolvedValue(undefined)
  recomputeVendorMock.mockResolvedValue(undefined)
  recomputeScoreMock.mockResolvedValue(undefined)
  recomputeAccrualMock.mockResolvedValue({ deleted: 0, inserted: 0 })
})

describe("contract edit save persists every field domain", () => {
  it("persists every field domain on a contract edit (Charles iMessage 2026-04-20)", async () => {
    // STEP 1 — mirror `handleSave`'s contract-level update. This is
    // `await updateMutation.mutateAsync({ id, data: {...values, ...capital} })`.
    await updateContract("c-1", {
      // BASIC info
      name: "EDITED-NAME",
      contractNumber: "EDITED-123",
      vendorId: "v-2",
      contractType: "tie_in",
      status: "active",
      description: "Edited description",
      notes: "Edited notes",
      gpoAffiliation: "HPG",

      // Dates + renewal
      effectiveDate: "2025-01-01",
      expirationDate: "2028-01-01",
      autoRenewal: true,
      terminationNoticeDays: 60,

      // Value / rebate policy
      totalValue: 1_234_567,
      annualValue: 411_522.33,
      performancePeriod: "quarterly",
      rebatePayPeriod: "quarterly",

      // Scope — multi-facility + categories
      isMultiFacility: true,
      isGrouped: false,
      facilityIds: ["fac-1", "fac-2"],
      additionalFacilityIds: ["fac-3"],
      categoryIds: ["cat-1", "cat-2"],

      // Charles audit suggestion #4 (v0-port): legacy capital fields
      // removed from updateContract — capital lives in
      // ContractCapitalLineItem rows now. Only amortizationShape
      // survives at the contract level.
      amortizationShape: "symmetrical",
    })

    // STEP 2 — mirror `handleSave`'s per-term update loop. This is
    // `await updateContractTerm(term.id, {...})`.
    await updateContractTerm("term-1", {
      termName: "EDITED-TERM",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "quarterly",
      paymentTiming: "annual",
      appliesTo: "specific_categories",
      rebateMethod: "marginal",
      effectiveStart: "2025-01-01",
      effectiveEnd: "2028-01-01",
      spendBaseline: 100_000,
      volumeBaseline: 999,
      growthBaselinePercent: 12.5,
      desiredMarketShare: 65,
      scopedCategoryIds: ["cat-1"],
      minimumPurchaseCommitment: 250_000,
    })

    // STEP 3 — mirror `handleSave`'s `upsertContractTiers(term.id, term.tiers)`.
    await upsertContractTiers("term-1", [
      {
        tierNumber: 1,
        spendMin: 0,
        spendMax: 500_000,
        rebateType: "percent_of_spend",
        rebateValue: 0.05,
      },
      {
        tierNumber: 2,
        spendMin: 500_000,
        rebateType: "percent_of_spend",
        rebateValue: 0.07,
      },
    ])

    // ───────────────────────────────────────────────────────────
    // Assertions per domain — a failed line names the dropped field.
    // ───────────────────────────────────────────────────────────

    // Contract-level: exactly one update, with every domain in data.
    expect(contractUpdateMock).toHaveBeenCalledTimes(1)
    const contractData = contractUpdateMock.mock.calls[0][0].data as Record<
      string,
      unknown
    >

    // Contract scalar — BASIC info
    expect(contractData.name).toBe("EDITED-NAME")
    expect(contractData.contractNumber).toBe("EDITED-123")
    expect(contractData.contractType).toBe("tie_in")
    expect(contractData.status).toBe("active")
    expect(contractData.description).toBe("Edited description")
    expect(contractData.notes).toBe("Edited notes")
    expect(contractData.gpoAffiliation).toBe("HPG")

    // Contract scalar — dates + renewal
    expect((contractData.effectiveDate as Date).toISOString().slice(0, 10)).toBe(
      "2025-01-01",
    )
    expect(
      (contractData.expirationDate as Date).toISOString().slice(0, 10),
    ).toBe("2028-01-01")
    expect(contractData.autoRenewal).toBe(true)
    expect(contractData.terminationNoticeDays).toBe(60)

    // Contract scalar — value / rebate policy
    expect(contractData.totalValue).toBe(1_234_567)
    expect(contractData.annualValue).toBe(411_522.33)
    expect(contractData.performancePeriod).toBe("quarterly")
    expect(contractData.rebatePayPeriod).toBe("quarterly")

    // Contract scalar — flags
    expect(contractData.isGrouped).toBe(false)
    expect(contractData.isMultiFacility).toBeDefined()

    // Capital / amortization — only amortizationShape survives at the
    // contract level after the v0-port (line items own the rest).
    expect(contractData.amortizationShape).toBe("symmetrical")

    // Multi-facility + category join tables — deleteMany + createMany
    // with the right row counts means both domains landed.
    expect(facilityCreateManyMock).toHaveBeenCalledWith({
      data: [
        { contractId: "c-1", facilityId: "fac-1" },
        { contractId: "c-1", facilityId: "fac-2" },
      ],
    })
    expect(categoryCreateManyMock).toHaveBeenCalledWith({
      data: [
        { contractId: "c-1", productCategoryId: "cat-1" },
        { contractId: "c-1", productCategoryId: "cat-2" },
      ],
    })

    // `additionalFacilityIds` — the multi-facility picker's companion
    // array. createContract persists these via ContractFacility.createMany
    // (lib/actions/contracts.ts:703). updateContract does NOT — so any
    // facility the user added on edit via that picker reverts to the
    // "beginning" on reload. This is the field-domain drop Charles hit.
    // The assertion below fails on current main: facilityCreateMany is
    // called ONCE with the facilityIds array only, and no second call
    // carries fac-3.
    const facilityCreateCalls = facilityCreateManyMock.mock.calls.map(
      (c) => c[0] as { data: Array<{ facilityId: string }> },
    )
    const allAddedFacilityIds = facilityCreateCalls.flatMap((c) =>
      c.data.map((row) => row.facilityId),
    )
    expect(allAddedFacilityIds).toContain("fac-3")

    // Term-level: exactly one update, with every term-scalar domain.
    expect(termUpdateMock).toHaveBeenCalledTimes(1)
    const termData = termUpdateMock.mock.calls[0][0].data as Record<
      string,
      unknown
    >
    expect(termData.termName).toBe("EDITED-TERM")
    expect(termData.termType).toBe("spend_rebate")
    expect(termData.baselineType).toBe("spend_based")
    expect(termData.evaluationPeriod).toBe("quarterly")
    expect(termData.paymentTiming).toBe("annual")
    expect(termData.appliesTo).toBe("specific_categories")
    expect(termData.rebateMethod).toBe("marginal")
    expect((termData.effectiveStart as Date).toISOString().slice(0, 10)).toBe(
      "2025-01-01",
    )
    expect((termData.effectiveEnd as Date).toISOString().slice(0, 10)).toBe(
      "2028-01-01",
    )
    expect(termData.spendBaseline).toBe(100_000)
    expect(termData.volumeBaseline).toBe(999)
    expect(termData.growthBaselinePercent).toBe(12.5)
    expect(termData.desiredMarketShare).toBe(65)
    expect(termData.minimumPurchaseCommitment).toBe(250_000)
    // `scopedCategoryIds` is persisted via the `categories` column on
    // ContractTerm (see contract-terms.ts:197-199). Assert that column
    // round-trips — a drop here means the scope picker reverts.
    expect(termData.categories).toEqual(["cat-1"])

    // Tier-level: exactly two creates after one deleteMany.
    expect(tierDeleteManyMock).toHaveBeenCalledWith({
      where: { termId: "term-1" },
    })
    expect(tierCreateMock).toHaveBeenCalledTimes(2)
    const tier1 = tierCreateMock.mock.calls[0][0].data as Record<string, unknown>
    const tier2 = tierCreateMock.mock.calls[1][0].data as Record<string, unknown>
    expect(tier1.tierNumber).toBe(1)
    expect(tier1.spendMin).toBe(0)
    expect(tier1.spendMax).toBe(500_000)
    expect(tier1.rebateType).toBe("percent_of_spend")
    expect(tier1.rebateValue).toBe(0.05)
    expect(tier2.tierNumber).toBe(2)
    expect(tier2.spendMin).toBe(500_000)
    expect(tier2.rebateValue).toBe(0.07)
  })
})
