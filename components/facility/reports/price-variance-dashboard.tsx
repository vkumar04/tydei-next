"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts"
import { queryKeys } from "@/lib/query-keys"
import { getPriceVarianceSeverityBreakdown } from "@/lib/actions/reports"
import {
  formatCompactCurrency,
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/formatting"
import { AlertTriangle, DollarSign, FileWarning, TrendingUp } from "lucide-react"

// ─── Severity helpers ───────────────────────────────────────────

export type Severity = "minor" | "moderate" | "major"

export const SEVERITY_ORDER = ["major", "moderate", "minor"] as const satisfies
  readonly Severity[]

/**
 * Labels for the three |variance %| bands. The thresholds quoted here
 * are the user-visible contract for `SEVERITY_BAND_WHERE` in
 * `lib/actions/reports.ts`, which is where the bucketing actually
 * happens (in Postgres, over the whole facility). Change one and you
 * must change the other.
 */
const SEVERITY_META: Record<
  Severity,
  { label: string; className: string; dot: string }
> = {
  minor: {
    label: "Minor (<2%)",
    className:
      "bg-green-100 text-green-700 border-0 dark:bg-green-900 dark:text-green-300",
    dot: "bg-green-500",
  },
  moderate: {
    label: "Moderate (2–10%)",
    className:
      "bg-amber-100 text-amber-700 border-0 dark:bg-amber-900 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  major: {
    label: "Major (≥10%)",
    className:
      "bg-red-100 text-red-700 border-0 dark:bg-red-900 dark:text-red-300",
    dot: "bg-red-500",
  },
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge className={SEVERITY_META[severity].className}>
      {SEVERITY_META[severity].label}
    </Badge>
  )
}

// ─── Scope captions (pure — unit-tested) ────────────────────────

type Breakdown = Awaited<ReturnType<typeof getPriceVarianceSeverityBreakdown>>

export type VendorVarianceRow = Breakdown["vendors"][number]

/** How many vendors the "Vendor totals" table renders. */
export const VENDOR_ROW_LIMIT = 20

/**
 * Subtitle under a severity card's line count. The card's headline is a
 * COUNT, so the money beside it must name both directions rather than a
 * single netted "impact": in the production snapshot the major band
 * holds $1.9M of overcharge AND $4.2M of discount, and one netted
 * figure would report −$2.28M — hiding every recoverable dollar behind
 * the discounts that happen to outweigh them.
 */
export function buildSeverityCardSubtitle(bucket: {
  overchargeTotal: number
  underchargeTotal: number
}): string {
  return (
    `${formatCompactCurrency(bucket.overchargeTotal)} over contract · ` +
    `${formatCompactCurrency(bucket.underchargeTotal)} under`
  )
}

/**
 * The scope line under a severity card's money.
 *
 * Two things have to be said out loud here, both of them "the number is
 * over a narrower set than the label suggests":
 *
 *  • `withoutDollarImpact` — banded lines carrying no dollar figure, so
 *    the two money figures beside them do not add up to the count above.
 *  • The MINOR band is structurally empty on this report. The matcher
 *    (`PRICE_VARIANCE_THRESHOLD` in lib/contracts/match.ts) stamps
 *    anything within ±2% of contract as `on_contract`, and the report's
 *    set is `price_variance` + `off_contract_item` only — so a line
 *    inside ±2% never reaches this tab. Without the note, a permanent
 *    "Minor (<2%) — 0 — facility-wide" reads as "this facility has no
 *    small price variances", which is false: it has them, they are just
 *    not discrepancies. Kept as a note rather than deleting the card so
 *    a re-import that ever does produce one still has somewhere to land.
 */
export function buildSeverityCardScopeLine(input: {
  severity: Severity
  lines: number
  withoutDollarImpact: number
}): string {
  const parts = ["facility-wide"]
  if (input.withoutDollarImpact > 0) {
    parts.push(
      `${formatNumber(input.withoutDollarImpact)} with no dollar figure`,
    )
  }
  if (input.severity === "minor" && input.lines === 0) {
    parts.push("within ±2% counts as on-contract, not a discrepancy")
  }
  return parts.join(" · ")
}

/**
 * The bands partition only the lines that HAVE a variance % — an
 * off-contract purchase has no contract price to vary from, so it lands
 * in no band. Those lines are 39,031 of the production snapshot's
 * 44,812, so three cards summing to 5,781 above a report titled "price
 * discrepancy" needs the remainder named out loud, or the reader takes
 * the banded total for the facility's whole discrepancy set.
 *
 * Returns null when every line is banded (nothing to disclose).
 */
