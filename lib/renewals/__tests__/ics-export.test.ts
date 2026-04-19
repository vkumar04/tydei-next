/**
 * Tests for the RFC 5545 ICS generator (lib/renewals/ics-export.ts).
 */

import { describe, it, expect } from "vitest"
import {
  generateRenewalsICS,
  type RenewalEvent,
} from "../ics-export"

const sample: RenewalEvent[] = [
  {
    contractId: "ctr_abc123",
    contractName: "Surgical Supplies MSA",
    vendorName: "Acme Medical",
    expirationDate: "2026-09-15T00:00:00.000Z",
    daysRemaining: 45,
  },
  {
    contractId: "ctr_xyz789",
    contractName: "Imaging Consumables",
    vendorName: "Beta Imaging, Inc.",
    expirationDate: new Date(Date.UTC(2027, 0, 1)), // 2027-01-01
    daysRemaining: 180,
  },
]

describe("generateRenewalsICS", () => {
  it("wraps output in a VCALENDAR with VERSION and PRODID", () => {
    const ics = generateRenewalsICS(sample)
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true)
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true)
    expect(ics).toContain("VERSION:2.0")
    expect(ics).toContain("PRODID:-//Tydei//Tydei Renewals//EN")
  })

  it("uses CRLF line endings", () => {
    const ics = generateRenewalsICS(sample)
    // Every line break is CRLF
    const lfOnly = ics.replace(/\r\n/g, "").match(/\n/g)
    expect(lfOnly).toBeNull()
    expect(ics.includes("\r\n")).toBe(true)
  })

  it("emits one VEVENT per renewal", () => {
    const ics = generateRenewalsICS(sample)
    const begins = ics.match(/BEGIN:VEVENT/g) ?? []
    const ends = ics.match(/END:VEVENT/g) ?? []
    expect(begins.length).toBe(2)
    expect(ends.length).toBe(2)
  })

  it("renders each VEVENT with UID, DTSTART, SUMMARY, DESCRIPTION, STATUS", () => {
    const ics = generateRenewalsICS(sample)
    expect(ics).toContain("UID:renewal-ctr_abc123@tydei.app")
    expect(ics).toContain("UID:renewal-ctr_xyz789@tydei.app")
    expect(ics).toContain("DTSTART;VALUE=DATE:20260915")
    expect(ics).toContain("DTSTART;VALUE=DATE:20270101")
    expect(ics).toContain(
      "SUMMARY:Contract renewal: Surgical Supplies MSA (Acme Medical)",
    )
    expect(ics).toContain("STATUS:CONFIRMED")
  })

  it("escapes commas and semicolons in text values per §3.3.11", () => {
    const ics = generateRenewalsICS(sample)
    // "Beta Imaging, Inc." → the comma is escaped inside SUMMARY
    expect(ics).toContain(
      "SUMMARY:Contract renewal: Imaging Consumables (Beta Imaging\\, Inc.)",
    )
  })

  it("produces an empty calendar body when there are no renewals", () => {
    const ics = generateRenewalsICS([])
    expect(ics).toContain("BEGIN:VCALENDAR")
    expect(ics).toContain("END:VCALENDAR")
    expect(ics).not.toContain("BEGIN:VEVENT")
  })

  it("folds content lines longer than 75 octets (§3.1)", () => {
    const long: RenewalEvent = {
      contractId: "ctr_long",
      contractName: "A".repeat(120),
      vendorName: "B".repeat(40),
      expirationDate: "2026-12-31T00:00:00.000Z",
      daysRemaining: 200,
    }
    const ics = generateRenewalsICS([long])
    const lines = ics.split("\r\n")
    for (const line of lines) {
      // UTF-8 byte length (all ASCII here) must be ≤75.
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
    // Continuation lines must start with whitespace.
    const folded = lines.filter((l) => l.startsWith(" "))
    expect(folded.length).toBeGreaterThan(0)
  })
})
