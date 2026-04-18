import { describe, it, expect } from "vitest"
import {
  splitTextIntoPages,
  normalizePageText,
} from "../text-extraction"

describe("splitTextIntoPages", () => {
  it("splits on form-feed characters into one page each", () => {
    const raw = "page one body\fpage two body\fpage three body"
    const pages = splitTextIntoPages(raw)
    expect(pages).toHaveLength(3)
    expect(pages[0]).toEqual({ pageNumber: 1, text: "page one body" })
    expect(pages[1]).toEqual({ pageNumber: 2, text: "page two body" })
    expect(pages[2]).toEqual({ pageNumber: 3, text: "page three body" })
  })

  it("splits on the explicit <<<PAGE_BREAK>>> marker", () => {
    const raw = "alpha<<<PAGE_BREAK>>>beta"
    const pages = splitTextIntoPages(raw)
    expect(pages).toHaveLength(2)
    expect(pages[0].text).toBe("alpha")
    expect(pages[1].text).toBe("beta")
  })

  it("returns a single page when no separator is present", () => {
    const raw = "the whole document is one blob of text"
    const pages = splitTextIntoPages(raw)
    expect(pages).toHaveLength(1)
    expect(pages[0]).toEqual({ pageNumber: 1, text: raw })
  })

  it("returns a single empty page for empty input", () => {
    expect(splitTextIntoPages("")).toEqual([{ pageNumber: 1, text: "" }])
  })
})

describe("normalizePageText", () => {
  it("collapses runs of whitespace and trims each page", () => {
    const pages = [
      { pageNumber: 1, text: "  hello    world  \n\n  foo\tbar  " },
    ]
    const out = normalizePageText(pages)
    expect(out[0].text).toBe("hello world foo bar")
  })

  it("removes a header that repeats at the top of 3+ pages", () => {
    const header = "CONFIDENTIAL — ACME CORP"
    const pages = [
      { pageNumber: 1, text: `${header}\nFirst page body content.` },
      { pageNumber: 2, text: `${header}\nSecond page body content.` },
      { pageNumber: 3, text: `${header}\nThird page body content.` },
      { pageNumber: 4, text: "Fourth page body — no header." },
    ]
    const out = normalizePageText(pages)
    expect(out[0].text).toBe("First page body content.")
    expect(out[1].text).toBe("Second page body content.")
    expect(out[2].text).toBe("Third page body content.")
    expect(out[3].text).toBe("Fourth page body — no header.")
    for (const p of out) {
      expect(p.text).not.toContain("CONFIDENTIAL")
    }
  })

  it("keeps a header that appears on only 2 pages (below the 3-page threshold)", () => {
    const header = "ONLY SOMETIMES"
    const pages = [
      { pageNumber: 1, text: `${header}\nbody one` },
      { pageNumber: 2, text: `${header}\nbody two` },
      { pageNumber: 3, text: "body three" },
    ]
    const out = normalizePageText(pages)
    expect(out[0].text).toContain("ONLY SOMETIMES")
    expect(out[1].text).toContain("ONLY SOMETIMES")
  })

  it("removes a repeated footer when present on 3+ pages", () => {
    const footer = "Page footer — rev 2024.01"
    const pages = [
      { pageNumber: 1, text: `Body one\n${footer}` },
      { pageNumber: 2, text: `Body two\n${footer}` },
      { pageNumber: 3, text: `Body three\n${footer}` },
    ]
    const out = normalizePageText(pages)
    for (const p of out) {
      expect(p.text).not.toContain("Page footer")
    }
  })

  it("handles an empty input array", () => {
    expect(normalizePageText([])).toEqual([])
  })
})