export function buildBandCoverageNotice(input: {
  totalLines: number
  bandedLines: number
  unbandedLines: number
}): string | null {
  if (input.unbandedLines <= 0) return null
  return (
    `These bands cover ${formatNumber(input.bandedLines)} of ` +
    `${formatNumber(input.totalLines)} discrepancy lines facility-wide. ` +
    `The other ${formatNumber(input.unbandedLines)} are off-contract ` +
    `purchases with no contract price to compare, so they carry no ` +
    `variance % and fall in no severity band.`
  )
}

/**
 * Split the (uncapped) vendor aggregate into the slice the table paints
 * and an exact accounting of what that slice leaves out. The remainder
 * is computed from the full list the client already holds — it is never
 * a guess, and never "and more".
 */
export function splitVendorRows(
  vendors: VendorVarianceRow[],
  limit: number,
): {
  shown: VendorVarianceRow[]
  hidden: {
    vendors: number
    overchargeTotal: number
    underchargeTotal: number
    lines: number
    majorLines: number
  }
  facilityTotals: {
    overchargeTotal: number
    underchargeTotal: number
    lines: number
    majorLines: number
  }
} {
  const shown = vendors.slice(0, Math.max(0, limit))
  const sum = (rows: VendorVarianceRow[]) =>
    rows.reduce(
      (acc, v) => ({
        overchargeTotal: acc.overchargeTotal + v.overchargeTotal,
        underchargeTotal: acc.underchargeTotal + v.underchargeTotal,
        lines: acc.lines + v.lines,
        majorLines: acc.majorLines + v.majorLines,
      }),
      { overchargeTotal: 0, underchargeTotal: 0, lines: 0, majorLines: 0 },
    )
  return {
    shown,
    hidden: {
      vendors: vendors.length - shown.length,
      ...sum(vendors.slice(shown.length)),
    },
    facilityTotals: sum(vendors),
  }
}

/**
 * Caption for the vendor table when it paints fewer vendors than the
 * facility has. Silent truncation is the bug; a truncation that quotes
 * exactly what is off-screen is a feature.
 */
export function buildVendorSampleNotice(input: {
  shown: number
  total: number
  hidden: { overchargeTotal: number; underchargeTotal: number; lines: number }
}): string | null {
  const hiddenVendors = input.total - input.shown
  if (hiddenVendors <= 0) return null
  return (
    `Top ${formatNumber(input.shown)} of ${formatNumber(input.total)} vendors ` +
    `by overcharge. The ${formatNumber(hiddenVendors)} not shown carry ` +
    `${formatCompactCurrency(input.hidden.overchargeTotal)} over contract and ` +
    `${formatCompactCurrency(input.hidden.underchargeTotal)} under, across ` +
    `${formatNumber(input.hidden.lines)} lines — the footer row totals all ` +
    `${formatNumber(input.total)}.`
  )
}

/**
 * Caption for the major-severity drill-down. This list is a genuine
 * top-N (a facility with 3,346 major lines does not want them all on a
 * report page), and it is ranked by ABSOLUTE dollar impact across both
 * directions, so it must say both things — otherwise the reader reads
 * 25 rows as "the major lines".
 */
export function buildMajorLineNotice(input: {
  shown: number
  total: number
}): string | null {
  // Nothing to rank: `buildMajorLineEmptyMessage` carries the disclosure
  // instead. Without this guard the card printed "Top 0 of 199
  // major-severity lines…" directly above "No major-severity lines
  // detected. Good news!" — two contradictory claims, neither true.
  if (input.shown <= 0) return null
  if (input.total <= input.shown) return null
  return (
    `Top ${formatNumber(input.shown)} of ${formatNumber(input.total)} ` +
    `major-severity lines, ranked by absolute dollar impact — the largest ` +
    `overcharges and the largest discounts both qualify. Band totals above ` +
    `cover all ${formatNumber(input.total)}.`
  )
}

/**
 * What the drill-down says when it has no rows to show.
 *
 * The drill-down's scope is "major lines that carry a dollar figure",
 * NOT "major lines": it is two top-N reads on `savingsAmount`, and
 * enrichment nulls that column whenever its kit-vs-component sanity
 * check fires (199 rows in the production snapshot). So an empty list
 * does NOT mean an empty band — a facility whose major lines all had
 * their savings suppressed used to be told "No major-severity lines
 * detected. Good news!" while the Major card beside it read a non-zero
 * count. Report the band's real size instead.
 */
