"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getContracts } from "@/lib/actions/contracts"

interface TieInCapitalPickerProps {
  value: string | null
  onChange: (value: string | null) => void
}

const NONE_VALUE = "__none__"

export function TieInCapitalPicker({ value, onChange }: TieInCapitalPickerProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["contracts", "capital-list"] as const,
    queryFn: () => getContracts({ status: "active", type: "capital" }),
  })

  const options = data?.contracts ?? []

  return (
    <Select
      value={value ?? NONE_VALUE}
      onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
    >
      <SelectTrigger>
        <SelectValue
          placeholder={
            isLoading ? "Loading capital contracts..." : "Pick a capital contract..."
          }
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>None</SelectItem>
        {options.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
