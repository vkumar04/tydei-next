"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/shared/tables/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatNumber, formatPercent } from "@/lib/formatting"
import { queryKeys } from "@/lib/query-keys"
import { getPriceDiscrepancySummary } from "@/lib/actions/reports"
import {
  v0CogPriceVarianceBand,
  type V0CogVarianceBand,
} from "@/lib/v0-spec/cog"
import { cn } from "@/lib/utils"
import {
  Search,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  DollarSign,
  FileWarning,
  ExternalLink,
} from "lucide-react"
import Link from "next/link"

// ─── Types ──────────────────────────────────────────────────────

export interface PriceDiscrepancy {
  id: string
  invoiceId: string
  invoiceNumber: string
  vendorName: string
  vendorId: string
  itemDescription: string
  vendorItemNo: string | null
  invoicePrice: number
  contractPrice: number | null
  variancePercent: number | null
  quantity: number
  totalLineCost: number
  isFlagged: boolean
}

type DiscrepancyType =
  | "all"
  | "overcharge"
  | "undercharge"
  | "no_contract"
  | "price_increase"

// ─── Helpers ────────────────────────────────────────────────────

function classifyDiscrepancy(d: PriceDiscrepancy): DiscrepancyType {
  if (d.contractPrice == null) return "no_contract"
  const variance = d.invoicePrice - d.contractPrice
  if (variance > 0) return "overcharge"
  if (variance < 0) return "undercharge"
  return "all" // no variance
}

function getVarianceDollar(d: PriceDiscrepancy): number | null {
  if (d.contractPrice == null) return null
  return d.invoicePrice - d.contractPrice
}

// v0 doc §6 banding: ±0.5% = at_contract, <±5% = minor_*, ≥±5% = significant_*.
function getVarianceBand(d: PriceDiscrepancy): V0CogVarianceBand | null {
  if (d.contractPrice == null) return null
  return v0CogPriceVarianceBand(d.invoicePrice, d.contractPrice).band
}

function bandBadge(band: V0CogVarianceBand | null) {
  if (band == null) return <span className="text-muted-foreground">—</span>
  switch (band) {
    case "significant_overcharge":
      return (
        <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-0">
          Significant overcharge
        </Badge>
      )
    case "minor_overcharge":
      return (
        <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400 border-0">
          Minor overcharge
        </Badge>
      )
    case "at_contract":
      return <Badge variant="secondary">At contract</Badge>
    case "minor_discount":
      return (
        <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0">
          Minor discount
        </Badge>
      )
    case "significant_discount":
      return (
        <Badge className="bg-emerald-600/20 text-emerald-700 dark:text-emerald-300 border-0">
          Significant discount
        </Badge>
      )
  }
}

function getTypeBadge(type: DiscrepancyType) {
  switch (type) {
    case "overcharge":
      return (
        <Badge className="bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 border-0">
          Overcharge
        </Badge>
      )
    case "undercharge":
      return (
        <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 border-0">
          Undercharge
        </Badge>
      )
    case "no_contract":
      return (
        <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300 border-0">
          No Contract
        </Badge>
      )
    case "price_increase":
      return (
        <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 border-0">
          Price Increase
        </Badge>
      )
    default:
      return <Badge variant="secondary">Match</Badge>
  }
}

const DISCREPANCY_TYPE_OPTIONS: { value: DiscrepancyType; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "overcharge", label: "Overcharge" },
  { value: "undercharge", label: "Undercharge" },
  { value: "no_contract", label: "No Contract" },
  { value: "price_increase", label: "Price Increase" },
]

// ─── Summary Cards ──────────────────────────────────────────────

/**
 * Facility-wide totals, straight from `getPriceDiscrepancySummary`.
 *
 * These four cards are NEVER reduced from the `discrepancies` prop: that
 * array is a capped sample (`rowCap`, today 1,500 rows) and the cards
 * quietly stopped counting at the cap — money and counts describing a
 * slice of the facility while labelled "Total". The server aggregates
 * over the whole qualifying set instead; do not reintroduce a client-side
 * reducer beside them.
 */
type DiscrepancySummary = Awaited<
  ReturnType<typeof getPriceDiscrepancySummary>
