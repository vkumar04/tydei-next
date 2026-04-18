import { describe, it, expect } from "vitest"
import {
  RenewalAlertSettingsValidationError,
  validateRenewalAlertSettings,
} from "../alert-settings"

const baseInput = () => ({
  renewalReminderDaysBefore: [180, 90, 30],
  expirationAlertDays: 60,
  includeUnderperformingContracts: true,
  includeOverperformingContracts: false,
  notifyChannels: ["email", "in_app"] as const,
})

describe("validateRenewalAlertSettings", () => {
  it("accepts a well-formed happy-path input", () => {
    const result = validateRenewalAlertSettings(baseInput())
    expect(result.renewalReminderDaysBefore).toEqual([180, 90, 30])
    expect(result.expirationAlertDays).toBe(60)
    expect(result.includeUnderperformingContracts).toBe(true)
    expect(result.includeOverperformingContracts).toBe(false)
    expect(result.notifyChannels).toEqual(["email", "in_app"])
  })

  it("auto-sorts renewalReminderDaysBefore in descending order", () => {
    const result = validateRenewalAlertSettings({
      ...baseInput(),
      renewalReminderDaysBefore: [30, 180, 90],
    })
    expect(result.renewalReminderDaysBefore).toEqual([180, 90, 30])
  })

  it("deduplicates notifyChannels while preserving first-seen order", () => {
    const result = validateRenewalAlertSettings({
      ...baseInput(),
      notifyChannels: ["slack", "email", "slack", "in_app", "email"],
    })
    expect(result.notifyChannels).toEqual(["slack", "email", "in_app"])
  })

  it("rejects a non-object input", () => {
    expect(() => validateRenewalAlertSettings(null)).toThrow(
      RenewalAlertSettingsValidationError,
    )
    expect(() => validateRenewalAlertSettings("nope")).toThrow(
      RenewalAlertSettingsValidationError,
    )
    expect(() => validateRenewalAlertSettings([])).toThrow(
      RenewalAlertSettingsValidationError,
    )
  })

  it("rejects missing required fields", () => {
    expect(() => validateRenewalAlertSettings({})).toThrow(
      /renewalReminderDaysBefore/,
    )
    expect(() =>
      validateRenewalAlertSettings({
        renewalReminderDaysBefore: [30],
      }),
    ).toThrow(/expirationAlertDays/)
    expect(() =>
      validateRenewalAlertSettings({
        renewalReminderDaysBefore: [30],
        expirationAlertDays: 60,
      }),
    ).toThrow(/includeUnderperformingContracts/)
  })

  it("rejects an empty renewalReminderDaysBefore array", () => {
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        renewalReminderDaysBefore: [],
      }),
    ).toThrow(/non-empty/)
  })

  it("rejects non-positive or non-integer reminder entries", () => {
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        renewalReminderDaysBefore: [30, 0, 90],
      }),
    ).toThrow(/positive integer/)
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        renewalReminderDaysBefore: [30, -5],
      }),
    ).toThrow(/positive integer/)
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        renewalReminderDaysBefore: [30, 1.5],
      }),
    ).toThrow(/positive integer/)
  })

  it("rejects duplicate reminder entries", () => {
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        renewalReminderDaysBefore: [30, 90, 30],
      }),
    ).toThrow(/duplicate/)
  })

  it("rejects more than 5 reminder entries", () => {
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        renewalReminderDaysBefore: [365, 180, 90, 60, 30, 7],
      }),
    ).toThrow(/at most 5/)
  })

  it("rejects expirationAlertDays that are not positive integers", () => {
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        expirationAlertDays: 0,
      }),
    ).toThrow(/positive integer/)
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        expirationAlertDays: -1,
      }),
    ).toThrow(/positive integer/)
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        expirationAlertDays: 3.14,
      }),
    ).toThrow(/positive integer/)
  })

  it("rejects expirationAlertDays greater than 365", () => {
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        expirationAlertDays: 400,
      }),
    ).toThrow(/<= 365/)
  })

  it("rejects non-boolean include flags", () => {
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        includeUnderperformingContracts: "yes",
      }),
    ).toThrow(/includeUnderperformingContracts/)
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        includeOverperformingContracts: 1,
      }),
    ).toThrow(/includeOverperformingContracts/)
  })

  it("rejects unknown notifyChannels values", () => {
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        notifyChannels: ["email", "sms"],
      }),
    ).toThrow(/notifyChannels/)
  })

  it("rejects an empty notifyChannels array", () => {
    expect(() =>
      validateRenewalAlertSettings({
        ...baseInput(),
        notifyChannels: [],
      }),
    ).toThrow(/non-empty/)
  })

  it("attaches the offending field on RenewalAlertSettingsValidationError", () => {
    try {
      validateRenewalAlertSettings({
        ...baseInput(),
        expirationAlertDays: 500,
      })
      expect.fail("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(RenewalAlertSettingsValidationError)
      if (err instanceof RenewalAlertSettingsValidationError) {
        expect(err.field).toBe("expirationAlertDays")
        expect(err.reason).toMatch(/<= 365/)
      }
    }
  })
})
