import { describe, it, expect } from "vitest"
import { parseMedicareRateRows } from "../parse-medicare-rate-rows"
import {
  resolveMedicareAscRate,
  listEffectiveMedicareRates,
  getAllMedicareAscRates,
} from "../medicare-asc-rates"

const row = (
  group: string,
  code: string,
  rate: string,
): Record<string, string> => ({
  "Procedure Group": group,
  "CPT Code": code,
  Rate: rate,
})

describe("parseMedicareRateRows", () => {
  it("parses group / code / rate rows", () => {
    const { rates, skipped } = parseMedicareRateRows([
      row("Total Knee Replacement", "CPT 27447", "$9,750.00"),
      row("Total Hip Replacement", "CPT 27130", "9941"),
    ])
    expect(skipped).toBe(0)
    expect(rates).toEqual([
      { group: "Total Knee Replacement", code: "CPT 27447", medicareRate: 9750 },
      { group: "Total Hip Replacement", code: "CPT 27130", medicareRate: 9941 },
    ])
  })

  it("tolerates header naming variants", () => {
    const { rates } = parseMedicareRateRows([
      { Category: "Shoulder", HCPCS: "29826", "Payment Rate": "4,050" },
    ])
    expect(rates[0]).toMatchObject({
      group: "Shoulder",
      code: "29826",
      medicareRate: 4050,
    })
  })

  it("keeps an explicit $0 rate (packaged add-on codes are real)", () => {
    const { rates, skipped } = parseMedicareRateRows([
      row("Computer Assisted Nav", "CPT 20985", "0"),
    ])
    expect(skipped).toBe(0)
    expect(rates[0].medicareRate).toBe(0)
  })

  it("carries an optional note column through", () => {
    const { rates } = parseMedicareRateRows([
      {
        "Procedure Group": "Orthovisc",
        CPT: "J7324",
        Rate: "925",
        Note: "ASP-based, per course",
      },
    ])
    expect(rates[0].note).toBe("ASP-based, per course")
  })

  it("defaults a missing code rather than dropping the row", () => {
    const { rates } = parseMedicareRateRows([
      { "Procedure Group": "Mini Frag", Rate: "3,300" },
    ])
    expect(rates[0]).toMatchObject({ group: "Mini Frag", code: "—", medicareRate: 3300 })
  })

  it("skips rows with no group, no rate, or an unusable rate", () => {
    const { rates, skipped } = parseMedicareRateRows([
      row("", "CPT 1", "100"),
      row("No Rate", "CPT 2", ""),
      row("Negative", "CPT 3", "-50"),
      row("Absurd", "CPT 4", "99999999"),
      row("Good", "CPT 5", "100"),
    ])
    expect(rates).toHaveLength(1)
    expect(rates[0].group).toBe("Good")
    expect(skipped).toBe(4)
  })

  it("last row wins on a duplicate group (a correction supersedes)", () => {
    const { rates } = parseMedicareRateRows([
      row("Total Knee Replacement", "CPT 27447", "9000"),
      row("total knee replacement", "CPT 27447", "9750"),
    ])
    expect(rates).toHaveLength(1)
    expect(rates[0].medicareRate).toBe(9750)
  })
})

describe("resolveMedicareAscRate — uploaded set shadows the built-in", () => {
  const uploaded = parseMedicareRateRows([
    row("Total Knee Replacement", "CPT 27447", "9750"),
  ]).rates

  it("prefers the uploaded rate for a group it covers", () => {
    // Built-in CY2025 is $9,450; the uploaded CY2026 table wins.
    expect(resolveMedicareAscRate("Total Knee Replacement", { uploaded })?.medicareRate).toBe(
      9750,
    )
  })

  it("falls back to the built-in for a group the upload omits", () => {
    expect(resolveMedicareAscRate("Total Hip Replacement", { uploaded })?.medicareRate).toBe(
      9641,
    )
  })

  it("matches case-insensitively against the uploaded set", () => {
    expect(resolveMedicareAscRate("TOTAL KNEE REPLACEMENT", { uploaded })?.medicareRate).toBe(
      9750,
    )
  })

  it("uses the built-in table when no set is supplied", () => {
    expect(resolveMedicareAscRate("Total Knee Replacement", {})?.medicareRate).toBe(9450)
    expect(resolveMedicareAscRate("Total Knee Replacement", { uploaded: [] })?.medicareRate).toBe(9450)
  })

  it("returns undefined for a group in neither", () => {
    expect(resolveMedicareAscRate("Not A Group", { uploaded })).toBeUndefined()
  })
})

