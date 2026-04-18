import { describe, it, expect } from "vitest"
import {
  searchIndexedDocuments,
  type IndexedPage,
} from "../document-search"

const makePage = (overrides: Partial<IndexedPage>): IndexedPage => ({
  documentId: "doc_1",
  pageNumber: 1,
  text: "",
  ...overrides,
})

describe("searchIndexedDocuments", () => {
  it("returns empty array when the query has no usable terms", () => {
    const pages: IndexedPage[] = [
      makePage({ text: "Contract pricing terms apply here." }),
    ]
    expect(searchIndexedDocuments(pages, "")).toEqual([])
    expect(searchIndexedDocuments(pages, "    ")).toEqual([])
  })

  it("returns empty array when given zero pages", () => {
    expect(searchIndexedDocuments([], "pricing")).toEqual([])
  })

  it("finds matching pages for a single-term query (case-insensitive)", () => {
    const pages: IndexedPage[] = [
      makePage({
        documentId: "doc_a",
        pageNumber: 2,
        text: "This vendor Pricing schedule runs through 2027.",
      }),
      makePage({
        documentId: "doc_a",
        pageNumber: 3,
        text: "Unrelated clause about delivery windows.",
      }),
    ]
    const hits = searchIndexedDocuments(pages, "pricing")
    expect(hits).toHaveLength(1)
    expect(hits[0].documentId).toBe("doc_a")
    expect(hits[0].pageNumber).toBe(2)
    expect(hits[0].matchedText.toLowerCase()).toContain("pricing")
  })

  it("enforces AND semantics across multiple terms", () => {
    const pages: IndexedPage[] = [
      makePage({
        documentId: "match",
        pageNumber: 1,
        text: "Contract pricing addendum — tier 2 thresholds.",
      }),
      makePage({
        documentId: "only-contract",
        pageNumber: 1,
        text: "Contract termination clause with no rate info.",
      }),
      makePage({
        documentId: "only-pricing",
        pageNumber: 1,
        text: "Pricing list for vendor catalog Q4.",
      }),
    ]
    const hits = searchIndexedDocuments(pages, "contract pricing")
    expect(hits).toHaveLength(1)
    expect(hits[0].documentId).toBe("match")
  })

  it("narrows by vendor filter", () => {
    const pages: IndexedPage[] = [
      makePage({
        documentId: "medtronic-1",
        text: "Pricing schedule for implants.",
        vendor: "Medtronic",
      }),
      makePage({
        documentId: "stryker-1",
        text: "Pricing schedule for implants.",
        vendor: "Stryker",
      }),
    ]
    const hits = searchIndexedDocuments(pages, "pricing", {
      vendorFilter: "Stryker",
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].vendor).toBe("Stryker")
    expect(hits[0].documentId).toBe("stryker-1")
  })

  it("respects the `limit` option", () => {
    const pages: IndexedPage[] = Array.from({ length: 10 }, (_, i) =>
      makePage({
        documentId: `doc_${i}`,
        pageNumber: i + 1,
        // Vary the match density so scores are distinct.
        text: `pricing ${"filler ".repeat(i + 1)}pricing`,
      }),
    )
    const hits = searchIndexedDocuments(pages, "pricing", { limit: 3 })
    expect(hits).toHaveLength(3)
  })

  it("sorts hits by relevanceScore descending", () => {
    const pages: IndexedPage[] = [
      makePage({
        documentId: "low",
        pageNumber: 1,
        // 1 occurrence in a long-ish page → low score.
        text:
          "pricing " + "lorem ipsum dolor sit amet ".repeat(20),
      }),
      makePage({
        documentId: "high",
        pageNumber: 1,
        // 3 occurrences in a short page → high score.
        text: "pricing pricing pricing",
      }),
      makePage({
        documentId: "mid",
        pageNumber: 1,
        text: "pricing pricing filler filler",
      }),
    ]
    const hits = searchIndexedDocuments(pages, "pricing")
    expect(hits.map((h) => h.documentId)).toEqual(["high", "mid", "low"])
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].relevanceScore).toBeGreaterThanOrEqual(
        hits[i].relevanceScore,
      )
    }
  })

  it("returns context with up to ±200 chars around the first match", () => {
    const prefix = "A".repeat(500)
    const suffix = "B".repeat(500)
    const pages: IndexedPage[] = [
      makePage({
        documentId: "ctx",
        pageNumber: 1,
        text: `${prefix}pricing${suffix}`,
      }),
    ]
    const [hit] = searchIndexedDocuments(pages, "pricing")
    // 200 before + len("pricing") + 200 after = 407 chars.
    expect(hit.context.length).toBe(407)
    expect(hit.context.startsWith("A")).toBe(true)
    expect(hit.context.endsWith("B")).toBe(true)
    expect(hit.context).toContain("pricing")
    // matchedText is a smaller ±50 radius.
    expect(hit.matchedText.length).toBeLessThan(hit.context.length)
    expect(hit.matchedText).toContain("pricing")
  })

  it("narrows by documentType filter", () => {
    const pages: IndexedPage[] = [
      makePage({
        documentId: "ps-1",
        text: "pricing details",
        documentType: "PriceSchedule",
      }),
      makePage({
        documentId: "msa-1",
        text: "pricing details",
        documentType: "MSA",
      }),
    ]
    const hits = searchIndexedDocuments(pages, "pricing", {
      documentTypeFilter: "MSA",
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].documentType).toBe("MSA")
  })
})
