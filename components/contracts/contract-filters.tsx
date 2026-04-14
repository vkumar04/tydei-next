"use client"

import type { ContractStatus, ContractType } from "@prisma/client"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface ContractFiltersProps {
  status: ContractStatus | "all"
  onStatusChange: (status: ContractStatus | "all") => void
  type: ContractType | "all"
  onTypeChange: (type: ContractType | "all") => void
  facilities?: { id: string; name: string }[]
  facilityFilter?: string
  onFacilityChange?: (id: string) => void
}

const statusOptions: { value: ContractStatus | "all"; label: string }[] = [
  { value: "all", label: "All Status" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "expired", label: "Expired" },
  { value: "draft", label: "Draft" },
]

const typeOptions: { value: ContractType | "all"; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "usage", label: "Usage" },
  { value: "pricing_only", label: "Pricing Only" },
  { value: "capital", label: "Capital" },
  { value: "service", label: "Service" },
  { value: "tie_in", label: "Tie-In" },
  { value: "grouped", label: "Grouped" },
]

export function ContractFilters({
  status,
  onStatusChange,
  type,
  onTypeChange,
  facilities,
  facilityFilter = "all",
  onFacilityChange,
}: ContractFiltersProps) {
  return (
    <>
      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="All Status" />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={type} onValueChange={onTypeChange}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          {typeOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {facilities && facilities.length > 0 && (
        <Select
          value={facilityFilter}
          onValueChange={(v) => onFacilityChange?.(v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Facilities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Facilities</SelectItem>
            {facilities.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </>
  )
}
