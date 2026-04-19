/**
 * Unit tests for the pure display helpers that drive the vendor
 * renewal-notes timeline (W1.8).
 *
 * The timeline component itself is a thin TanStack-query shell over
 * `listRenewalNotesForVendor` + the two helpers below. Locking in
 * initials / display-name behavior here keeps the UI stable against
 * legacy `RenewalNote` rows that lack an `author.name` (seed data).
 */
import { describe, it, expect } from "vitest"
import {
  authorInitials,
  authorDisplayName,
} from "@/lib/renewals/renewal-note-display"

describe("authorInitials", () => {
  it("returns uppercase first-two-word initials when name is present", () => {
    expect(authorInitials("Vick Kumar", "user-1")).toBe("VK")
    expect(authorInitials("alice bob charlie", "user-1")).toBe("AB")
  })

  it("returns a single initial for a single-word name", () => {
    expect(authorInitials("Alice", "user-1")).toBe("A")
  })

  it("falls back to authorId prefix when name is null / empty", () => {
    expect(authorInitials(null, "abc-123")).toBe("AB")
    expect(authorInitials("", "abc-123")).toBe("AB")
    expect(authorInitials("   ", "abc-123")).toBe("AB")
  })

  it("never returns empty even with pathological input", () => {
    expect(authorInitials(undefined, "")).toBe("??")
  })

  it("ignores extra whitespace in the name", () => {
    expect(authorInitials("  Vick   Kumar  ", "x")).toBe("VK")
  })
})

describe("authorDisplayName", () => {
  it("returns the trimmed name when present", () => {
    expect(authorDisplayName("Vick Kumar")).toBe("Vick Kumar")
    expect(authorDisplayName("  Alice  ")).toBe("Alice")
  })

  it("falls back to a generic label when name is missing", () => {
    expect(authorDisplayName(null)).toBe("Team member")
    expect(authorDisplayName(undefined)).toBe("Team member")
    expect(authorDisplayName("")).toBe("Team member")
    expect(authorDisplayName("   ")).toBe("Team member")
  })
})