describe("parseMedicareRateRows — audit regressions", () => {
  it("skips a non-numeric rate rather than installing a fabricated $0", () => {
    // parseMoney("N/A") is 0; storing that would shadow the correct built-in
    // rate with a real-looking $0 and silently zero the reimbursement.
    const { rates, skipped } = parseMedicareRateRows([
      row("Total Knee Replacement", "CPT 27447", "N/A"),
      row("Total Hip Replacement", "CPT 27130", "—"),
    ])
    expect(rates).toHaveLength(0)
    expect(skipped).toBe(2)
  })

  it("ignores a percent column when picking the dollar rate", () => {
    const { rates } = parseMedicareRateRows([
      {
        "Procedure Group": "Total Knee Replacement",
        CPT: "27447",
        "Rate % change": "2.9%",
        "Payment Rate": "9,750",
      },
    ])
    expect(rates[0].medicareRate).toBe(9_750)
  })

  it("skips a rate cell that is itself a percentage", () => {
    const { rates, skipped } = parseMedicareRateRows([
      row("Total Knee Replacement", "CPT 27447", "2.9%"),
    ])
    expect(rates).toHaveLength(0)
    expect(skipped).toBe(1)
  })
})

// ─── Three-tier precedence (Charles 2026-08-11) ──────────────────
// A hand-entered authoritative rate beats an uploaded table, which beats the
// built-in estimate. Every surface resolves through this one function, so a
// precedence bug would silently disagree between the card and the engine.

describe("resolveMedicareAscRate — authoritative > uploaded > estimate", () => {
  const uploaded = parseMedicareRateRows([
    row("Total Knee Replacement", "CPT 27447", "9750"),
    row("Total Hip Replacement", "CPT 27130", "9941"),
  ]).rates
  const overrides = [
    { group: "Total Knee Replacement", code: "CPT 27447", medicareRate: 10_200 },
  ]

  it("a hand-entered override wins over an uploaded table", () => {
    const r = resolveMedicareAscRate("Total Knee Replacement", {
      overrides,
      uploaded,
    })
    expect(r?.medicareRate).toBe(10_200)
    expect(r?.source).toBe("authoritative")
  })

  it("an uploaded row wins where there is no override", () => {
    const r = resolveMedicareAscRate("Total Hip Replacement", {
      overrides,
      uploaded,
    })
    expect(r?.medicareRate).toBe(9_941)
    expect(r?.source).toBe("uploaded")
  })

  it("the built-in estimate applies where neither covers the group", () => {
    const r = resolveMedicareAscRate("Shoulder", { overrides, uploaded })
    expect(r?.medicareRate).toBe(3_950)
    expect(r?.source).toBe("estimate")
  })

  it("matches case- and whitespace-insensitively at every tier", () => {
    expect(
      resolveMedicareAscRate("  total knee replacement ", { overrides, uploaded })
        ?.source,
    ).toBe("authoritative")
    expect(
      resolveMedicareAscRate("TOTAL HIP REPLACEMENT", { overrides, uploaded })
        ?.source,
    ).toBe("uploaded")
  })

  it("an override for a group in no table at all still resolves", () => {
    const r = resolveMedicareAscRate("Total Ankle Replacement", {
      overrides: [
        { group: "Total Ankle Replacement", code: "CPT 27702", medicareRate: 12_000 },
      ],
    })
    expect(r).toMatchObject({ medicareRate: 12_000, source: "authoritative" })
  })

  it("a display label never affects group matching", () => {
    const r = resolveMedicareAscRate("Total Knee Replacement", {
      overrides: [
        {
          group: "Total Knee Replacement",
          label: "TKA — primary",
          code: "CPT 27447",
          medicareRate: 10_500,
        },
      ],
    })
    expect(r?.medicareRate).toBe(10_500)
    expect(r?.label).toBe("TKA — primary")
  })
})

