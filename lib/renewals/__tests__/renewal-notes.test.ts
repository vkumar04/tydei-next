import { describe, it, expect } from "vitest"
import {
  validateRenewalNote,
  sortNotesNewestFirst,
  RenewalNoteValidationError,
  type RenewalNote,
} from "../renewal-notes"

describe("validateRenewalNote", () => {
  it("accepts a well-formed note", () => {
    const r = validateRenewalNote({
      contractId: "c-1",
      note: "Call vendor about pricing",
    })
    expect(r).toEqual({
      contractId: "c-1",
      note: "Call vendor about pricing",
      authorId: null,
    })
  })

  it("preserves authorId when provided", () => {
    const r = validateRenewalNote({
      contractId: "c-1",
      note: "X",
      authorId: "user-123",
    })
    expect(r.authorId).toBe("user-123")
  })

  it("trims the note", () => {
    const r = validateRenewalNote({
      contractId: "c-1",
      note: "   padded   ",
    })
    expect(r.note).toBe("padded")
  })

  it("trims the contractId", () => {
    const r = validateRenewalNote({
      contractId: "  c-1  ",
      note: "X",
    })
    expect(r.contractId).toBe("c-1")
  })

  it("rejects non-object input", () => {
    expect(() => validateRenewalNote(null)).toThrow(RenewalNoteValidationError)
    expect(() => validateRenewalNote("string")).toThrow(RenewalNoteValidationError)
    // Arrays pass the typeof-object check but fail at contractId missing.
    expect(() => validateRenewalNote([])).toThrow(/contractId/)
  })

  it("rejects missing / empty contractId", () => {
    expect(() => validateRenewalNote({ note: "X" })).toThrow(
      /contractId/,
    )
    expect(() => validateRenewalNote({ contractId: "", note: "X" })).toThrow(
      /contractId/,
    )
    expect(() =>
      validateRenewalNote({ contractId: "   ", note: "X" }),
    ).toThrow(/contractId/)
  })

  it("rejects missing / empty note", () => {
    expect(() => validateRenewalNote({ contractId: "c-1" })).toThrow(/note/)
    expect(() =>
      validateRenewalNote({ contractId: "c-1", note: "" }),
    ).toThrow(/cannot be empty/)
    expect(() =>
      validateRenewalNote({ contractId: "c-1", note: "   " }),
    ).toThrow(/cannot be empty/)
  })

  it("rejects over-long note (>5000 chars)", () => {
    expect(() =>
      validateRenewalNote({ contractId: "c-1", note: "x".repeat(5001) }),
    ).toThrow(/too long/)
  })

  it("accepts note exactly at 5000 chars", () => {
    const r = validateRenewalNote({
      contractId: "c-1",
      note: "x".repeat(5000),
    })
    expect(r.note).toHaveLength(5000)
  })

  it("throws with RenewalNoteValidationError carrying field + reason", () => {
    try {
      validateRenewalNote({ contractId: "c-1", note: "" })
      expect.fail("expected throw")
    } catch (err) {
      expect(err).toBeInstanceOf(RenewalNoteValidationError)
      const rvErr = err as RenewalNoteValidationError
      expect(rvErr.field).toBe("note")
      expect(rvErr.reason).toContain("cannot be empty")
    }
  })
})

describe("sortNotesNewestFirst", () => {
  const note = (
    id: string,
    createdAt: Date,
  ): RenewalNote => ({
    id,
    contractId: "c-1",
    note: "...",
    authorId: "user-1",
    createdAt,
  })

  it("returns notes newest-first", () => {
    const notes = [
      note("a", new Date("2026-01-01")),
      note("b", new Date("2026-03-01")),
      note("c", new Date("2026-02-01")),
    ]
    const sorted = sortNotesNewestFirst(notes)
    expect(sorted.map((n) => n.id)).toEqual(["b", "c", "a"])
  })

  it("tie-breaks by id descending when timestamps match", () => {
    const t = new Date("2026-04-18T12:00:00Z")
    const notes = [
      note("alpha", t),
      note("charlie", t),
      note("bravo", t),
    ]
    const sorted = sortNotesNewestFirst(notes)
    expect(sorted.map((n) => n.id)).toEqual(["charlie", "bravo", "alpha"])
  })

  it("does not mutate input array", () => {
    const notes = [note("a", new Date("2026-01-01"))]
    const ref = notes
    sortNotesNewestFirst(notes)
    expect(notes).toBe(ref)
    expect(notes[0].id).toBe("a")
  })

  it("handles empty input", () => {
    expect(sortNotesNewestFirst([])).toEqual([])
  })
})
