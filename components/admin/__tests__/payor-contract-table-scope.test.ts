import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import {
  COMMON_PAYOR_NAMES,
  PAYOR_CONTRACT_PAGE_SIZE,
  PAYOR_CONTRACT_SCAN_LIMIT,
  countCptRates,
  countDistinctPayors,
  filterPayorContracts,
  filterPayorNames,
  payorContractPage,
  payorNameFreeTextOption,
  payorNameOptions,
  payorOptionsHeading,
} from "@/components/admin/payor-contract-table"

/**
 * The admin payor-contract surface, pinned against the "computed from the
 * wrong scope, presented as the whole truth" class.
 *
 * Two defects lived here (both verified 2026-07-28):
 *
 *  1. The REQUIRED Facility picker in the "New Payor Contract" dialog read
 *     `adminGetFacilities({})` — pageSize 20. `facilityId` gates submit, so a
 *     facility past alphabetical rank 20 made payor-contract creation for it
 *     impossible. `adminGetFacilityOptions()` exists for exactly this and is
 *     unpaginated. Identical to the defect that made vendor user creation
 *     impossible in production (201 vendors, the only assignable one at rank
 *     169).
 *
 *  2. All four stat cards reduced over `data.contracts` — one `take: 20` page
 *     — while the action's real `total` sat unread, and the table rendered no
 *     pager at all, so rows 21+ were unreachable.
 *
 *  3. (review pass) The Payor Name picker two fields ABOVE the facility one
 *     was the same shape and is NOT theoretical: nine hard-coded national
 *     payors, presented as the whole payor universe, gating submit. Four of
 *     the five payor names in the two live databases are outside that list.
 *
 * (1) and (2) are THEORETICAL at today's production volume, verified against
 * the snapshot: 2 facilities, 2 payor contracts (252 and 84 CPT rates). They
 * are pinned because the shape, not the row count, is the bug. (3) is
 * observable in both databases today.
 */

const SRC = path.resolve(
  __dirname,
  "../../../components/admin/payor-contract-table.tsx",
)
const src = readFileSync(SRC, "utf8")
/**
 * Comment-free view of the same file. The comments deliberately NAME the
 * removed readers ("`adminGetFacilities({})` defaults to pageSize 20"), so a
 * "this call is gone" assertion has to look at code only.
 */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1")

/** The Facility `<Select>` in the create dialog, wrapper and all. */
function facilityField(): string {
  const match = src.match(
    /<Label htmlFor="facility">[\s\S]*?<\/Select>/,
  )
  expect(match, "the create dialog must still have a Facility picker").not.toBe(
    null,
  )
  return match![0]
}

