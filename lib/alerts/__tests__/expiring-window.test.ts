/**
 * Tests for resolveExpiringWindowDays (lib/alerts/expiring-window.ts) —
 * the fold from per-user RenewalAlertSettings rows to the single
 * per-facility expiring_contract window.
 */
import { describe, it, expect } from "vitest"
import { resolveExpiringWindowDays } from "../expiring-window"

describe("resolveExpiringWindowDays", () => {
  it("returns undefined when no settings rows exist (fallback to constant)", () => {
    expect(resolveExpiringWindowDays([])).toBeUndefined()
  })

  it("uses expirationAlertDays when it is the only threshold", () => {
    expect(
      resolveExpiringWindowDays([
        { expirationAlertDays: 60, renewalReminderDaysBefore: [] },
      ]),
    ).toBe(60)
  })

  it("takes the max across expirationAlertDays and reminder thresholds", () => {
    expect(
      resolveExpiringWindowDays([
        { expirationAlertDays: 60, renewalReminderDaysBefore: [180, 90, 30] },
      ]),
    ).toBe(180)
  })

  it("takes the max across multiple users' rows", () => {
    expect(
      resolveExpiringWindowDays([
        { expirationAlertDays: 45, renewalReminderDaysBefore: [30] },
        { expirationAlertDays: 60, renewalReminderDaysBefore: [120] },
      ]),
    ).toBe(120)
  })

  it("ignores non-positive and non-finite values", () => {
    expect(
      resolveExpiringWindowDays([
        {
          expirationAlertDays: 0,
          renewalReminderDaysBefore: [-5, Number.NaN, Number.POSITIVE_INFINITY],
        },
      ]),
    ).toBeUndefined()
    expect(
      resolveExpiringWindowDays([
        { expirationAlertDays: -1, renewalReminderDaysBefore: [45] },
      ]),
    ).toBe(45)
  })
})
