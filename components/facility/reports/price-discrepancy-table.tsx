"use client"

import { useState, useMemo } from "react"
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
import { formatCurrency, formatPercent } from "@/lib/formatting"
import { cn } from "@/lib/utils"
import {
  Search,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  DollarSign,
  FileWarning,
  ArrowUpDown,
  ExternalLink,
  Download,
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

interface SummaryCardsProps {
  total: number
  overcharges: { count: number; amount: number }
  undercharges: { count: number; amount: number }
  estimatedSavings: number
}

function SummaryCards({
  total,
  overcharges,
  undercharges,
  estimatedSavings,
}: SummaryCardsProps) {
  const cards = [
    {
      title: "Total Discrepancies",
      value: total.toString(),
      icon: AlertTriangle,
      iconColor: "text-amber-500",
      iconBg: "bg-amber-50 dark:bg-amber-950",
    },
    {
      title: "Total Overcharges",
      value: formatCurrency(overcharges.amount, true),
      subtitle: `${overcharges.count} items`,
      icon: TrendingUp,
      iconColor: "text-red-500",
      iconBg: "bg-red-50 dark:bg-red-950",
    },
    {
      title: "Total Undercharges",
      value: formatCurrency(Math.abs(undercharges.amount), true),
      subtitle: `${undercharges.count} items`,
      icon: TrendingDown,
      iconColor: "text-green-500",
      iconBg: "bg-green-50 dark:bg-green-950",
    },
    {
      title: "Est. Savings",
      value: formatCurrency(estimatedSavings, true),
      subtitle: "if corrected",
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
                  <p className="text-2xl font-bold tracking-tight">
                    {card.value}
                  </p>
                  {card.subtitle && (
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

function buildColumns(): ColumnDef<PriceDiscrepancy & { _type: DiscrepancyType; _varianceDollar: number | null }>[] {
  return [
    {
      accessorKey: "itemDescription",
      header: "Item",
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
      cell: ({ row }) => (
        <Link
          href={`/dashboard/vendors/${row.original.vendorId}`}
          className="text-sm hover:underline text-foreground"
        >
          {row.original.vendorName}
        </Link>
      ),
    },
    {
      accessorKey: "contractPrice",
      header: "Contract Price",
      cell: ({ getValue }) => {
        const v = getValue<number | null>()
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
      cell: ({ getValue }) => {
        const v = getValue<number | null>()
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
      cell: ({ getValue }) => {
        const v = getValue<number | null>()
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
      cell: ({ getValue }) => getTypeBadge(getValue<DiscrepancyType>()),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button asChild size="sm" variant="ghost">
          <Link href={`/dashboard/invoices/${row.original.invoiceId}`}>
            <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
            Invoice
          </Link>
        </Button>
      ),
    },
  ]
}

// ─── Main Component ─────────────────────────────────────────────

interface PriceDiscrepancyTableProps {
  discrepancies: PriceDiscrepancy[]
}

export function PriceDiscrepancyTable({
  discrepancies,
}: PriceDiscrepancyTableProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<DiscrepancyType>("all")

  // ── Compute enriched data ──────────────────────────────────
  const enriched = useMemo(
    () =>
      discrepancies.map((d) => ({
        ...d,
        _type: classifyDiscrepancy(d),
        _varianceDollar: getVarianceDollar(d),
      })),
    [discrepancies]
  )

  // ── Summary stats ──────────────────────────────────────────
  const summary = useMemo(() => {
    let overchargeCount = 0
    let overchargeAmount = 0
    let underchargeCount = 0
    let underchargeAmount = 0

    for (const d of enriched) {
      if (d._type === "overcharge" && d._varianceDollar != null) {
        overchargeCount++
        overchargeAmount += d._varianceDollar * d.quantity
      } else if (d._type === "undercharge" && d._varianceDollar != null) {
        underchargeCount++
        underchargeAmount += d._varianceDollar * d.quantity
      }
    }

    return {
      total: enriched.filter((d) => d._type !== "all").length,
      overcharges: { count: overchargeCount, amount: overchargeAmount },
      undercharges: { count: underchargeCount, amount: underchargeAmount },
      estimatedSavings: overchargeAmount, // savings = eliminating overcharges
    }
  }, [enriched])

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
      <SummaryCards
        total={summary.total}
        overcharges={summary.overcharges}
        undercharges={summary.undercharges}
        estimatedSavings={summary.estimatedSavings}
      />

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
          {filtered.length} of {enriched.length} discrepancies
        </div>
      </div>

      {/* ── Data Table ───────────────────────────────────────── */}
      <DataTable
        columns={columns}
        data={filtered}
        pagination
        pageSize={20}
      />
    </div>
  )
}
