/**
 * Per-facility expiring-contract window derivation (closes the
 * 2026-06-09 renewals+alerts audit M14 "settings are write-only" gap).
 *
 * `RenewalAlertSettings` is USER-scoped (one row per user) while alert
 * synthesis is FACILITY-scoped, so the caller loads the settings rows
 * of every facility-org member and this helper folds them into a
 * single effective window:
 *
 *   - An expiring_contract alert should fire when daysUntilExpiry
 *     crosses ANY configured threshold (`expirationAlertDays` plus
 *     every entry of `renewalReminderDaysBefore`). Because the alert
 *     is deduped per contract (`expiring_contract:<contractId>`),
 *     "fires at any threshold" is exactly equivalent to "fires once
 *     daysUntilExpiry <= max(all thresholds)" — so the effective
 *     window is the max across every user and every threshold.
 *   - Non-positive / non-finite values are ignored (defensive: the
 *     validator already rejects them, but legacy rows predate it).
 *   - Returns `undefined` when no facility user has settings, which
 *     tells the synthesizer to fall back to
 *     EXPIRING_CONTRACT_WINDOW_DAYS (90).
 *
 * `notifyChannels` is deliberately NOT consumed here — see the TODO
 * in lib/actions/renewals/alert-settings.ts.
 */

export interface ExpiringWindowSettingsRow {
  expirationAlertDays: number
  renewalReminderDaysBefore: number[]
}

export function resolveExpiringWindowDays(
  rows: ExpiringWindowSettingsRow[],
): number | undefined {
  let max: number | undefined
  for (const row of rows) {
    const thresholds = [
      row.expirationAlertDays,
      ...row.renewalReminderDaysBefore,
    ]
    for (const d of thresholds) {
      if (!Number.isFinite(d) || d <= 0) continue
      max = max === undefined ? d : Math.max(max, d)
    }
  }
  return max
}
