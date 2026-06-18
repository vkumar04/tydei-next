import { describe, it, expect } from "vitest"
import { redactPhiSampleValues } from "../shared"

describe("redactPhiSampleValues (HIPAA minimum-necessary)", () => {
  it("masks PHI columns (patient MRN / DOB / initials) but preserves shape", () => {
    const rows = redactPhiSampleValues(
      ["Case #", "Patient MRN", "Patient DOB", "Surgeon Name", "Material"],
      [
        {
          "Case #": "C-1001",
          "Patient MRN": "MRN-4521",
          "Patient DOB": "12/25/1980",
          "Surgeon Name": "Dr. Jane Smith",
          Material: "Anchor 2.9mm",
        },
      ],
    )
    expect(rows[0]!["Patient MRN"]).toBe("XXX-0000")
    expect(rows[0]!["Patient DOB"]).toBe("00/00/0000")
    // Non-PHI columns untouched — the mapper still gets real content hints.
    expect(rows[0]!["Surgeon Name"]).toBe("Dr. Jane Smith")
    expect(rows[0]!["Case #"]).toBe("C-1001")
    expect(rows[0]!["Material"]).toBe("Anchor 2.9mm")
  })

  it("matches common PHI header variants", () => {
    for (const h of ["MRN", "Medical Record No", "DOB", "Date of Birth", "SSN", "Patient Initials", "Patient Name"]) {
      const out = redactPhiSampleValues([h], [{ [h]: "Abc123" }])
      expect(out[0]![h]).toBe("XXX000")
    }
  })

  it("does NOT mask surgeon/vendor name columns (not PHI)", () => {
    const out = redactPhiSampleValues(
      ["Surgeon Name", "Vendor Name", "Physician"],
      [{ "Surgeon Name": "Dr. A", "Vendor Name": "Stryker", Physician: "Dr. B" }],
    )
    expect(out[0]!["Surgeon Name"]).toBe("Dr. A")
    expect(out[0]!["Vendor Name"]).toBe("Stryker")
    expect(out[0]!["Physician"]).toBe("Dr. B")
  })

  it("returns rows unchanged when there are no PHI columns", () => {
    const rows = [{ A: "1", B: "x" }]
    expect(redactPhiSampleValues(["A", "B"], rows)).toEqual(rows)
  })
})