export function buildMajorLineEmptyMessage(input: {
  majorLines: number
}): string {
  if (input.majorLines <= 0) return "No major-severity lines detected. Good news!"
  return (
    `All ${formatNumber(input.majorLines)} major-severity lines carry no ` +
    `dollar figure — their savings amount was suppressed as untrustworthy ` +
    `(a kit matched against a component) or is exactly $0 — so there is ` +
    `nothing to rank by dollar impact. The band totals above still count ` +
    `all ${formatNumber(input.majorLines)}.`
  )
}

// ─── Component ──────────────────────────────────────────────────

interface PriceVarianceDashboardProps {
  facilityId: string
}

export function PriceVarianceDashboard({
  facilityId,
}: PriceVarianceDashboardProps) {
  // Every number on this tab is a facility-wide aggregate computed in
  // Postgres. The tab deliberately does NOT read `getPriceDiscrepancies`:
  // that action caps at 1,500 rows ordered by variance % DESC, and
  // reducing over it is what made the Moderate card read 0 for a
  // facility with 2,435 moderate lines.
  //
  // Keyed off the row query's key so any invalidation that refreshes the
  // rows (prefix match) refreshes this breakdown too — the severity tab
  // and the line-item tab must never describe different snapshots.
  const { data, isLoading } = useQuery({
    queryKey: [
      ...queryKeys.reports.priceDiscrepancies(facilityId),
      "severity-breakdown",
    ] as const,
    queryFn: () => getPriceVarianceSeverityBreakdown(facilityId),
  })

  const bands = data?.bands
  const vendors = useMemo(() => data?.vendors ?? [], [data?.vendors])

  const vendorSplit = useMemo(
    () => splitVendorRows(vendors, VENDOR_ROW_LIMIT),
    [vendors],
  )

  const chartData = useMemo(
    () =>
      bands
        ? SEVERITY_ORDER.map((severity) => ({
            severity: SEVERITY_META[severity].label,
            Lines: bands[severity].lines,
            "Over contract": bands[severity].overchargeTotal,
            "Under contract": bands[severity].underchargeTotal,
          })).reverse()
        : [],
    [bands],
  )

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[280px] rounded-xl" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    )
  }

  if (data.totalLines === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <AlertTriangle className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">
            No variance data yet
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Once COG spend is imported and matched against contract pricing,
            price-variance and off-contract rows will appear here grouped by
            severity.
          </p>
        </CardContent>
      </Card>
    )
  }

  const bandedLines =
    data.bands.minor.lines + data.bands.moderate.lines + data.bands.major.lines
  const coverageNotice = buildBandCoverageNotice({
    totalLines: data.totalLines,
    bandedLines,
    unbandedLines: data.unbandedLines,
  })
  const vendorNotice = buildVendorSampleNotice({
    shown: vendorSplit.shown.length,
    total: vendors.length,
    hidden: vendorSplit.hidden,
  })
  const majorNotice = buildMajorLineNotice({
    shown: data.majorLineSample.length,
    total: data.bands.major.lines,
  })

  return (
    <div className="space-y-6">
      {/* Severity totals — facility-wide, never a reduce over a sample */}
      <div className="grid gap-4 md:grid-cols-3">
        {SEVERITY_ORDER.map((severity) => {
          const bucket = data.bands[severity]
          const meta = SEVERITY_META[severity]
          return (
            <Card key={severity}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
                      <p className="text-sm text-muted-foreground">
                        {meta.label}
                      </p>
                    </div>
                    <p className="text-2xl font-bold">
                      {formatNumber(bucket.lines)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {buildSeverityCardSubtitle(bucket)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {buildSeverityCardScopeLine({
                        severity,
                        lines: bucket.lines,
                        withoutDollarImpact: bucket.withoutDollarImpact,
                      })}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2.5">
                    {severity === "major" ? (
                      <AlertTriangle className="h-5 w-5 text-red-500" />
                    ) : severity === "moderate" ? (
                      <TrendingUp className="h-5 w-5 text-amber-500" />
                    ) : (
                      <DollarSign className="h-5 w-5 text-green-500" />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* What the bands do NOT cover */}
      {coverageNotice && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{coverageNotice}</span>
        </div>
      )}

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Variance by severity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="severity" className="text-xs" />
                <YAxis
                  yAxisId="left"
                  className="text-xs"
                  tickFormatter={(v: number) => formatNumber(v)}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  className="text-xs"
                  tickFormatter={(v: number) => formatCompactCurrency(v)}
                />
                <RechartsTooltip
                  formatter={(value, name) => {
                    const numeric =
                      typeof value === "number" ? value : Number(value ?? 0)
                    const label = String(name ?? "")
                    return label === "Lines"
                      ? [formatNumber(numeric), "Lines"]
                      : [formatCurrency(numeric, true), label]
                  }}
                />
                <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                <Bar
                  yAxisId="left"
                  dataKey="Lines"
                  fill="var(--chart-1)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  yAxisId="right"
                  dataKey="Over contract"
                  fill="var(--destructive)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  yAxisId="right"
                  dataKey="Under contract"
                  fill="var(--chart-3)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Per-vendor totals */}
      <Card>
        <CardHeader>
          <CardTitle>Vendor totals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {vendorNotice && (
            <p className="text-xs text-muted-foreground">{vendorNotice}</p>
          )}
          {vendorSplit.shown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No vendor-level variance totals to display.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead className="text-right">Over contract</TableHead>
                    <TableHead className="text-right">Under contract</TableHead>
                    <TableHead className="text-right">Lines</TableHead>
                    <TableHead className="text-right">Major</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {vendorSplit.shown.map((v) => (
                    <TableRow key={v.vendorId || v.vendorName}>
                      <TableCell className="font-medium">
                        {v.vendorName}
                      </TableCell>
                      <TableCell className="text-right text-red-600 dark:text-red-400">
                        {formatCurrency(v.overchargeTotal, true)}
                      </TableCell>
                      <TableCell className="text-right text-green-600 dark:text-green-400">
                        {formatCurrency(v.underchargeTotal, true)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatNumber(v.lines)}
                      </TableCell>
                      <TableCell className="text-right">
                        {v.majorLines > 0 ? (
                          <Badge className="border-0 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                            {formatNumber(v.majorLines)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  {/* Totals across ALL vendors, so the visible slice can
                      never be mistaken for the facility's whole book. */}
                  <TableRow>
                    <TableCell className="font-medium">
                      All {formatNumber(vendors.length)} vendors
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(
                        vendorSplit.facilityTotals.overchargeTotal,
                        true,
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(
                        vendorSplit.facilityTotals.underchargeTotal,
                        true,
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatNumber(vendorSplit.facilityTotals.lines)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatNumber(vendorSplit.facilityTotals.majorLines)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Major variance drill-down */}
      <Card>
        <CardHeader>
          <CardTitle>Top major-severity lines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {majorNotice && (
            <p className="text-xs text-muted-foreground">{majorNotice}</p>
          )}
          {data.majorLineSample.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {buildMajorLineEmptyMessage({
                majorLines: data.bands.major.lines,
              })}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>PO / Ref</TableHead>
                    <TableHead className="text-right">Variance %</TableHead>
                    <TableHead className="text-right">Dollar impact</TableHead>
                    <TableHead>Severity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.majorLineSample.map((row) => {
                    // A major line can be a deep DISCOUNT as easily as an
                    // overcharge (|variance| ≥ 10% either way), so sign and
                    // colour follow the row instead of assuming "+ / red".
                    const overcharged = row.dollarImpact > 0
                    const money = overcharged
                      ? "text-red-600 dark:text-red-400"
                      : "text-green-600 dark:text-green-400"
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="max-w-[240px]">
                          <span className="block truncate font-medium">
                            {row.itemDescription}
                          </span>
                          {row.vendorItemNo && (
                            <span className="text-xs text-muted-foreground">
                              #{row.vendorItemNo}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{row.vendorName}</TableCell>
                        <TableCell>{row.reference || "—"}</TableCell>
                        <TableCell className="text-right">
                          {row.variancePercent == null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span className={`font-mono ${money}`}>
                              {row.variancePercent > 0 ? "+" : ""}
                              {formatPercent(row.variancePercent)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono ${money}`}
                        >
                          {overcharged ? "+" : ""}
                          {formatCurrency(row.dollarImpact, true)}
                        </TableCell>
                        <TableCell>
                          <SeverityBadge severity="major" />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
