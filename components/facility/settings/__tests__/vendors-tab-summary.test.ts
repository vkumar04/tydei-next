/**
 * The row-count sentence under the vendor table.
 *
 * Facility Settings → Vendors used to render one 100-row page of a 200-vendor
 * catalog with no pager and no count, so ranks 101–200 (including "Stryker" at
 * 176, which holds a live contract) were unreachable AND unmentioned. A silent
 * cap is the bug; a labelled one is a feature — so this helper is the label,
 * and every number in it must come from the server response that produced the
 * rows, never from the length of the page.
 *
 * `describeVendorPage` is pure, so it is tested directly the way
 * `specific-items-picker`'s helpers are.
 */
import { describe, it, expect, vi } from "vitest"

// The tab imports server actions; keep the module graph out of this test.
vi.mock("@/lib/actions/vendors", () => ({
  getVendorList: vi.fn(),
  createVendor: vi.fn(),
  updateVendor: vi.fn(),
  deactivateVendor: vi.fn(),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { describeVendorPage } = await import(
  "@/components/facility/settings/tabs/vendors-tab"
)

describe("describeVendorPage", () => {
  it("reports the catalog total, not the size of the page", () => {
    const label = describeVendorPage({
      rowCount: 25,
      page: 1,
      pageSize: 25,
      total: 200,
      catalogTotal: 200,
      search: "",
    })
    expect(label).toBe("Showing 1–25 of 200 vendors")
    // The exact regression: "200" must appear as the total, "25" must not.
    expect(label).not.toBe("Showing 1–25 of 25 vendors")
  })

  it("moves the range with the page so the last rank is visibly reachable", () => {
    expect(
      describeVendorPage({
        rowCount: 25,
        page: 8,
        pageSize: 25,
        total: 200,
        catalogTotal: 200,
        search: "",
      }),
    ).toBe("Showing 176–200 of 200 vendors")
  })

  it("handles a short final page", () => {
    expect(
      describeVendorPage({
        rowCount: 7,
        page: 9,
        pageSize: 25,
        total: 207,
        catalogTotal: 207,
        search: "",
      }),
    ).toBe("Showing 201–207 of 207 vendors")
  })

  it("keeps the matching count and the catalog count separately labelled", () => {
    const label = describeVendorPage({
      rowCount: 1,
      page: 1,
      pageSize: 25,
      total: 1,
      catalogTotal: 200,
      search: "stryk",
    })
    expect(label).toBe("Showing 1–1 of 1 vendor matching “stryk” (of 200 total)")
  })

  it("says the empty search covered the whole catalog, not just this page", () => {
    const label = describeVendorPage({
      rowCount: 0,
      page: 1,
      pageSize: 25,
      total: 0,
      catalogTotal: 200,
      search: " zimme r ".trim(),
    })
    expect(label).toBe("No vendors match “zimme r” — searched all 200 vendors.")
  })

  it("never renders a backwards range when the page holds no rows", () => {
    // `total` and the rows come from two round trips; a delete between them can
    // leave a non-empty total with an empty page. The old arithmetic would have
    // said "Showing 26–25 of 200 vendors".
    const label = describeVendorPage({
      rowCount: 0,
      page: 2,
      pageSize: 25,
      total: 200,
      catalogTotal: 200,
      search: "",
    })
    expect(label).toBe("No vendors on page 2 — 200 vendors in total.")
    expect(label).not.toMatch(/26–25/)
  })

  it("distinguishes an empty catalog from an empty search result", () => {
    expect(
      describeVendorPage({
        rowCount: 0,
        page: 1,
        pageSize: 25,
        total: 0,
        catalogTotal: 0,
        search: "",
      }),
    ).toBe("No vendors yet.")
  })

  it("ignores a whitespace-only search the way the server does", () => {
    expect(
      describeVendorPage({
        rowCount: 25,
        page: 1,
        pageSize: 25,
        total: 200,
        catalogTotal: 200,
        search: "   ",
      }),
    ).toBe("Showing 1–25 of 200 vendors")
  })
})
