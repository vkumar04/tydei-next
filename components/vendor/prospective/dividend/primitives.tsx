"use client"

import { useId } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { TableCell, TableRow } from "@/components/ui/table"
import { formatCurrency } from "@/lib/formatting"

// Small presentational pieces shared across the Dividend/DCF tab.

export const GOOD_TONE = "text-emerald-600 dark:text-emerald-400"
export const BAD_TONE = "text-red-600 dark:text-red-400"

/** Labeled numeric input with an optional currency prefix and hint line. */
export function MoneyInput({
  label,
  value,
  onChange,
  prefix = "$",
  hint,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  prefix?: string
  hint?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {prefix}
          </span>
        ) : null}
        <Input
          id={id}
          type="number"
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className={prefix ? "pl-7 tabular-nums" : "tabular-nums"}
        />
      </div>
      {hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  )
}

/** Headline delta stat card (NOI / dividend / NPV / payback). */
export function DeltaTile({
  label,
  value,
  sub,
  icon: Icon,
  positive,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ElementType
  /** null = neutral tone. */
  positive: boolean | null
}) {
  const tone =
    positive === null ? "text-foreground" : positive ? GOOD_TONE : BAD_TONE
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <div className={`text-2xl font-semibold tabular-nums ${tone}`}>
          {value}
        </div>
        {sub ? (
          <div className="text-xs text-muted-foreground">{sub}</div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** A single before → after P&L row with a tone-colored delta. */
export function PnlRow({
  label,
  before,
  after,
  bold,
  indent,
  invertGood,
}: {
  label: string
  before: number
  after: number
  bold?: boolean
  indent?: boolean
  /** For expense lines, a decrease is good. */
  invertGood?: boolean
}) {
  const delta = after - before
  const good = invertGood ? delta < 0 : delta > 0
  const deltaTone =
    Math.abs(delta) < 1 ? "text-muted-foreground" : good ? GOOD_TONE : BAD_TONE
  return (
    <TableRow className={bold ? "font-semibold" : ""}>
      <TableCell className={indent ? "pl-8 text-muted-foreground" : ""}>
        {label}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCurrency(before)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCurrency(after)}
      </TableCell>
      <TableCell className={`text-right tabular-nums ${deltaTone}`}>
        {Math.abs(delta) < 1
          ? "—"
          : `${delta > 0 ? "+" : ""}${formatCurrency(delta)}`}
      </TableCell>
    </TableRow>
  )
}
