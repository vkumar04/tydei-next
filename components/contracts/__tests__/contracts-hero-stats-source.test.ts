import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"

/**
 * Source scanner for the contracts-list hero.
 *
 * The vitest environment is `node`, so the page can't be rendered here —
 * but the defect being pinned is structural, not visual: it is *where the
 * numbers are computed*. Before 2026-07-28 the hero mixed scopes on one
 * card row —
 *
 *   "Total Contracts"  ← prisma.contract.count() over the facility scope
 *   "Active"           ← allContracts.filter(status === "active").length
 *   "Expiring Soon"    ← allContracts.filter(<30-day window>).length
 *
 * — where `allContracts` is the FIRST PAGE of `getContracts` (pageSize 20,
 * ordered `updatedAt desc`). "45 Total / 20 Active" was the visible
 * symptom; "expiring soon" silently tracked recent edit activity.
 *
 * These assertions fail the moment a hero prop is wired back to the loaded
 * rows, or the search box goes back to filtering rows in the client.
 */

const CLIENT = path.resolve(
  __dirname,
  "../../../components/contracts/contracts-list-client.tsx",
)
const HERO = path.resolve(
  __dirname,
  "../../../components/contracts/contracts-hero.tsx",
)

const clientSrc = readFileSync(CLIENT, "utf8")
const heroSrc = readFileSync(HERO, "utf8")

/** The `<ContractsHero ... />` JSX element, props and all. */
function heroElement(): string {
  const match = clientSrc.match(/<ContractsHero[\s\S]*?\/>/)
  expect(match, "contracts-list-client must render <ContractsHero>").not.toBe(
    null,
  )
  return match![0]
}

describe("contracts hero — every number comes from getContractStats", () => {
  it("passes all four stats plus the pill from `stats`", () => {
    const el = heroElement()
    for (const prop of [
      "totalContracts",
      "activeCount",
      "totalValue",
      "rebatesYTD",
      "expiringSoon",
    ]) {
      const assignment = el.match(new RegExp(`${prop}=\\{([^}]*)\\}`))
      expect(assignment, `<ContractsHero> must set ${prop}`).not.toBe(null)
      expect(
        assignment![1],
        `${prop} must be read from the scope-wide stats payload`,
      ).toContain("stats?.")
    }
  })

  it("never derives a hero number from the loaded page", () => {
    const el = heroElement()
    // `allContracts` / `contracts` / `data` are the table's page.
    expect(el).not.toMatch(/allContracts/)
    expect(el).not.toMatch(/\bcontracts\.length\b/)
    expect(el).not.toMatch(/derivedStats/)
  })

  it("has no page-scoped active / expiring-soon reducer left in the client", () => {
    expect(clientSrc).not.toMatch(/derivedStats/)
    expect(clientSrc).not.toMatch(/status === "active"/)
    // The 30-day window is the server's business now.
    expect(clientSrc).not.toMatch(/30 \* 24 \* 60 \* 60 \* 1000/)
  })

  it("labels the expiring window from the same source that counted it", () => {
    expect(heroSrc).toMatch(/expiringSoonWindowDays/)
    expect(heroSrc).toMatch(/expiring in \{expiringSoonWindowDays\} days/)
    // No hard-coded "30 days" copy that could outlive the server constant.
    expect(heroSrc).not.toMatch(/expiring in 30 days/)
  })
})

describe("contracts list — search and export are not page-scoped", () => {
  it("sends the search term to the server", () => {
    expect(clientSrc).toMatch(/search: searchTerm/)
  })

  it("does not filter rows by name/vendor in the client", () => {
    expect(clientSrc).not.toMatch(/toLowerCase\(\)\.includes/)
    expect(clientSrc).not.toMatch(/matchesSearch/)
  })

  it("builds the CSV from the full filtered set", () => {
    expect(clientSrc).toMatch(/fetchContractsForExport\(/)
    // The old export mapped the in-memory page straight into CSV rows.
    expect(clientSrc).not.toMatch(/const rows = contracts\.map\(/)
  })

  it("states the truncation when the scope holds more than the page", () => {
    expect(clientSrc).toMatch(/isTruncated/)
    expect(clientSrc).toMatch(/matchingTotal/)
  })

  it("keeps the three row counts distinct instead of conflating them", () => {
    // matchingTotal = server matches; loadedCount = the page the server
    // sent; shownCount = what the table renders after the client-side
    // facility narrowing. The truncation note printed `allContracts.length`
    // as "showing N" even while the facility dropdown had cut the visible
    // rows to a fraction of it.
    expect(clientSrc).toMatch(/const loadedCount = allContracts\.length/)
    expect(clientSrc).toMatch(/const shownCount = contracts\.length/)
    expect(clientSrc).toMatch(/const isTruncated = matchingTotal > loadedCount/)
    // The note branches on the narrowing and names the rendered count.
    const note = clientSrc.match(/\{isTruncated && \([\s\S]*?\)\}/)
    expect(note, "the truncation note must still exist").not.toBe(null)
    expect(note![0]).toMatch(/isFacilityNarrowed/)
    expect(note![0]).toMatch(/shownCount/)
  })

  it("routes the export's toast + filename through one scope-aware summary", () => {
    // `rows.length` (post-narrowing) next to `total` (server scope) is the
    // exact defect; the summary is where the pairing is enforced/tested.
    expect(clientSrc).toMatch(/summarizeContractsExport\(/)
    expect(clientSrc).not.toMatch(/first-\$\{rows\.length\}-of-\$\{total\}/)
    expect(clientSrc).toMatch(/exportedCount: rows\.length/)
    expect(clientSrc).toMatch(/fetchedCount: fetched\.length/)
  })

  it("does not claim a scope-wide search when other filters narrowed it", () => {
    // "Searched all {stats.totalContracts} contracts" is only true when the
    // search ran against the untouched scope.
    expect(clientSrc).toMatch(/hasNarrowingFilters/)
    const claim = clientSrc.match(/Searched all \{[\s\S]{0,80}?\}/)
    expect(claim, "the whole-scope claim must still exist").not.toBe(null)
    const idx = clientSrc.indexOf(claim![0])
    const guard = clientSrc.lastIndexOf("hasNarrowingFilters", idx)
    expect(guard).toBeGreaterThan(-1)
  })
})
