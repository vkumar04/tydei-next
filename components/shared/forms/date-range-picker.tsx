"use client"

import { useState } from "react"
import { format, parseISO } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { DateRange as RDPDateRange } from "react-day-picker"

interface DateRange {
  from: string
  to: string
}

interface DateRangePickerProps {
  dateRange: DateRange
  onDateRangeChange: (range: DateRange) => void
  presets?: { label: string; range: DateRange }[]
}

export function DateRangePicker({ dateRange, onDateRangeChange, presets }: DateRangePickerProps) {
  const [open, setOpen] = useState(false)

  const selected: RDPDateRange = {
    from: parseISO(dateRange.from),
    to: parseISO(dateRange.to),
  }

  const handleSelect = (range: RDPDateRange | undefined) => {
    if (range?.from && range?.to) {
      onDateRangeChange({
        from: format(range.from, "yyyy-MM-dd"),
        to: format(range.to, "yyyy-MM-dd"),
      })
    }
  }

  return (
    <div className="flex items-center gap-2">
      {presets?.map((preset) => (
        <Button
          key={preset.label}
          variant="outline"
          size="sm"
          onClick={() => onDateRangeChange(preset.range)}
          className={cn(
            dateRange.from === preset.range.from && dateRange.to === preset.range.to
              ? "border-primary"
              : ""
          )}
        >
          {preset.label}
        </Button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="min-w-[220px] justify-start text-left font-normal">
            <CalendarIcon className="mr-2 size-4" />
            {format(parseISO(dateRange.from), "MMM d, yyyy")} -{" "}
            {format(parseISO(dateRange.to), "MMM d, yyyy")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="range" selected={selected} onSelect={handleSelect} numberOfMonths={2} />
        </PopoverContent>
      </Popover>
    </div>
  )
}
