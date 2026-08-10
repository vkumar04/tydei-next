/**
 * Payor-reported procedure volume — types + row parsing.
 *
 * A payor volume file reports quarterly case counts per procedure group
 * (columns: Procedure Group / Year / Quarter / Volume, naming variants
 * tolerated). Vendors upload one per facility to ground the Dividend/DCF
 * scenario in payor-verified case mix. Rows arrive as `Record<string,string>`
 * from `parseXlsxBufferToRows` (xlsx) or the CSV splitter — this module never
 * touches the workbook itself.
 */

/** One quarter of payor-reported volume for a procedure group. */
export interface PayorQuarter {
  year: number
  quarter: number
  volume: number
}

/** A payor-reported procedure group and its volume history. */
export interface PayorProcedureGroup {
  group: string
  quarters: PayorQuarter[]
  /** Sum of all reported quarters. */
  totalVolume: number
  /** Annualized (trailing-four-quarter) case volume. */
  annualizedVolume: number
}

export interface ParsedPayorVolume {
  groups: PayorProcedureGroup[]
  /** Sorted distinct `YYYY-Qn` period keys seen in the file. */
  periods: string[]
  totalAnnualizedVolume: number
}

/** One vendor-uploaded dataset, as the Dividend/DCF picker sees it. */
export interface PayorVolumeDatasetView {
  /** `PayorVolumeDataset.id`. */
  id: string
  /** `facility:<facilityId>` | `adhoc:<normalized label>` — the picker key. */
  facilityKey: string
  facilityLabel: string
  /** True when tied to a connected Facility row. */
  connected: boolean
  fileName: string
  periods: string[]
  groups: PayorProcedureGroup[]
  totalAnnualizedVolume: number
  uploadedAt: string | null
}

function pick(
  row: Record<string, string>,
  candidates: string[],
): string | undefined {
  const keys = Object.keys(row)
  for (const cand of candidates) {
    const hit = keys.find((k) => k.trim().toLowerCase() === cand)
    if (hit !== undefined) return row[hit]
  }
  for (const cand of candidates) {
    const hit = keys.find((k) => k.trim().toLowerCase().includes(cand))
    if (hit !== undefined) return row[hit]
  }
  return undefined
}

function toNumber(v: string | undefined): number {
  if (v === undefined) return 0
  const n = Number(v.replace(/[^0-9.-]/g, ""))
  // Finite guard: "1e999"-style cells coerce to Infinity, which would
  // otherwise flow into stored volumes and every downstream sum.
  return Number.isFinite(n) ? n : 0
}

export function annualize(quarters: PayorQuarter[]): {
  total: number
  annualized: number
} {
  const total = quarters.reduce((s, q) => s + q.volume, 0)
  const sorted = [...quarters].sort(
    (a, b) => a.year - b.year || a.quarter - b.quarter,
  )
  const lastFour = sorted.slice(-4)
  const sumLastFour = lastFour.reduce((s, q) => s + q.volume, 0)
  // A full trailing year is used as-is; fewer quarters scale to 4.
  const annualized =
    lastFour.length >= 4
      ? sumLastFour
      : Math.round((sumLastFour / (lastFour.length || 1)) * 4)
  return { total, annualized }
}

/**
 * Parse header-keyed rows (Procedure Group / Year / Quarter / Volume) into
 * per-group quarterly volume. Tolerant of header naming variants and "Q2"
 * style quarter values; duplicate (group, quarter) rows sum.
 */
export function parsePayorVolumeRows(
  rows: Record<string, string>[],
): ParsedPayorVolume {
  const byGroup = new Map<string, Map<string, PayorQuarter>>()
  const periodSet = new Set<string>()

  for (const row of rows) {
    const group = String(
      pick(row, ["procedure group", "group", "procedure", "category"]) ?? "",
    ).trim()
    if (!group) continue

    const year = toNumber(pick(row, ["year", "yr", "fiscal year"]))
    let quarter = toNumber(pick(row, ["quarter", "qtr", "q"]))
    if (!quarter) {
      // Anchored + length-capped. The unanchored `/q?\s*([1-4])/i` retried at
      // every start position, and `\s*` rescanned the whitespace run from
      // each — quadratic: a 200KB cell of spaces blocked the event loop for
      // 17s. A real quarter cell is "Q2" / "2" / " Q 2 ".
      const qraw = String(pick(row, ["quarter", "qtr", "q", "period"]) ?? "")
        .trim()
        .slice(0, 16)
      const m = /^q?\s?([1-4])$/i.exec(qraw)
      if (m) quarter = Number(m[1])
    }
    const volume = toNumber(
      pick(row, ["volume", "cases", "case volume", "count", "qty"]),
    )
    // Range-check rather than trusting the numeric branch: a cell reading "5"
    // parsed straight through and minted a bogus `2025-Q5` bucket.
    if (!year || !Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
      continue
    }

    if (!byGroup.has(group)) byGroup.set(group, new Map())
    const qkey = `${year}-Q${quarter}`
    periodSet.add(qkey)
    const gmap = byGroup.get(group)!
    const existing = gmap.get(qkey)
    if (existing) existing.volume += volume
    else gmap.set(qkey, { year, quarter, volume })
  }

  const groups: PayorProcedureGroup[] = Array.from(byGroup.entries()).map(
    ([group, gmap]) => {
      const quarters = Array.from(gmap.values()).sort(
        (a, b) => a.year - b.year || a.quarter - b.quarter,
      )
      const { total, annualized } = annualize(quarters)
      return {
        group,
        quarters,
        totalVolume: total,
        annualizedVolume: annualized,
      }
    },
  )

  groups.sort((a, b) => b.annualizedVolume - a.annualizedVolume)

  const periods = Array.from(periodSet).sort()
  const totalAnnualizedVolume = groups.reduce(
    (s, g) => s + g.annualizedVolume,
    0,
  )

  return { groups, periods, totalAnnualizedVolume }
}

/** Quarter-over-quarter trend for a group: latest vs. first reported quarter. */
export function getPayorTrend(group: PayorProcedureGroup): {
  changePercent: number
  direction: "up" | "down" | "flat"
} {
  const q = group.quarters
  if (q.length < 2) return { changePercent: 0, direction: "flat" }
  const first = q[0].volume
  const last = q[q.length - 1].volume
  if (first === 0) return { changePercent: 0, direction: "flat" }
  const changePercent = ((last - first) / first) * 100
  return {
    changePercent: Math.round(changePercent * 10) / 10,
    direction: changePercent > 1 ? "up" : changePercent < -1 ? "down" : "flat",
  }
}
