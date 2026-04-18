import { describe, it, expect } from "vitest"
import { toCSV, buildReportFilename } from "../csv-export"

describe("toCSV", () => {
  it("produces header-only output for empty rows", () => {
    const csv = toCSV({
      columns: [
        { key: "name", label: "Name" },
        { key: "count", label: "Count" },
      ],
      rows: [],
    })
    expect(csv).toBe('"Name","Count"')
  })

  it("serializes simple rows with every cell double-quoted", () => {
    const csv = toCSV({
      columns: [
        { key: "name", label: "Name" },
        { key: "count", label: "Count" },
      ],
      rows: [
        { name: "Acme", count: 10 },
        { name: "Beta", count: 25 },
      ],
    })
    const lines = csv.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('"Name","Count"')
    expect(lines[1]).toBe('"Acme","10"')
    expect(lines[2]).toBe('"Beta","25"')
  })

  it("quotes cells that contain commas", () => {
    const csv = toCSV({
      columns: [{ key: "desc", label: "Description" }],
      rows: [{ desc: "Smith, John" }],
    })
    expect(csv).toContain('"Smith, John"')
  })

  it("escapes embedded double quotes as '\"\"' per RFC 4180", () => {
    const csv = toCSV({
      columns: [{ key: "note", label: "Note" }],
      rows: [{ note: 'they said "hi"' }],
    })
    expect(csv).toContain('"they said ""hi"""')
  })

  it("handles newlines inside cells (wrapped in quotes)", () => {
    const csv = toCSV({
      columns: [{ key: "desc", label: "Description" }],
      rows: [{ desc: "line1\nline2" }],
    })
    // The entire cell remains quoted; the internal newline is preserved literally.
    expect(csv).toContain('"line1\nline2"')
  })

  it("serializes null / undefined as empty string", () => {
    const csv = toCSV({
      columns: [
        { key: "a", label: "A" },
        { key: "b", label: "B" },
      ],
      rows: [
        { a: null, b: undefined },
        { a: "x", b: "y" },
      ],
    })
    const lines = csv.split("\n")
    expect(lines[1]).toBe('"",""')
    expect(lines[2]).toBe('"x","y"')
  })

  it("serializes Date as ISO string", () => {
    const d = new Date("2026-04-18T12:00:00Z")
    const csv = toCSV({
      columns: [{ key: "date", label: "Date" }],
      rows: [{ date: d }],
    })
    expect(csv).toContain("2026-04-18T12:00:00.000Z")
  })

  it("honors per-column custom formatters", () => {
    const csv = toCSV({
      columns: [
        {
          key: "amount",
          label: "Amount",
          format: (v) => `$${(v as number).toFixed(2)}`,
        },
      ],
      rows: [{ amount: 1234.5 }],
    })
    expect(csv).toContain('"$1234.50"')
  })

  it("handles boolean values", () => {
    const csv = toCSV({
      columns: [{ key: "active", label: "Active" }],
      rows: [{ active: true }, { active: false }],
    })
    const lines = csv.split("\n")
    expect(lines[1]).toBe('"true"')
    expect(lines[2]).toBe('"false"')
  })

  it("handles Infinity / NaN numbers as empty string", () => {
    const csv = toCSV({
      columns: [{ key: "v", label: "V" }],
      rows: [
        { v: Infinity },
        { v: NaN },
        { v: 3.14 },
      ],
    })
    const lines = csv.split("\n")
    expect(lines[1]).toBe('""')
    expect(lines[2]).toBe('""')
    expect(lines[3]).toBe('"3.14"')
  })
})

describe("buildReportFilename", () => {
  it("converts whitespace to underscores + appends ISO date", () => {
    const filename = buildReportFilename(
      "Contract Performance Summary",
      new Date("2026-04-18T12:00:00Z"),
    )
    expect(filename).toBe("Contract_Performance_Summary_2026-04-18.csv")
  })

  it("strips filesystem-hostile chars", () => {
    const filename = buildReportFilename(
      'Foo/Bar:Baz*Qux?"<>|',
      new Date("2026-04-18T00:00:00Z"),
    )
    expect(filename).toBe("FooBarBazQux_2026-04-18.csv")
  })

  it("collapses multiple spaces", () => {
    const filename = buildReportFilename(
      "  Double  Space   ",
      new Date("2026-04-18T00:00:00Z"),
    )
    expect(filename).toBe("Double_Space_2026-04-18.csv")
  })

  it("falls back to 'report' when title is empty", () => {
    const filename = buildReportFilename("", new Date("2026-04-18T00:00:00Z"))
    expect(filename).toBe("report_2026-04-18.csv")
  })

  it("defaults date to today when omitted", () => {
    const filename = buildReportFilename("Test")
    expect(filename).toMatch(/^Test_\d{4}-\d{2}-\d{2}\.csv$/)
  })
})