describe("payor-contract facility picker — never paginated", () => {
  it("reads the unpaginated options action, not the paginated list action", () => {
    expect(code).toMatch(/adminGetFacilityOptions\(\)/)
    // The list reader defaults to pageSize 20; a required picker cannot use it.
    expect(code).not.toMatch(/adminGetFacilities\b/)
  })

  it("keys that read off the shared facilityOptions factory key", () => {
    expect(code).toMatch(/queryKeys\.admin\.facilityOptions\(\)/)
    expect(code).not.toMatch(/queryKeys\.admin\.facilities\(/)
  })

  it("renders every returned facility — no client-side slice", () => {
    const field = facilityField()
    expect(field).toMatch(/facilities\.map\(/)
    expect(field).not.toMatch(/\.slice\(/)
  })
})

/** The Payor `<Popover>` combobox in the create dialog, wrapper and all. */
function payorField(): string {
  const match = src.match(
    /<Label htmlFor="payorName">[\s\S]*?<\/Popover>/,
  )
  expect(match, "the create dialog must still have a Payor picker").not.toBe(
    null,
  )
  return match![0]
}

describe("payor-contract payor picker — the hard-coded list is a seed, not the set", () => {
  it("no longer renders a fixed <SelectItem> list of payors", () => {
    const field = payorField()
    expect(field).not.toMatch(/<SelectItem/)
    // Every option now comes from `payorNameOptions`, via the filter.
    expect(field).toMatch(/payorMatches\.map\(/)
  })

  it("is a searchable combobox that accepts a name nobody listed", () => {
    const field = payorField()
    expect(field).toMatch(/<CommandInput/)
    expect(field).toMatch(/payorFreeText/)
    // cmdk must not re-filter — it would also score out the free-text row.
    expect(field).toMatch(/shouldFilter=\{false\}/)
  })

  it("feeds the options from the loaded rows, not from the constant alone", () => {
    expect(code).toMatch(/payorNameOptions\(contracts\)/)
  })

  it("names the payor suggestions in the truncated-scan notice", () => {
    const notice = src.match(/\{scanTruncated && data && \([\s\S]*?\)\}/)
    expect(notice).not.toBe(null)
    expect(notice![0]).toMatch(/payor suggestions/)
  })
})

describe("payor-contract stat cards — whole-set numbers", () => {
  it("takes Total Contracts from the server count, not the loaded page", () => {
    expect(src).toMatch(/\{stat\(data\?\.total\)\}/)
    // The old card: `{contracts.length}` — the size of `take: 20`.
    expect(code).not.toMatch(/\{contracts\.length\}<\/div>/)
  })

  it("takes Active Contracts from a server count over the whole set", () => {
    expect(src).toMatch(/\{stat\(activeData\?\.total\)\}/)
    expect(src).toMatch(/getPayorContracts\(\{ status: "active"/)
    // The old card filtered the page in the client.
    expect(code).not.toMatch(/contracts\.filter\(\(c\) => c\.status === "active"\)/)
  })

  it("refreshes the active-count read too — the factory keys do not prefix-match", () => {
    // `payorContracts()` builds [..., undefined]; TanStack compares that
    // against {status:"active"} and does NOT match, so both are invalidated.
    const helper = src.match(
      /const invalidatePayorContracts = \(\) => \{[\s\S]*?\n  \}/,
    )
    expect(helper, "both reads must be invalidated together").not.toBe(null)
    expect(helper![0]).toMatch(/queryKeys\.admin\.payorContracts\(\)/)
    expect(helper![0]).toMatch(
      /queryKeys\.admin\.payorContracts\(\{\s*status: "active"\s*\}\)/,
    )
  })

  it("loads the set in one page instead of the default 20", () => {
    expect(src).toMatch(
      /getPayorContracts\(\{ pageSize: PAYOR_CONTRACT_SCAN_LIMIT \}\)/,
    )
    expect(PAYOR_CONTRACT_SCAN_LIMIT).toBeGreaterThan(PAYOR_CONTRACT_PAGE_SIZE)
  })

  it("states the cap when the scan does not cover the whole set", () => {
    expect(src).toMatch(/const scanTruncated = data \? data\.total > contracts\.length : false/)
    const notice = src.match(/\{scanTruncated && data && \([\s\S]*?\)\}/)
    expect(notice, "a truncated scan must say so").not.toBe(null)
    // Name both numbers, and which cards each one covers.
    expect(notice![0]).toMatch(/\{contracts\.length\}/)
    expect(notice![0]).toMatch(/\{data\.total\}/)
    expect(notice![0]).toMatch(/Total CPT Rates, Payors Covered/)
  })

  it("renders a pager so rows past the first page are reachable", () => {
    expect(src).toMatch(/pageSlice\.rows\.map\(/)
    expect(src).toMatch(/Previous/)
    expect(src).toMatch(/Next/)
    expect(src).toMatch(/Showing \{pageSlice\.from\}/)
    // …and the pager's own "of N" says which N it means when the scan capped.
    expect(src).toMatch(/scanTruncated \? " loaded" : ""/)
  })

  it("shows “—”, not 0, for the derived cards when the read fails", () => {
    // `isLoading` is false once a query ERRORS, so gating on it printed a
    // confident 0 over an empty array. Gate on the data itself, like `stat`.
    expect(src).toMatch(/\{data \? totalContractedRates : "—"\}/)
    expect(src).toMatch(/\{data \? uniquePayors : "—"\}/)
    expect(code).not.toMatch(/isLoading \? "—" :/)
  })
})

// ─── Pure helpers ───────────────────────────────────────────────

/** Production's two rows, verified against the snapshot on 2026-07-28. */
const PROD_ROWS = [
  {
    payorName:
      "Anthem Health Plans, Inc. dba Anthem Blue Cross and Blue Shield",
    facilityName: "Lighthouse Surgical Center",
    contractNumber: "ASC-2024-001",
    status: "active",
    cptRates: Array.from({ length: 252 }, () => ({ cptCode: "29881", rate: 1 })),
  },
  {
    payorName:
      "Anthem Health Plans, Inc., dba Anthem Blue Cross and Blue Shield",
    facilityName: "Lighthouse Community Hospital",
    contractNumber: "ASC-2024-002",
    status: "active",
    cptRates: Array.from({ length: 84 }, () => ({ cptCode: "29826", rate: 1 })),
  },
]

describe("countCptRates", () => {
  it("sums every row handed in", () => {
    expect(countCptRates(PROD_ROWS)).toBe(336)
  })

  it("counts a 47-contract set in full, not one 20-row page", () => {
    const rows = Array.from({ length: 47 }, () => ({ cptRates: [{}, {}] }))
    expect(countCptRates(rows)).toBe(94)
    // The old page-scoped reducer would have stopped at 40.
    expect(countCptRates(rows.slice(0, PAYOR_CONTRACT_PAGE_SIZE))).toBe(40)
  })

  it("treats a missing rate array as zero, never NaN", () => {
    expect(countCptRates([{ cptRates: null }, {}])).toBe(0)
  })
})

describe("countDistinctPayors", () => {
  it("counts distinct payors across the whole set", () => {
    expect(countDistinctPayors(PROD_ROWS)).toBe(2)
  })

  it("folds case and surrounding whitespace so one payor counts once", () => {
    expect(
      countDistinctPayors([
        { payorName: "Aetna" },
        { payorName: "aetna " },
        { payorName: " AETNA" },
        { payorName: "Cigna" },
      ]),
    ).toBe(2)
  })
})

/**
 * Every payor name in the dev seed, read off tydei-next-postgres-1 on
 * 2026-07-28. Only ONE of the three is in `COMMON_PAYOR_NAMES` — the other two
 * are near-misses of an entry in it ("UnitedHealthcare" vs "United
 * Healthcare", "Aetna Medicare Advantage" vs "Aetna"), which is exactly how a
 * fixed suggestion list splits one payor into two.
 */
const SEED_PAYOR_NAMES = [
  "Blue Cross Blue Shield",
  "Aetna Medicare Advantage",
  "UnitedHealthcare",
]

describe("payorNameOptions", () => {
  it("offers the payors that actually exist — the constant alone does not", () => {
    for (const row of PROD_ROWS) {
      expect(
        COMMON_PAYOR_NAMES as readonly string[],
        "prod's payor names were never in the hard-coded list",
      ).not.toContain(row.payorName)
      expect(payorNameOptions(PROD_ROWS)).toContain(row.payorName)
    }
    const seedRows = SEED_PAYOR_NAMES.map((payorName) => ({ payorName }))
    const seedOptions = payorNameOptions(seedRows)
    for (const name of SEED_PAYOR_NAMES) expect(seedOptions).toContain(name)
    // Two of the three were unreachable before: no exact entry in the list.
    expect(
      SEED_PAYOR_NAMES.filter((n) =>
        (COMMON_PAYOR_NAMES as readonly string[]).includes(n),
      ),
    ).toEqual(["Blue Cross Blue Shield"])
  })

  it("keeps the seed suggestions alongside the stored ones", () => {
    const options = payorNameOptions(PROD_ROWS)
    for (const name of COMMON_PAYOR_NAMES) expect(options).toContain(name)
    expect(options).toHaveLength(COMMON_PAYOR_NAMES.length + 2)
  })

  it("dedupes on the SAME key as the Payors Covered card", () => {
    const rows = [
      { payorName: "Aetna" },
      { payorName: "aetna " },
      { payorName: " AETNA" },
    ]
    const options = payorNameOptions(rows, [])
    expect(options).toEqual(["Aetna"])
    expect(options).toHaveLength(countDistinctPayors(rows))
  })

  it("lets the stored spelling win when it collides with a seed", () => {
    const options = payorNameOptions([{ payorName: "  cigna " }])
    expect(options).toContain("cigna")
    expect(options).not.toContain("Cigna")
  })

  it("offers a seed near-miss ALONGSIDE the stored name, adjacent to it", () => {
    // "UnitedHealthcare" and "United Healthcare" are two distinct payors
    // under the canonical key, so the picker offers both and the card counts
    // both — the two must not disagree. Sorting puts them next to each other,
    // which is the only honest way to show a near-miss.
    const options = payorNameOptions([{ payorName: "UnitedHealthcare" }])
    expect(options).toContain("UnitedHealthcare")
    expect(options).toContain("United Healthcare")
    expect(
      Math.abs(
        options.indexOf("UnitedHealthcare") -
          options.indexOf("United Healthcare"),
      ),
    ).toBe(1)
    expect(
      countDistinctPayors([
        { payorName: "UnitedHealthcare" },
        { payorName: "United Healthcare" },
      ]),
    ).toBe(2)
  })

  it("ignores blank payor names instead of offering an empty option", () => {
    expect(payorNameOptions([{ payorName: "   " }], [])).toEqual([])
  })

  it("sorts case-insensitively so the list is scannable", () => {
    const options = payorNameOptions(
      [{ payorName: "zeta health" }, { payorName: "Alpha Care" }],
      [],
    )
    expect(options).toEqual(["Alpha Care", "zeta health"])
  })
})

describe("filterPayorNames", () => {
  it("returns every option for a blank query", () => {
    const options = payorNameOptions(PROD_ROWS)
    expect(filterPayorNames(options, "")).toEqual(options)
    expect(filterPayorNames(options, "  ")).toEqual(options)
  })

  it("matches case-insensitively on any part of the name", () => {
    const options = payorNameOptions(PROD_ROWS)
    expect(filterPayorNames(options, "anthem health plans")).toHaveLength(2)
    expect(filterPayorNames(options, "CIGNA")).toEqual(["Cigna"])
  })
})

describe("payorOptionsHeading", () => {
  it("counts the rows rendered, not the unfiltered option list", () => {
    // The group renders `payorMatches`; heading it with the full option count
    // is the same wrong-scope label this whole pass is about, in miniature.
    expect(payorOptionsHeading(1, 11)).toBe("1 of 11 known payors")
    expect(payorOptionsHeading(11, 11)).toBe("11 known payors")
    expect(payorOptionsHeading(1, 1)).toBe("1 known payor")
  })

  it("is what the component actually passes to the group", () => {
    expect(code).toMatch(
      /payorOptionsHeading\(\s*payorMatches\.length,\s*payorOptions\.length,?\s*\)/,
    )
  })
})

describe("payorNameFreeTextOption", () => {
  it("offers a name that is in neither the data nor the seed list", () => {
    const options = payorNameOptions(PROD_ROWS)
    expect(payorNameFreeTextOption(options, "  Tricare West ")).toBe(
      "Tricare West",
    )
  })

  it("stays quiet when the typed name already exists in any casing", () => {
    const options = payorNameOptions(PROD_ROWS)
    expect(payorNameFreeTextOption(options, "cigna")).toBeNull()
    expect(payorNameFreeTextOption(options, PROD_ROWS[0].payorName)).toBeNull()
  })

  it("stays quiet on an empty or whitespace query", () => {
    expect(payorNameFreeTextOption(["Cigna"], "")).toBeNull()
    expect(payorNameFreeTextOption(["Cigna"], "   ")).toBeNull()
  })
})

describe("filterPayorContracts", () => {
  it("returns everything for an empty or blank query", () => {
    expect(filterPayorContracts(PROD_ROWS, "")).toHaveLength(2)
    expect(filterPayorContracts(PROD_ROWS, "   ")).toHaveLength(2)
  })

  it("matches payor, facility and contract number, case-insensitively", () => {
    expect(filterPayorContracts(PROD_ROWS, "anthem")).toHaveLength(2)
    expect(filterPayorContracts(PROD_ROWS, "community")).toHaveLength(1)
    expect(filterPayorContracts(PROD_ROWS, "asc-2024-001")).toHaveLength(1)
  })

  it("tolerates rows with no facility or contract number", () => {
    const rows = [{ payorName: "Cigna", facilityName: null, contractNumber: null }]
    expect(filterPayorContracts(rows, "cigna")).toHaveLength(1)
    expect(filterPayorContracts(rows, "zzz")).toHaveLength(0)
  })
})

describe("payorContractPage", () => {
  const rows = Array.from({ length: 47 }, (_, i) => ({ id: `p-${i}` }))

  it("makes every row reachable — the whole point of the pager", () => {
    const seen = new Set<string>()
    const { pageCount } = payorContractPage(rows, 1)
    for (let p = 1; p <= pageCount; p++) {
      for (const r of payorContractPage(rows, p).rows) seen.add(r.id)
    }
    expect(pageCount).toBe(3)
    expect(seen.size).toBe(47)
    // Row 21 and the last row are exactly what the old table could not show.
    expect(seen.has("p-20")).toBe(true)
    expect(seen.has("p-46")).toBe(true)
  })

  it("reports a 1-based range over the filtered set", () => {
    expect(payorContractPage(rows, 1)).toMatchObject({ from: 1, to: 20 })
    expect(payorContractPage(rows, 3)).toMatchObject({ from: 41, to: 47 })
  })

  it("clamps instead of stranding the user on an empty page", () => {
    // Page 3 of 47 rows, then a search cuts the set to 5.
    const narrowed = rows.slice(0, 5)
    const slice = payorContractPage(narrowed, 3)
    expect(slice.page).toBe(1)
    expect(slice.pageCount).toBe(1)
    expect(slice.rows).toHaveLength(5)
    expect(payorContractPage(rows, 0).page).toBe(1)
  })

  it("handles an empty set without claiming a first row", () => {
    expect(payorContractPage([], 1)).toMatchObject({
      page: 1,
      pageCount: 1,
      from: 0,
      to: 0,
    })
  })
})
