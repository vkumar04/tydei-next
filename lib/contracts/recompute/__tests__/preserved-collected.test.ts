/**
 * Preserved-collected guard across the five specialty accrual writers
 * (2026-07-29 math audit — DOUBLE COUNTING, HIGH).
 *
 * THE BUG. Each dispatcher writer deletes its own rows with
 * `collectionDate: null`, then inserts a fresh row for every window —
 * unconditionally. A user-logged collection stamps `collectionDate` on the SAME
 * row and keeps its notes prefix, so that row survives both the family wipe and
 * the writer's own delete, and the writer adds a SECOND row for the same window.
 *
 * Controlled A/B on the production snapshot, Smith & Nephew carve-out, after
 * stamping a collection on the 2023-06-01 row ($33,106.19):
 *
 *     without the guard   6 rows -> 7 rows   +$33,106.19   duplicate pair
 *     with the guard      6 rows -> 6 rows    $0.00        none
 *
 * The over-count equals the collected row's earned amount exactly, and it is
 * permanent — a second recompute is stable at the inflated total. It hid
 * because the writer's returned `sumEarned` is computed from the rows it just
 * built, so the toast reported the CORRECT figure while the ledger held the
 * wrong one.
 *
 * These are source guards: the behaviour needs a database, so the numeric proof
 * lives in the commit message. What is pinned here is that all seven insert
 * sites still consult the guard — the shape that made the bug possible was five
 * writers each free to forget it.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { periodKey } from "../preserved-collected"

const DIR = join(__dirname, "..")
const read = (f: string) => readFileSync(join(DIR, `${f}.ts`), "utf8")

/** Writer -> number of delete/insert pairs it owns. */
const WRITERS: ReadonlyArray<readonly [string, number]> = [
  ["carve-out", 1],
  ["threshold", 1],
  ["po", 1],
  ["invoice", 1],
  ["volume", 3],
]

describe("every specialty writer loads the preserved-collected set", () => {
  it.each(WRITERS)("%s loads it once per delete/insert pair (%i)", (name, n) => {
    const src = read(name as string)
    expect(
      (src.match(/loadPreservedCollectedPeriods\(/g) ?? []).length,
    ).toBe(n as number)
  })

  it.each(WRITERS)("%s skips preserved windows on insert (%i)", (name, n) => {
    const src = read(name as string)
    expect(
      (src.match(/preservedCollected\.has\(periodKey\(/g) ?? []).length,
    ).toBe(n as number)
  })

  it.each(WRITERS)("%s has as many skips as loads", (name) => {
    const src = read(name as string)
    const loads = (src.match(/loadPreservedCollectedPeriods\(/g) ?? []).length
    const skips = (src.match(/preservedCollected\.has\(periodKey\(/g) ?? []).length
    // A load without a skip is the bug wearing the fix's clothes.
    expect(skips).toBe(loads)
  })

  it("no writer hand-rolls its own preservation query", () => {
    // The spend writer and these five drifted apart once already; keep the
    // single definition.
    for (const [name] of WRITERS) {
      const src = read(name as string)
      expect(src).not.toMatch(/collectionDate:\s*\{\s*not:\s*null\s*\}/)
    }
  })
})

describe("periodKey", () => {
  it("is date-only — payPeriod columns are @db.Date", () => {
    // The engine emits period ends as ...T23:59:59.999Z while the column stores
    // midnight. Comparing full ISO strings never matched, which let a
    // $391,846.83 row duplicate on production 8 minutes apart (2026-06-09).
    const a = periodKey(
      new Date("2025-01-01T00:00:00.000Z"),
      new Date("2025-12-31T23:59:59.999Z"),
    )
    const b = periodKey(new Date("2025-01-01"), new Date("2025-12-31"))
    expect(a).toBe(b)
    expect(a).toBe("2025-01-01|2025-12-31")
  })

  it("accepts strings and Dates interchangeably", () => {
    expect(periodKey("2024-06-01", "2025-05-31")).toBe(
      periodKey(new Date("2024-06-01"), new Date("2025-05-31")),
    )
  })

  it("distinguishes adjacent windows", () => {
    expect(periodKey("2024-01-01", "2024-12-31")).not.toBe(
      periodKey("2025-01-01", "2025-12-31"),
    )
  })
})
