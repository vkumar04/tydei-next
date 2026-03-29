"use client"

import { DateRangePicker } from "@/components/shared/forms/date-range-picker"

interface DateRange {
  from: string
  to: string
}

interface DashboardFiltersProps {
  dateRange: DateRange
  onDateRangeChange: (range: DateRange) => void
}

function getQuarterDates(offsetQuarters: number): DateRange {
  const now = new Date()
  const quarter = Math.floor(now.getMonth() / 3) + offsetQuarters
  const year = now.getFullYear() + Math.floor(quarter / 4)
  const q = ((quarter % 4) + 4) % 4
  const from = new Date(year, q * 3, 1)
  const to = new Date(year, q * 3 + 3, 0)
  return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] }
}

const presets = [
  { label: "This Quarter", range: getQuarterDates(0) },
  { label: "Last Quarter", range: getQuarterDates(-1) },
  {
    label: "This Year",
    range: {
      from: `${new Date().getFullYear()}-01-01`,
      to: `${new Date().getFullYear()}-12-31`,
    },
  },
]

export function DashboardFilters({ dateRange, onDateRangeChange }: DashboardFiltersProps) {
  return (
    <DateRangePicker
      dateRange={dateRange}
      onDateRangeChange={onDateRangeChange}
      presets={presets}
    />
  )
}
