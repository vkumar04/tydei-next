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
}

const statusOptions: { value: ContractStatus | "all"; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "pending", label: "Pending" },
  { value: "expiring", label: "Expiring" },
  { value: "expired", label: "Expired" },
  { value: "draft", label: "Draft" },
]

const typeOptions: { value: ContractType | "all"; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "usage", label: "Usage" },
  { value: "capital", label: "Capital" },
  { value: "service", label: "Service" },
  { value: "tie_in", label: "Tie-In" },
  { value: "grouped", label: "Grouped" },
  { value: "pricing_only", label: "Pricing Only" },
]

export function ContractFilters({
  status,
  onStatusChange,
  type,
  onTypeChange,
}: ContractFiltersProps) {
  return (
    <>
      <Select value={status} onValueChange={onStatusChange}>
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Status" />
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
        <SelectTrigger className="w-[160px]">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          {typeOptions.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  )
}