>

/**
 * Caption for the row list when it shows fewer rows than the facility
 * has. A silent cap is the bug; a labelled one is a feature. Returns
 * null when the table is showing everything (or the total isn't known
 * yet) so the UI stays quiet in the common case.
 *
 * The sample is not just short, it is BIASED: `getPriceDiscrepancies`
 * orders by `variancePercent` DESCENDING (nulls last), so the retained
 * rows are the largest OVERCHARGE percentages — undercharges (negative
 * variance) and off-contract rows (null variance) are the first things
 * dropped. Saying only "showing 1,500 of 4,182" would invite the reader
 * to treat the visible rows as a representative slice, so the notice
 * names the ordering out loud.
 */
export function buildDiscrepancySampleNotice(input: {
  loaded: number
  total: number | null | undefined
  cap: number | null | undefined
}): string | null {
  const total = input.total ?? null
  if (total == null || total <= input.loaded) return null
  const capNote =
    input.cap != null
      ? ` This table and the CSV export are capped at ${formatNumber(input.cap)} rows.`
      : " This table and the CSV export are capped."
  return (
    `Showing ${formatNumber(input.loaded)} of ${formatNumber(total)} discrepancies, ` +
    `ordered by variance % descending — the largest overcharges first, with ` +
    `undercharges and off-contract rows dropped first, so these rows are a ` +
    `biased sample rather than a representative one. ` +
    `The totals above cover all ${formatNumber(total)}.` +
    capNote
  )
}

/**
 * Subtitle for the "Total Discrepancies" card. The three facility-wide
 * buckets must reconcile in the reader's head:
 *   overcharges.count + undercharges.count + withoutDollarImpact = total
 * so when the leftover bucket is non-empty the card says how big it is
 * instead of leaving the two dollar cards looking like they should add
 * up to the total and quietly not doing so.
 */
export function buildDiscrepancyTotalSubtitle(
  withoutDollarImpact: number | null | undefined,
): string {
  const leftover = withoutDollarImpact ?? 0
  return leftover > 0
    ? `facility-wide · ${formatNumber(leftover)} with no dollar impact`
    : "facility-wide"
}

