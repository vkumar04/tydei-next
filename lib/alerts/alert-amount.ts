/**
 * Pure helpers for surfacing the dollar impact of an alert inline on its row.
 *
 * The amount lives in `Alert.metadata` under any of a handful of conventional
 * keys — the synthesizer is not perfectly uniform, and off_contract /
 * expiring alerts use snake_case (`total_amount`, `annual_value`) while older
 * emitters use camelCase. Probe in order; first positive finite number wins.
 * (Lifted from the inline copy in alert-card.tsx, extended with the
 * snake_case keys.)
 */
export function extractAlertAmount(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null
  const m = metadata as Record<string, unknown>
  const candidates = [
    m.total_amount,
    m.amount,
    m.totalAmount,
    m.dollarAmount,
    m.annual_value,
    m.value,
    m.spend,
    m.spendAmount,
  ]
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c > 0) return c
    if (typeof c === "string") {
      const n = Number(c)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

export function formatAlertAmount(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}
