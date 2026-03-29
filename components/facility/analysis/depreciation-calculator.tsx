"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useDepreciation } from "@/hooks/use-analysis"
import type { DepreciationSchedule } from "@/lib/analysis/depreciation"

interface DepreciationCalculatorProps {
  onScheduleChange?: (schedule: DepreciationSchedule) => void
}

export function DepreciationCalculator({ onScheduleChange }: DepreciationCalculatorProps) {
  const [assetCost, setAssetCost] = useState("")
  const [recoveryPeriod, setRecoveryPeriod] = useState<string>("7")
  const [convention, setConvention] = useState<string>("half_year")
  const mutation = useDepreciation()

  async function handleCalculate() {
    const cost = parseFloat(assetCost)
    if (isNaN(cost) || cost <= 0) return

    const result = await mutation.mutateAsync({
      assetCost: cost,
      recoveryPeriod: parseInt(recoveryPeriod) as 5 | 7 | 10 | 15,
      convention: convention as "half_year" | "mid_quarter",
    })
    onScheduleChange?.(result)
  }

  const schedule = mutation.data

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">MACRS Depreciation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Asset Cost ($)</Label>
              <Input
                type="number"
                value={assetCost}
                onChange={(e) => setAssetCost(e.target.value)}
                placeholder="100000"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Recovery Period</Label>
              <Select value={recoveryPeriod} onValueChange={setRecoveryPeriod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 Years</SelectItem>
                  <SelectItem value="7">7 Years</SelectItem>
                  <SelectItem value="10">10 Years</SelectItem>
                  <SelectItem value="15">15 Years</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Convention</Label>
              <Select value={convention} onValueChange={setConvention}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="half_year">Half-Year</SelectItem>
                  <SelectItem value="mid_quarter">Mid-Quarter</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleCalculate} disabled={mutation.isPending}>
            {mutation.isPending ? "Calculating..." : "Calculate"}
          </Button>
        </CardContent>
      </Card>

      {schedule && (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Year</TableHead>
                  <TableHead className="text-right">Rate (%)</TableHead>
                  <TableHead className="text-right">Depreciation</TableHead>
                  <TableHead className="text-right">Accumulated</TableHead>
                  <TableHead className="text-right">Book Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedule.years.map((y) => (
                  <TableRow key={y.year}>
                    <TableCell>{y.year}</TableCell>
                    <TableCell className="text-right">{y.rate}%</TableCell>
                    <TableCell className="text-right">
                      ${y.depreciation.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      ${y.accumulatedDepreciation.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      ${y.bookValue.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
