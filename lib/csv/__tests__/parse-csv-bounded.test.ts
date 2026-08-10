import { describe, it, expect } from "vitest"
import {
  parseCsvTextBounded,
  CsvLimitError,
} from "../parse-csv-bounded"

describe("parseCsvTextBounded — parsing parity with the inline splitters", () => {
  it("parses headers and rows, trimming cells", () => {
    const { headers, rows } = parseCsvTextBounded(
      "Item, Price\nABC-1, 10.50\nABC-2, 20",
    )
    expect(headers).toEqual(["Item", "Price"])
    expect(rows).toEqual([
      { Item: "ABC-1", Price: "10.50" },
      { Item: "ABC-2", Price: "20" },
    ])
  })

  it("honors quoted fields containing commas and escaped quotes", () => {
    const { rows } = parseCsvTextBounded(
      'Item,Description\nABC-1,"Screw, 4mm"\nABC-2,"He said ""hi"""',
    )
    expect(rows[0].Description).toBe("Screw, 4mm")
    expect(rows[1].Description).toBe('He said "hi"')
  })

  it("strips a BOM, handles CRLF, and skips blank lines", () => {
    const { headers, rows } = parseCsvTextBounded(
      "﻿Item,Price\r\nABC-1,10\r\n\r\nABC-2,20\r\n",
    )
    expect(headers).toEqual(["Item", "Price"])
    expect(rows).toHaveLength(2)
  })

  it("pads short rows to the header width", () => {
    const { rows } = parseCsvTextBounded("A,B,C\n1,2")
    expect(rows[0]).toEqual({ A: "1", B: "2", C: "" })
  })

  it("returns empty for empty input and header-only input", () => {
    expect(parseCsvTextBounded("")).toEqual({ headers: [], rows: [] })
    const headerOnly = parseCsvTextBounded("A,B")
    expect(headerOnly.headers).toEqual(["A", "B"])
    expect(headerOnly.rows).toEqual([])
  })
})

describe("parseCsvTextBounded — memory caps", () => {
  it("rejects past the row cap, counting DATA rows only", () => {
    const csv = ["A,B", ...Array.from({ length: 5 }, (_, i) => `${i},x`)].join(
      "\n",
    )
    // 5 data rows: at the cap it passes, one under it throws.
    expect(parseCsvTextBounded(csv, { maxRows: 5 }).rows).toHaveLength(5)
    expect(() => parseCsvTextBounded(csv, { maxRows: 4 })).toThrow(CsvLimitError)
    expect(() => parseCsvTextBounded(csv, { maxRows: 4 })).toThrow(
      /more than 4 rows/,
    )
  })

  it("rejects a wide header before building any row objects", () => {
    // The DoS shape: few rows, absurd column count. One key per header would
    // be written onto every row.
    const wide = Array.from({ length: 300 }, (_, i) => `c${i}`).join(",")
    const csv = `${wide}\n${Array.from({ length: 300 }, () => "v").join(",")}`
    expect(() => parseCsvTextBounded(csv, { maxColumns: 256 })).toThrow(
      CsvLimitError,
    )
    expect(() => parseCsvTextBounded(csv, { maxColumns: 256 })).toThrow(
      /header has 300 fields/,
    )
    expect(parseCsvTextBounded(csv, { maxColumns: 300 }).headers).toHaveLength(
      300,
    )
  })

  it("caps DATA rows too, not just the header", () => {
    // A narrow header with one enormous data row was previously unchecked —
    // maxColumns only ever saw row 0.
    const csv = `A,B\n${Array.from({ length: 300 }, () => "v").join(",")}`
    expect(() => parseCsvTextBounded(csv, { maxColumns: 256 })).toThrow(
      /row 1 has 300 fields/,
    )
  })

  it("counts quoted commas as data, not separators, when capping", () => {
    // A legal 3-field row whose cells contain many commas must not trip the
    // column cap.
    const csv = 'A,B,C\n1,"a,b,c,d,e,f,g,h",3'
    expect(() => parseCsvTextBounded(csv, { maxColumns: 4 })).not.toThrow()
  })

  it("rejects an over-cap payload without materializing it (bounded memory)", () => {
    // The regression this module exists to prevent: the cap must run BEFORE
    // the allocation it bounds. A 4MB single-line header of bare commas used
    // to cost ~16x its size in RSS before the check fired.
    const huge = "a,".repeat(2_000_000) + "\nx\n"
    const before = process.memoryUsage().heapUsed
    expect(() => parseCsvTextBounded(huge, { maxColumns: 256 })).toThrow(
      CsvLimitError,
    )
    const grew = process.memoryUsage().heapUsed - before
    // Rejecting must not allocate anything like the field array (2M strings).
    expect(grew).toBeLessThan(8 * 1024 * 1024)
  })

  it("rows have a null prototype so a '__proto__' header cannot pollute", () => {
    const { rows } = parseCsvTextBounded("__proto__,B\nevil,ok")
    expect(Object.getPrototypeOf(rows[0])).toBeNull()
    expect(rows[0]["__proto__"]).toBe("evil")
    // Object.prototype is untouched.
    expect(({} as Record<string, unknown>).B).toBeUndefined()
  })

  it("defaults are permissive enough for real imports (46k rows × 25 cols)", () => {
    const headers = Array.from({ length: 25 }, (_, i) => `c${i}`).join(",")
    const row = Array.from({ length: 25 }, () => "v").join(",")
    const csv = [headers, ...Array.from({ length: 1_000 }, () => row)].join("\n")
    expect(() => parseCsvTextBounded(csv)).not.toThrow()
  })

  it("CsvLimitError is a named Error the routes can branch on", () => {
    const err = new CsvLimitError("too big")
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe("CsvLimitError")
  })
})