function SummaryCards({
  summary,
  isLoading,
}: {
  summary: DiscrepancySummary | undefined
  isLoading: boolean
}) {
  // Every subtitle names the scope explicitly. All four values AND the
  // counts beside them come from the one facility-wide aggregate, so the
  // scope word belongs on each card rather than only on the first —
  // otherwise a reader can reasonably assume cards 2-4 follow the table's
  // filters (they do not).
  const cards = [
    {
      title: "Total Discrepancies",
      value: summary ? formatNumber(summary.totalDiscrepancies) : null,
      subtitle: summary
        ? buildDiscrepancyTotalSubtitle(summary.withoutDollarImpact)
        : undefined,
      icon: AlertTriangle,
      iconColor: "text-amber-500",
      iconBg: "bg-amber-50 dark:bg-amber-950",
    },
    {
      title: "Total Overcharges",
      value: summary ? formatCurrency(summary.overcharges.amount, true) : null,
      subtitle: summary
        ? `${formatNumber(summary.overcharges.count)} items · facility-wide`
        : undefined,
      icon: TrendingUp,
      iconColor: "text-red-500",
      iconBg: "bg-red-50 dark:bg-red-950",
    },
    {
      title: "Total Undercharges",
      value: summary ? formatCurrency(summary.undercharges.amount, true) : null,
      subtitle: summary
        ? `${formatNumber(summary.undercharges.count)} items · facility-wide`
        : undefined,
      icon: TrendingDown,
      iconColor: "text-green-500",
      iconBg: "bg-green-50 dark:bg-green-950",
    },
    {
      title: "Est. Savings",
      value: summary ? formatCurrency(summary.estimatedSavings, true) : null,
      subtitle: "facility-wide, if the overcharges are corrected",
      icon: DollarSign,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-50 dark:bg-blue-950",
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Card key={card.title}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{card.title}</p>
                  {card.value == null ? (
                    isLoading ? (
                      <Skeleton className="h-8 w-24" />
                    ) : (
                      <p
                        className="text-2xl font-bold tracking-tight text-muted-foreground"
                        title="Facility-wide total unavailable"
                      >
                        —
                      </p>
                    )
                  ) : (
                    <p className="text-2xl font-bold tracking-tight">
                      {card.value}
                    </p>
                  )}
                  {card.value != null && card.subtitle && (
                    <p className="text-xs text-muted-foreground">
                      {card.subtitle}
                    </p>
                  )}
                </div>
                <div className={cn("rounded-lg p-2.5", card.iconBg)}>
                  <Icon className={cn("h-5 w-5", card.iconColor)} />
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ─── Table Columns ──────────────────────────────────────────────

function buildColumns(): ColumnDef<
  PriceDiscrepancy & {
    _type: DiscrepancyType
    _varianceDollar: number | null
    _band: V0CogVarianceBand | null
  }
>[] {
  return [
    {
      accessorKey: "itemDescription",
      header: "Item",
      meta: { filterVariant: "text", filterLabel: "Item" },
      cell: ({ row }) => (
        <div className="max-w-[200px]">
          <p className="font-medium truncate">{row.original.itemDescription}</p>
          {row.original.vendorItemNo && (
            <p className="text-xs text-muted-foreground">
              #{row.original.vendorItemNo}
            </p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "vendorName",
      header: "Vendor",
      meta: { filterVariant: "select", filterLabel: "Vendor" },
      cell: ({ row }) =>
        row.original.vendorId ? (
          <Link
            href={`/dashboard/vendors/${row.original.vendorId}`}
            className="text-sm hover:underline text-foreground"
          >
            {row.original.vendorName}
          </Link>
        ) : (
          <span className="text-sm">{row.original.vendorName}</span>
        ),
    },
    {
      accessorKey: "contractPrice",
      header: "Contract Price",
      meta: { filterVariant: "range", filterLabel: "Contract $" },
      accessorFn: (row) =>
        row.contractPrice == null ? NaN : Number(row.contractPrice),
      cell: ({ row }) => {
        const v = row.original.contractPrice
        return v != null ? (
          <span className="font-mono text-sm">{formatCurrency(v, true)}</span>
        ) : (
          <span className="text-muted-foreground">--</span>
        )
      },
    },
    {
      accessorKey: "invoicePrice",
      header: "Actual Price",
      meta: { filterVariant: "range", filterLabel: "Actual $" },
      accessorFn: (row) => Number(row.invoicePrice),
      cell: ({ row }) => {
        const type = row.original._type
        return (
          <span
            className={cn(
              "font-mono text-sm font-medium",
              type === "overcharge" && "text-red-600 dark:text-red-400",
              type === "undercharge" && "text-green-600 dark:text-green-400"
            )}
          >
            {formatCurrency(row.original.invoicePrice, true)}
          </span>
        )
      },
    },
    {
      accessorKey: "_varianceDollar",
      header: "Variance $",
      meta: { filterVariant: "range", filterLabel: "Variance $" },
      accessorFn: (row) =>
        row._varianceDollar == null ? NaN : Number(row._varianceDollar),
      cell: ({ row }) => {
        const v = row.original._varianceDollar
        if (v == null) return <span className="text-muted-foreground">--</span>
        const isPositive = v > 0
        return (
          <span
            className={cn(
              "font-mono text-sm font-medium",
              isPositive
                ? "text-red-600 dark:text-red-400"
                : "text-green-600 dark:text-green-400"
            )}
          >
            {isPositive ? "+" : ""}
            {formatCurrency(v, true)}
          </span>
        )
      },
    },
    {
      accessorKey: "variancePercent",
      header: "Variance %",
      meta: { filterVariant: "range", filterLabel: "Variance %" },
      accessorFn: (row) =>
        row.variancePercent == null ? NaN : Number(row.variancePercent),
      cell: ({ row }) => {
        const v = row.original.variancePercent
        if (v == null) return <span className="text-muted-foreground">--</span>
        const isPositive = v > 0
        return (
          <Badge
            variant="outline"
            className={cn(
              "font-mono",
              isPositive
                ? "border-red-200 text-red-700 dark:border-red-800 dark:text-red-400"
                : "border-green-200 text-green-700 dark:border-green-800 dark:text-green-400"
            )}
          >
            {isPositive ? "+" : ""}
            {formatPercent(v)}
          </Badge>
        )
      },
    },
    {
      accessorKey: "_type",
      header: "Type",
      meta: { filterVariant: "select", filterLabel: "Type" },
      cell: ({ getValue }) => getTypeBadge(getValue<DiscrepancyType>()),
    },
    {
      accessorKey: "_band",
      header: "Severity",
      meta: { filterVariant: "select", filterLabel: "Severity" },
      cell: ({ getValue }) => bandBadge(getValue<V0CogVarianceBand | null>()),
    },
    {
      id: "actions",
      header: "Reference",
      meta: { filterVariant: "none" },
      cell: ({ row }) =>
        // Invoice-backed rows link to the invoice; COG/PO-sourced rows just
        // show the PO number (no invoice to drill into).
        row.original.invoiceId ? (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/dashboard/invoices/${row.original.invoiceId}`}>
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              Invoice
            </Link>
          </Button>
        ) : row.original.invoiceNumber ? (
          <span className="text-xs text-muted-foreground">
            PO #{row.original.invoiceNumber}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ]
}

// ─── Main Component ─────────────────────────────────────────────

interface PriceDiscrepancyTableProps {
  discrepancies: PriceDiscrepancy[]
  /** Scope the summary read; matches the caller's row-query key. */
  facilityId?: string
}

export function PriceDiscrepancyTable({
  discrepancies,
  facilityId = "current",
}: PriceDiscrepancyTableProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<DiscrepancyType>("all")

  // ── Facility-wide totals (NOT reduced from the capped rows) ──
  // Keyed off the row query's key so every invalidation that refreshes
  // the rows (prefix match) refreshes these totals too — the two must
  // never describe different snapshots.
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: [
      ...queryKeys.reports.priceDiscrepancies(facilityId),
      "summary",
    ] as const,
    queryFn: () => getPriceDiscrepancySummary(facilityId),
  })

  // ── Compute enriched data ──────────────────────────────────
  const enriched = useMemo(
    () =>
      discrepancies.map((d) => ({
        ...d,
        _type: classifyDiscrepancy(d),
        _varianceDollar: getVarianceDollar(d),
        _band: getVarianceBand(d),
      })),
    [discrepancies]
  )

  const sampleNotice = buildDiscrepancySampleNotice({
    loaded: enriched.length,
    total: summary?.totalDiscrepancies,
    cap: summary?.rowCap,
  })

  // ── Filtered data ──────────────────────────────────────────
  const filtered = useMemo(() => {
    let result = enriched

    // Type filter
    if (typeFilter !== "all") {
      result = result.filter((d) => d._type === typeFilter)
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (d) =>
          d.itemDescription.toLowerCase().includes(q) ||
          d.vendorName.toLowerCase().includes(q) ||
          d.invoiceNumber.toLowerCase().includes(q) ||
          d.vendorItemNo?.toLowerCase().includes(q)
      )
    }

    return result
  }, [enriched, typeFilter, searchQuery])

  const columns = useMemo(() => buildColumns(), [])

  return (
    <div className="space-y-6">
      {/* ── Summary Cards ────────────────────────────────────── */}
      <SummaryCards summary={summary} isLoading={summaryLoading} />

      {/* ── Truncation notice (only when the rows are a sample) ─ */}
      {sampleNotice && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{sampleNotice}</span>
        </div>
      )}

      {/* ── Filter Bar ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items, vendors, invoices..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as DiscrepancyType)}
        >
          <SelectTrigger className="w-[180px]">
            <FileWarning className="mr-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DISCREPANCY_TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto text-sm text-muted-foreground">
          {/* Both numbers describe the LOADED sample. The facility-wide
              total is the cards' job and the notice above it — never
              mix the two scopes in one sentence. */}
          {formatNumber(filtered.length)} of {formatNumber(enriched.length)}{" "}
          loaded rows
        </div>
      </div>

      {/* ── Data Table ───────────────────────────────────────── */}
      <DataTable
        columns={columns}
        data={filtered}
        pagination
        pageSize={20}
        enableColumnFilters
      />
    </div>
  )
}
