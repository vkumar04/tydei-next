import { describe, it, expect } from "vitest"
import {
  deriveSurgeons,
  type CaseForDerivation,
} from "../surgeon-derivation"

const mkCase = (p: Partial<CaseForDerivation>): CaseForDerivation => ({
  surgeonName: "Dr. Default",
  primaryCptCode: null,
  totalSpend: 0,
  totalReimbursement: 0,
  payorType: null,
  ...p,
})

describe("deriveSurgeons", () => {
  it("empty cases → empty surgeons", () => {
    expect(deriveSurgeons({ cases: [] })).toEqual([])
  })

  it("aggregates a single surgeon across 3 cases", () => {
    const cases: CaseForDerivation[] = [
      mkCase({
        surgeonName: "Dr. A",
        primaryCptCode: "27447",
        totalSpend: 10_000,
        totalReimbursement: 20_000,
        payorType: "commercial",
      }),
      mkCase({
        surgeonName: "Dr. A",
        primaryCptCode: "27130",
        totalSpend: 8_000,
        totalReimbursement: 16_000,
        payorType: "commercial",
      }),
      mkCase({
        surgeonName: "Dr. A",
        primaryCptCode: "27447",
        totalSpend: 12_000,
        totalReimbursement: 24_000,
        payorType: "private",
      }),
    ]

    const result = deriveSurgeons({ cases })
    expect(result).toHaveLength(1)
    const s = result[0]!

    expect(s.name).toBe("Dr. A")
    expect(s.caseCount).toBe(3)
    expect(s.totalSpend).toBe(30_000)
    expect(s.totalReimbursement).toBe(60_000)
    expect(s.avgSpendPerCase).toBe(10_000)
    expect(s.avgReimbursementPerCase).toBe(20_000)
    // (60_000 - 30_000) / 60_000 * 100 = 50
    expect(s.avgMarginPct).toBe(50)
    expect(s.cptCodes).toEqual(["27447", "27130"])
    expect(s.specialty).toBe("Orthopedics")
  })

  it("sorts multiple surgeons by overallScore desc, tie-break totalSpend desc", () => {
    const cases: CaseForDerivation[] = [
      // Dr. Low — all medicare, high spend → low score
      mkCase({
        surgeonName: "Dr. Low",
        primaryCptCode: "27447",
        totalSpend: 80_000,
        totalReimbursement: 90_000,
        payorType: "medicare",
      }),
      // Dr. High — commercial, low spend → high score
      mkCase({
        surgeonName: "Dr. High",
        primaryCptCode: "27447",
        totalSpend: 5_000,
        totalReimbursement: 20_000,
        payorType: "commercial",
      }),
    ]

    const result = deriveSurgeons({ cases })
    expect(result.map((s) => s.name)).toEqual(["Dr. High", "Dr. Low"])
    expect(result[0]!.overallScore).toBeGreaterThan(result[1]!.overallScore)
  })

  it("breaks overallScore ties by totalSpend desc", () => {
    // Two surgeons identical payor + spend-per-case profile, differing totalSpend.
    const mk = (name: string, n: number): CaseForDerivation[] =>
      Array.from({ length: n }, () =>
        mkCase({
          surgeonName: name,
          primaryCptCode: "27447",
          totalSpend: 10_000,
          totalReimbursement: 20_000,
          payorType: "commercial",
        }),
      )

    const cases = [...mk("Dr. Small", 1), ...mk("Dr. Big", 3)]
    const result = deriveSurgeons({ cases })

    expect(result[0]!.overallScore).toBe(result[1]!.overallScore)
    expect(result[0]!.name).toBe("Dr. Big")
    expect(result[1]!.name).toBe("Dr. Small")
  })

  it("skips cases with empty/null surgeonName", () => {
    const cases: CaseForDerivation[] = [
      mkCase({ surgeonName: "", primaryCptCode: "27447" }),
      mkCase({
        surgeonName: "Dr. Real",
        primaryCptCode: "27447",
        totalSpend: 1_000,
        totalReimbursement: 2_000,
        payorType: "commercial",
      }),
    ]
    const result = deriveSurgeons({ cases })
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe("Dr. Real")
  })

  it("surgeon with only medicare → commercialOrPrivatePayors = 0", () => {
    const cases: CaseForDerivation[] = [
      mkCase({
        surgeonName: "Dr. Med",
        primaryCptCode: "27447",
        totalSpend: 1_000,
        totalReimbursement: 2_000,
        payorType: "medicare",
      }),
      mkCase({
        surgeonName: "Dr. Med",
        primaryCptCode: "27447",
        totalSpend: 1_000,
        totalReimbursement: 2_000,
        payorType: "medicare",
      }),
    ]
    const [s] = deriveSurgeons({ cases })
    expect(s!.commercialOrPrivatePayors).toBe(0)
    expect(s!.totalPayors).toBe(1)
    expect(s!.payorMixScore).toBe(0)
  })

  it("surgeon with commercial + medicare → commercialOrPrivatePayors=1, totalPayors=2", () => {
    const cases: CaseForDerivation[] = [
      mkCase({
        surgeonName: "Dr. Mix",
        primaryCptCode: "27447",
        payorType: "commercial",
      }),
      mkCase({
        surgeonName: "Dr. Mix",
        primaryCptCode: "27447",
        payorType: "medicare",
      }),
    ]
    const [s] = deriveSurgeons({ cases })
    expect(s!.commercialOrPrivatePayors).toBe(1)
    expect(s!.totalPayors).toBe(2)
    expect(s!.payorMixScore).toBe(50)
  })

  it("counts distinct payor types only (no double-count)", () => {
    // 5 cases, 3 commercial + 2 medicare → distinct=2 (1 comm/priv + 1 not)
    const cases: CaseForDerivation[] = [
      mkCase({ surgeonName: "Dr. D", payorType: "commercial" }),
      mkCase({ surgeonName: "Dr. D", payorType: "commercial" }),
      mkCase({ surgeonName: "Dr. D", payorType: "commercial" }),
      mkCase({ surgeonName: "Dr. D", payorType: "medicare" }),
      mkCase({ surgeonName: "Dr. D", payorType: "medicare" }),
    ]
    const [s] = deriveSurgeons({ cases })
    expect(s!.totalPayors).toBe(2)
    expect(s!.commercialOrPrivatePayors).toBe(1)
  })

  it("ignores null payor types when tallying totalPayors", () => {
    const cases: CaseForDerivation[] = [
      mkCase({ surgeonName: "Dr. N", payorType: null }),
      mkCase({ surgeonName: "Dr. N", payorType: "commercial" }),
    ]
    const [s] = deriveSurgeons({ cases })
    expect(s!.totalPayors).toBe(1)
    expect(s!.commercialOrPrivatePayors).toBe(1)
  })

  it("collects unique CPT codes per surgeon (no duplicates, no nulls)", () => {
    const cases: CaseForDerivation[] = [
      mkCase({
        surgeonName: "Dr. CPT",
        primaryCptCode: "27447",
        payorType: "commercial",
      }),
      mkCase({
        surgeonName: "Dr. CPT",
        primaryCptCode: "27447",
        payorType: "commercial",
      }),
      mkCase({
        surgeonName: "Dr. CPT",
        primaryCptCode: "29881",
        payorType: "commercial",
      }),
      mkCase({
        surgeonName: "Dr. CPT",
        primaryCptCode: null,
        payorType: "commercial",
      }),
    ]
    const [s] = deriveSurgeons({ cases })
    expect(s!.cptCodes).toEqual(["27447", "29881"])
  })

  it("infers specialty from the dominant CPT prefix", () => {
    const cases: CaseForDerivation[] = [
      // 2 spine + 1 ortho → dominant = Spine
      mkCase({
        surgeonName: "Dr. Spine",
        primaryCptCode: "22551",
        payorType: "commercial",
      }),
      mkCase({
        surgeonName: "Dr. Spine",
        primaryCptCode: "63030",
        payorType: "commercial",
      }),
      mkCase({
        surgeonName: "Dr. Spine",
        primaryCptCode: "27447",
        payorType: "commercial",
      }),
    ]
    const [s] = deriveSurgeons({ cases })
    // cptCodes are unique; dominant is inferred from the unique list.
    // Unique: 22551 (spine), 63030 (spine), 27447 (ortho) → Spine
    expect(s!.specialty).toBe("Spine")
  })

  it("safe avgMarginPct when reimbursement is zero", () => {
    const cases: CaseForDerivation[] = [
      mkCase({
        surgeonName: "Dr. Zero",
        primaryCptCode: "27447",
        totalSpend: 1_000,
        totalReimbursement: 0,
        payorType: "commercial",
      }),
    ]
    const [s] = deriveSurgeons({ cases })
    expect(s!.avgMarginPct).toBe(0)
  })
})
