"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Badge } from "@/components/ui/badge"
import { CalendarIcon, X, Filter } from "lucide-react"
import { format, subMonths, subYears, startOfYear } from "date-fns"
import type { DateRange as RDPDateRange } from "react-day-picker"

interface DateRange {
  from: string
  to: string
}

interface DashboardFiltersProps {
  dateRange: DateRange
  onDateRangeChange: (range: DateRange) => void
}

const vendors = [
  { id: "1", name: "Arthrex Inc" },
  { id: "2", name: "Stryker Orthopaedics" },
  { id: "3", name: "Smith & Nephew Inc" },
  { id: "4", name: "Zimmer Biomet" },
]

const contractTypes = [
  { value: "all", label: "All Types" },
  { value: "usage", label: "Usage" },
  { value: "capital", label: "Capital" },
  { value: "service", label: "Service" },
  { value: "tie_in", label: "Tie-In" },
  { value: "grouped", label: "Grouped" },
  { value: "pricing_only", label: "Pricing Only" },
]

const dateRangePresets = [
  { label: "Last 30 days", getValue: () => ({ from: subMonths(new Date(), 1), to: new Date() }) },
  { label: "Last 3 months", getValue: () => ({ from: subMonths(new Date(), 3), to: new Date() }) },
  { label: "Last 6 months", getValue: () => ({ from: subMonths(new Date(), 6), to: new Date() }) },
  { label: "Year to date", getValue: () => ({ from: startOfYear(new Date()), to: new Date() }) },
  { label: "Last year", getValue: () => ({ from: subYears(new Date(), 1), to: new Date() }) },
]

export function DashboardFilters({ dateRange, onDateRangeChange }: DashboardFiltersProps) {
  const [mounted, setMounted] = useState(false)
  // TODO: fetch facilities from server action instead of hardcoded empty list
  const [facilities] = useState<{ id: string; name: string }[]>([])
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([])
  const [selectedVendors, setSelectedVendors] = useState<string[]>([])
  const [contractType, setContractType] = useState("all")

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleDatePreset = (preset: (typeof dateRangePresets)[number]) => {
    const { from, to } = preset.getValue()
    onDateRangeChange({
      from: from.toISOString().split("T")[0],
      to: to.toISOString().split("T")[0],
    })
  }

  const handleCalendarSelect = (range: RDPDateRange | undefined) => {
    if (range?.from && range?.to) {
      onDateRangeChange({
        from: range.from.toISOString().split("T")[0],
        to: range.to.toISOString().split("T")[0],
      })
    }
  }

  const activeFiltersCount =
    (selectedFacilities.length > 0 ? 1 : 0) +
    (selectedVendors.length > 0 ? 1 : 0) +
    (contractType !== "all" ? 1 : 0)

  const clearFilters = () => {
    setSelectedFacilities([])
    setSelectedVendors([])
    setContractType("all")
  }

  const calendarSelected: RDPDateRange = {
    from: new Date(dateRange.from),
    to: new Date(dateRange.to),
  }

  const dateRangeText =
    mounted
      ? `${format(new Date(dateRange.from), "MMM d, yyyy")} - ${format(new Date(dateRange.to), "MMM d, yyyy")}`
      : "All Time"

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        {/* Date Range */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="justify-start text-left font-normal min-w-[240px]"
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateRangeText}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <div className="flex">
              <div className="border-r p-3">
                <div className="flex flex-col gap-1">
                  {dateRangePresets.map((preset) => (
                    <Button
                      key={preset.label}
                      variant="ghost"
                      size="sm"
                      className="justify-start"
                      onClick={() => handleDatePreset(preset)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="p-3">
                <Calendar
                  mode="range"
                  selected={calendarSelected}
                  onSelect={handleCalendarSelect}
                  numberOfMonths={2}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Facility Filter */}
        <Select
          value={selectedFacilities.length === 1 ? selectedFacilities[0] : "all"}
          onValueChange={(value) =>
            setSelectedFacilities(value === "all" ? [] : [value])
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities.map((facility) => (
              <SelectItem key={facility.id} value={facility.id}>
                {facility.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Vendor Filter */}
        <Select
          value={selectedVendors.length === 1 ? selectedVendors[0] : "all"}
          onValueChange={(value) =>
            setSelectedVendors(value === "all" ? [] : [value])
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Vendors" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Vendors</SelectItem>
            {vendors.map((vendor) => (
              <SelectItem key={vendor.id} value={vendor.id}>
                {vendor.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Contract Type */}
        <Select value={contractType} onValueChange={setContractType}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {contractTypes.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Active Filters Badge */}
        {activeFiltersCount > 0 && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Filter className="h-3 w-3" />
              {activeFiltersCount} filter{activeFiltersCount > 1 ? "s" : ""} active
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-7 px-2"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
