"use client"

import { Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

import { alertTypeIconConfig } from "./alert-config"

export type StatusFilterValue = "open" | "resolved" | "dismissed" | "all"
export type SeverityFilterValue = "all" | "high" | "medium" | "low"

interface AlertsToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  typeFilter: string
  onTypeChange: (value: string) => void
  severityFilter: SeverityFilterValue
  onSeverityChange: (value: SeverityFilterValue) => void
  statusFilter: StatusFilterValue
  onStatusChange: (value: StatusFilterValue) => void
  availableTypes: string[]
}

export function AlertsToolbar({
  search,
  onSearchChange,
  typeFilter,
  onTypeChange,
  severityFilter,
  onSeverityChange,
  statusFilter,
  onStatusChange,
  availableTypes,
}: AlertsToolbarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search alerts…"
          className="pl-8"
        />
      </div>

      <Select value={typeFilter} onValueChange={onTypeChange}>
        <SelectTrigger className="w-full sm:w-[170px]">
          <SelectValue placeholder="All types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {availableTypes.map((type) => (
            <SelectItem key={type} value={type}>
              {alertTypeIconConfig[type]?.label ?? type}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ToggleGroup
        type="single"
        value={severityFilter}
        onValueChange={(value) =>
          onSeverityChange((value || "all") as SeverityFilterValue)
        }
        variant="outline"
        size="sm"
      >
        <ToggleGroupItem value="all">All</ToggleGroupItem>
        <ToggleGroupItem value="high">High</ToggleGroupItem>
        <ToggleGroupItem value="medium">Medium</ToggleGroupItem>
        <ToggleGroupItem value="low">Low</ToggleGroupItem>
      </ToggleGroup>

      <Select
        value={statusFilter}
        onValueChange={(value) => onStatusChange(value as StatusFilterValue)}
      >
        <SelectTrigger className="w-full sm:w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="resolved">Resolved</SelectItem>
          <SelectItem value="dismissed">Dismissed</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>
    </div>
  )
}
