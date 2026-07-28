import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import {
  CONTRACT_LINK_PAGE_SIZE,
  contractLinkCapNotice,
  contractLinkQueryArgs,
  describeComplianceScope,
  describeMarketShareScope,
} from "@/components/contracts/contract-form"

/**
 * The capital contract's "link an existing contract" picker.
 *
 * It fetched `getContracts({ pageSize: 100 })`, mapped `data.contracts`
 * straight into a `<Select>`, and never read the `total` sitting next to it.
 * The list is ordered `updatedAt desc` and the dropdown had no search, so on a
 * facility with more than 100 contracts an older one could not be linked at
 * all — and nothing on screen admitted to the cap. Same shape as the picker
 * that made vendor user creation impossible in production.
 *
 * Verified against the production snapshot on 2026-07-28: 2 contracts across 2
 * facilities, so this is THEORETICAL at today's volume (the dev seed carries
 * ~20). `contractFiltersSchema` caps `pageSize` at 100, so "fetch them all" is
 * not available — the fix is a server-SEARCHED list that names its cap.
 */

const SRC = path.resolve(
  __dirname,
  "../../../components/contracts/contract-form.tsx",
)
const src = readFileSync(SRC, "utf8")
/** Comment-free view — the comments name the removed call on purpose. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1")

describe("linked-contract picker — the list is server-searched", () => {
  it("no longer hard-codes a 100-row page and ignores the rest", () => {
    expect(code).not.toMatch(/getContracts\(\{ pageSize: 100 \}\)/)
    expect(code).toMatch(/getContracts\(contractLinkQueryArgs\(linkSearchTerm\)\)/)
  })

  it("reads `total`, the number the old picker threw away", () => {
    expect(code).toMatch(/contractsData\?\.total/)
  })

  it("sends the search term to the server instead of filtering the page", () => {
    // A client-side filter over the fetched page can only ever search the
    // page — the exact trap this bug class keeps setting.
    expect(code).not.toMatch(/linkOptions\.filter\(/)
    expect(code).toMatch(/queryFn: \(\) => getContracts\(contractLinkQueryArgs\(/)
  })

  it("keeps the search term under the factory's key prefix", () => {
    // Prefix from lib/query-keys.ts so invalidating `contracts.linkOptions()`
    // still clears every cached search (CLAUDE.md: keys come from the factory).
    expect(code).toMatch(
      /queryKey: \[\.\.\.queryKeys\.contracts\.linkOptions\(\), linkSearchTerm\]/,
    )
  })

  it("debounces so one keystroke is not one heavy getContracts call", () => {
    expect(code).toMatch(/useDebouncedValue\(linkSearch, \d+\)/)
  })

  it("uses a searchable combobox, not a Select the user cannot type into", () => {
    const field = src.match(/<Field label="Related Contract">[\s\S]*?<\/Field>/)
    expect(field, "the Related Contract field must still exist").not.toBe(null)
    expect(field![0]).toMatch(/<CommandInput/)
    expect(field![0]).not.toMatch(/<SelectTrigger/)
    // cmdk must not re-filter what the server already filtered, or rows
    // matched on contract number / vendor name would vanish from the list.
    expect(field![0]).toMatch(/shouldFilter=\{false\}/)
  })

  it("renders the cap notice inside the picker", () => {
    expect(code).toMatch(/const linkCapNotice = contractLinkCapNotice\(/)
    expect(src).toMatch(/\{linkCapNotice && \(/)
  })

  it("carries the selected contract's label with its id", () => {
    // The list is one server page: search away from the selection and the
    // chosen row is no longer in it, so the trigger label cannot be looked
    // up from the fetched options.
    expect(code).toMatch(/setLinkedContract\(\{ id: c\.id, name: c\.name \}\)/)
    expect(code).toMatch(/linkedContract\?\.name \?\?/)
  })
})

describe("contractLinkQueryArgs", () => {
  it("asks for one page, well under the schema's max of 100", () => {
    expect(contractLinkQueryArgs("").pageSize).toBe(CONTRACT_LINK_PAGE_SIZE)
    expect(CONTRACT_LINK_PAGE_SIZE).toBeLessThanOrEqual(100)
  })

  it("omits `search` entirely when the box is empty or blank", () => {
    expect(contractLinkQueryArgs("")).not.toHaveProperty("search")
    expect(contractLinkQueryArgs("   ")).not.toHaveProperty("search")
  })

  it("passes a trimmed term through to the server", () => {
    expect(contractLinkQueryArgs("  Stryker Mako ")).toEqual({
      search: "Stryker Mako",
      pageSize: CONTRACT_LINK_PAGE_SIZE,
    })
  })
})

describe("contractLinkCapNotice", () => {
  it("stays quiet when the page holds every match", () => {
    expect(contractLinkCapNotice(20, 20, "")).toBeNull()
    expect(contractLinkCapNotice(2, 2, "")).toBeNull()
    // Production today: 2 contracts, one page, nothing to disclose.
    expect(contractLinkCapNotice(0, 0, "stryker")).toBeNull()
  })

  it("names the loaded count, the true total, and the remainder", () => {
    const notice = contractLinkCapNotice(25, 137, "")
    expect(notice).not.toBeNull()
    expect(notice).toContain("25")
    expect(notice).toContain("137")
    // 112 unreachable rows is the number the old picker never mentioned.
    expect(notice).toContain("112")
  })

  it("says the search is not scoped to the visible list", () => {
    expect(contractLinkCapNotice(25, 137, "")).toMatch(
      /search runs across every contract/,
    )
  })

  it("distinguishes a filtered total from the whole set", () => {
    expect(contractLinkCapNotice(25, 40, "plate")).toContain(
      "matching contracts",
    )
    expect(contractLinkCapNotice(25, 40, "")).not.toContain("matching")
  })
})

/**
 * The other half of the same bug class in this file: the captions under the
 * two COMPUTED fields (Compliance Rate, Current Market Share).
 *
 * `computeContractMetrics` measures one vendor set, inside the contract's
 * categories, inside the contract's effective window — and returns
 * `windowStart`/`windowEnd` specifically "so the form can show 'computed from
 * N rows over period X'". The captions read "From 412 of 1,138 COG rows in
 * contract categories" and "Vendor $105,000 of $3,290,000 category spend":
 * no vendor, no window, so both denominators read as the whole facility's
 * history in those categories. Nothing was miscomputed — the labels claimed a
 * scope the numbers never had.
 */
