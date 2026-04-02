"use client"

import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Filter } from "lucide-react"
import { DateRangePicker } from "@/components/shared/forms/date-range-picker"
import type { DateRange } from "./types"

/* ─── Props ──────────────────────────────────────────────────── */

export interface ReportFiltersProps {
  dateRange: DateRange
  onDateRangeChange: (range: DateRange) => void
  selectedContractId: string
  onContractChange: (contractId: string) => void
  contractsList: { id: string; name: string; contractType: string }[] | undefined
  selectedContract: { name: string; status?: string; contractType?: string } | null
}

/* ─── Component ──────────────────────────────────────────────── */

export function ReportFilters({
  dateRange,
  onDateRangeChange,
  selectedContractId,
  onContractChange,
  contractsList,
  selectedContract,
}: ReportFiltersProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Filters:</span>
          </div>

          <DateRangePicker dateRange={dateRange} onDateRangeChange={onDateRangeChange} />

          <Select value={selectedContractId} onValueChange={onContractChange}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Contract" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Contracts</SelectItem>
              {contractsList?.map(
                (c: { id: string; name: string; contractType: string }) => (
                  <SelectItem key={c.id} value={c.id}>
                    <div className="flex items-center gap-2">
                      <span>{c.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        {c.contractType}
                      </Badge>
                    </div>
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Selected Contract Details */}
        {selectedContract && (
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Selected Contract:</span>
                  <span className="font-medium">
                    {selectedContract.name}
                  </span>
                </div>
                <Badge variant={selectedContract.status === "active" ? "default" : "secondary"}>
                  {selectedContract.status ?? "active"}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Report Format:</span>
                <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                  {selectedContract.contractType ?? "usage"} Contract
                </Badge>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