describe("listEffectiveMedicareRates", () => {
  it("merges built-ins with uploaded and custom groups, deduped by group", () => {
    const rows = listEffectiveMedicareRates({
      overrides: [
        { group: "Total Ankle Replacement", code: "CPT 27702", medicareRate: 12_000 },
        { group: "Total Knee Replacement", code: "CPT 27447", medicareRate: 10_200 },
      ],
      uploaded: parseMedicareRateRows([
        row("Total Knee Replacement", "CPT 27447", "9750"),
      ]).rates,
    })
    const knee = rows.filter((r) => r.group === "Total Knee Replacement")
    expect(knee).toHaveLength(1)
    expect(knee[0]).toMatchObject({ medicareRate: 10_200, source: "authoritative" })
    // The custom group appears even though it is in no built-in table.
    expect(rows.some((r) => r.group === "Total Ankle Replacement")).toBe(true)
    // Every built-in group is still present.
    expect(rows.length).toBeGreaterThanOrEqual(getAllMedicareAscRates().length)
  })

  it("sorts by display name, falling back to the group", () => {
    const rows = listEffectiveMedicareRates()
    const names = rows.map((r) => r.label || r.group)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })
})

// ─── Audit regression: the badge is a TRUST signal ───────────────
// Renaming a row must not promote an unverified built-in placeholder to
// "Authoritative" — that would mislead a rep quoting the number to a customer.

describe("resolveMedicareAscRate — presentation-only overrides", () => {
  it("a label/note-only override keeps the underlying source", () => {
    const r = resolveMedicareAscRate("Total Knee Replacement", {
      overrides: [
        {
          group: "Total Knee Replacement",
          label: "TKA — primary",
          code: "CPT 27447",
          medicareRate: 9_450, // untouched built-in value
          rateEntered: false,
        },
      ],
    })
    expect(r?.source).toBe("estimate")
    // …while still showing the user's rename.
    expect(r?.label).toBe("TKA — primary")
    expect(r?.medicareRate).toBe(9_450)
  })

  it("a presentation-only override over an UPLOADED row stays 'uploaded'", () => {
    const uploaded = parseMedicareRateRows([
      row("Total Knee Replacement", "CPT 27447", "9750"),
    ]).rates
    const r = resolveMedicareAscRate("Total Knee Replacement", {
      overrides: [
        {
          group: "Total Knee Replacement",
          label: "TKA",
          code: "CPT 27447",
          medicareRate: 9_750,
          rateEntered: false,
        },
      ],
      uploaded,
    })
    expect(r?.source).toBe("uploaded")
    expect(r?.medicareRate).toBe(9_750)
    expect(r?.label).toBe("TKA")
  })

  it("an entered rate still earns the authoritative badge", () => {
    const r = resolveMedicareAscRate("Total Knee Replacement", {
      overrides: [
        {
          group: "Total Knee Replacement",
          code: "CPT 27447",
          medicareRate: 10_200,
          rateEntered: true,
        },
      ],
    })
    expect(r?.source).toBe("authoritative")
    expect(r?.medicareRate).toBe(10_200)
  })

  it("rateEntered defaults to true for rows saved before the flag existed", () => {
    const r = resolveMedicareAscRate("Total Knee Replacement", {
      overrides: [
        { group: "Total Knee Replacement", code: "CPT 27447", medicareRate: 10_200 },
      ],
    })
    expect(r?.source).toBe("authoritative")
  })
})
