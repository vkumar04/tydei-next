import { describe, it, expect } from "vitest"
import {
  parsePayorVolumeRows,
  getPayorTrend,
  type PayorProcedureGroup,
} from "../parse-payor-volume-rows"
import {
  SAMPLE_PAYOR_VOLUME_DATASET,
  SAMPLE_FACILITY_KEY,
} from "../sample-dataset"

const row = (
  group: string,
  year: number | string,
  quarter: number | string,
  volume: number | string,
): Record<string, string> => ({
  "Procedure Group": String(group),
  Year: String(year),
  Quarter: String(quarter),
  Volume: String(volume),
})

describe("parsePayorVolumeRows", () => {
  it("parses canonical columns into sorted quarterly groups", () => {
    const { groups, periods, totalAnnualizedVolume } = parsePayorVolumeRows([
      row("Total Knee Replacement", 2025, 3, 120),
      row("Total Knee Replacement", 2025, 2, 110),
      row("Total Knee Replacement", 2025, 4, 130),
      row("Total Knee Replacement", 2026, 1, 140),
      row("Shoulder", 2025, 4, 40),
    ])
    expect(groups).toHaveLength(2)
    const knee = groups[0]
    expect(knee.group).toBe("Total Knee Replacement")
    expect(knee.quarters.map((q) => `${q.year}-Q${q.quarter}`)).toEqual([
      "2025-Q2",
      "2025-Q3",
      "2025-Q4",
      "2026-Q1",
    ])
    // Four quarters → annualized = trailing-four sum.
    expect(knee.annualizedVolume).toBe(500)
    expect(knee.totalVolume).toBe(500)
    expect(periods).toEqual(["2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1"])
    // Shoulder has one quarter → scaled ×4.
    expect(groups[1].annualizedVolume).toBe(160)
    expect(totalAnnualizedVolume).toBe(660)
  })

  it("tolerates header variants and 'Q2'-style quarter values", () => {
    const { groups } = parsePayorVolumeRows([
      {
        Category: "Wrist",
        "Fiscal Year": "2025",
        Qtr: "Q3",
        "Case Volume": "25",
      },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].quarters[0]).toEqual({ year: 2025, quarter: 3, volume: 25 })
  })

  it("sums duplicate (group, quarter) rows", () => {
    const { groups } = parsePayorVolumeRows([
      row("Hand", 2025, 1, 10),
      row("Hand", 2025, 1, 15),
    ])
    expect(groups[0].quarters).toHaveLength(1)
    expect(groups[0].quarters[0].volume).toBe(25)
  })

  it("strips currency/comma noise from numbers and skips unusable rows", () => {
    const { groups } = parsePayorVolumeRows([
      row("Spine", 2025, 2, "1,204"),
      row("", 2025, 2, 50), // no group
      row("Spine", "", 2, 50), // no year
      row("Spine", 2025, "", 50), // no quarter
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].quarters[0].volume).toBe(1_204)
  })

  it("annualizes >4 quarters from the trailing four only", () => {
    const { groups } = parsePayorVolumeRows([
      row("Hip", 2024, 4, 1_000), // stale quarter, must not count
      row("Hip", 2025, 1, 100),
      row("Hip", 2025, 2, 100),
      row("Hip", 2025, 3, 100),
      row("Hip", 2025, 4, 100),
    ])
    expect(groups[0].annualizedVolume).toBe(400)
    expect(groups[0].totalVolume).toBe(1_400)
  })

  it("sorts groups by annualized volume descending", () => {
    const { groups } = parsePayorVolumeRows([
      row("Small", 2025, 1, 10),
      row("Big", 2025, 1, 100),
    ])
    expect(groups.map((g) => g.group)).toEqual(["Big", "Small"])
  })
})

describe("getPayorTrend", () => {
  const mk = (volumes: number[]): PayorProcedureGroup => ({
    group: "G",
    quarters: volumes.map((v, i) => ({ year: 2025, quarter: i + 1, volume: v })),
    totalVolume: volumes.reduce((s, v) => s + v, 0),
    annualizedVolume: 0,
  })

  it("computes latest-vs-first change percent", () => {
    expect(getPayorTrend(mk([100, 110, 121]))).toEqual({
      changePercent: 21,
      direction: "up",
    })
    expect(getPayorTrend(mk([100, 80])).direction).toBe("down")
  })

  it("flat when <2 quarters, first quarter is zero, or within ±1%", () => {
    expect(getPayorTrend(mk([100])).direction).toBe("flat")
    expect(getPayorTrend(mk([0, 50])).direction).toBe("flat")
    expect(getPayorTrend(mk([100, 100.5])).direction).toBe("flat")
  })
})

describe("sample dataset", () => {
  it("exposes the East Coast sample under the sample key", () => {
    expect(SAMPLE_PAYOR_VOLUME_DATASET.facilityKey).toBe(SAMPLE_FACILITY_KEY)
    expect(SAMPLE_PAYOR_VOLUME_DATASET.groups.length).toBeGreaterThan(0)
    // Internal consistency: totalAnnualizedVolume = Σ group annualized.
    const sum = SAMPLE_PAYOR_VOLUME_DATASET.groups.reduce(
      (s, g) => s + g.annualizedVolume,
      0,
    )
    expect(SAMPLE_PAYOR_VOLUME_DATASET.totalAnnualizedVolume).toBe(sum)
  })
})