const METRICS = {
  cogRowsOnContract: 412,
  cogRowsTotal: 1138,
  vendorSpendInCategories: 105_000,
  totalSpendInCategories: 3_290_000,
  // @db.Date boundaries, so the range formatter is UTC-pinned.
  windowStart: "2025-01-01T00:00:00.000Z",
  windowEnd: "2026-07-28T00:00:00.000Z",
}

describe("describeComplianceScope", () => {
  it("names the vendor the denominator is restricted to", () => {
    const text = describeComplianceScope(METRICS)
    expect(text).toContain("412")
    expect(text).toContain("1,138")
    expect(text).toMatch(/for this vendor/)
    expect(text).toMatch(/contract's categories/)
  })

  it("states the window both numbers were measured over", () => {
    // The action clamps this window to the contract term (and to five years /
    // today), so it is never "all time" — say which range it is.
    expect(describeComplianceScope(METRICS)).toContain(
      "Jan 1, 2025 – Jul 28, 2026",
    )
  })

  it("survives a zero denominator without inventing a scope", () => {
    const text = describeComplianceScope({
      ...METRICS,
      cogRowsOnContract: 0,
      cogRowsTotal: 0,
    })
    expect(text).toContain("From 0 of 0 COG rows")
  })
})

describe("describeMarketShareScope", () => {
  it("says the denominator is every vendor's spend, at this facility", () => {
    const text = describeMarketShareScope(METRICS)
    expect(text).not.toBeNull()
    expect(text).toContain("$105,000")
    expect(text).toContain("$3,290,000")
    expect(text).toMatch(/all vendors in those categories at this facility/)
    expect(text).toContain("Jan 1, 2025 – Jul 28, 2026")
  })

  it("returns null rather than a 0-denominator ratio", () => {
    // Prisma sums are 0 here, not null — but a caption built around "$0 of $0
    // category spend" claims a measurement that never happened.
    expect(
      describeMarketShareScope({
        ...METRICS,
        vendorSpendInCategories: 0,
        totalSpendInCategories: 0,
      }),
    ).toBeNull()
  })

  it("is wired into the form instead of the old inline template", () => {
    expect(code).toMatch(/describeComplianceScope\(metricsQuery\.data\)/)
    expect(code).toMatch(/describeMarketShareScope\(metricsQuery\.data\)/)
    // The old captions, which named neither the vendor nor the window.
    expect(code).not.toMatch(/COG rows in contract categories`/)
    expect(code).not.toMatch(/category spend`/)
  })
})
