"use client"

import type { ForecastResult } from "@/lib/actions/forecasting"
import { formatCurrency, formatPercent } from "@/lib/formatting"
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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

interface ForecastTableProps {
  result: ForecastResult
  label?: string
  formatValue?: (v: number) => string
}

export function ForecastTable({
  result,
  label = "Spend",
  formatValue = formatCurrency,
}: ForecastTableProps) {
  if (!result.data.length) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{label} Forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Not enough data to generate a forecast. At least 3 historical periods
            are required.
          </p>
        </CardContent>
      </Card>
    )
  }

  const trendIcon =
    result.trend > 0 ? (
      <TrendingUp className="inline h-4 w-4 text-green-600" />
    ) : result.trend < 0 ? (
      <TrendingDown className="inline h-4 w-4 text-red-600" />
    ) : (
      <Minus className="inline h-4 w-4 text-muted-foreground" />
    )

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{label} Forecast</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Forecast</TableHead>
              <TableHead className="text-right">Lower Bound</TableHead>
              <TableHead className="text-right">Upper Bound</TableHead>
              <TableHead className="text-right">Variance %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.map((point) => {
              const variance =
                point.actual != null && point.forecast != null && point.forecast !== 0
                  ? ((point.actual - point.forecast) / point.forecast) * 100
                  : null

              return (
                <TableRow key={point.period}>
                  <TableCell className="font-medium">{point.period}</TableCell>
                  <TableCell className="text-right">
                    {point.actual != null ? (
                      <span className="font-semibold">
                        {formatValue(point.actual)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {point.forecast != null ? (
                      formatValue(point.forecast)
                    ) : (
                      <span className="text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {point.lower != null ? (
                      formatValue(point.lower)
                    ) : (
                      <span className="text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {point.upper != null ? (
                      formatValue(point.upper)
                    ) : (
                      <span className="text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {variance != null ? (
                      <span
                        className={cn(
                          "font-medium",
                          variance < 0
                            ? "text-green-600"
                            : variance > 0
                              ? "text-red-600"
                              : "text-muted-foreground"
                        )}
                      >
                        {formatPercent(variance)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="text-sm">
                R&sup2;: <span className="font-semibold">{result.r2.toFixed(3)}</span>
              </TableCell>
              <TableCell colSpan={3} className="text-right text-sm">
                Trend: {trendIcon}{" "}
                <span className="font-semibold">
                  {formatValue(Math.abs(result.trend))}/period
                </span>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </CardContent>
    </Card>
  )
}
