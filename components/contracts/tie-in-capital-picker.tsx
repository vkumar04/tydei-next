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

// Human-readable label for each contractType shown in the picker so users
// can tell a capital contract from a usage contract at a glance.
const TYPE_LABEL: Record<string, string> = {
  capital: "Capital",
  usage: "Usage",
  service: "Service",
  grouped: "Grouped",
  pricing_only: "Pricing-only",
  tie_in: "Tie-in",
}

export function TieInCapitalPicker({ value, onChange }: TieInCapitalPickerProps) {
  // Charles R5.13 — "Not letting it tie anything to capital. These contracts
  // are together, they are not separated contracts." The original query
  // restricted candidates to contractType="capital" which meant facilities
  // with no capital-typed contract had an empty dropdown and could not link
  // a tie-in at all. Broaden the list to every non-tie-in contract on the
  // facility so bundled-together contracts can be linked regardless of how
  // the counterpart was typed. The label still calls out capital contracts
  // first so the primary use case remains obvious.
  const { data, isLoading } = useQuery({
    queryKey: ["contracts", "tie-in-candidates"] as const,
    queryFn: () => getContracts({ pageSize: 200 }),
  })

  const options = (data?.contracts ?? [])
    .filter((c) => c.contractType !== "tie_in")
    .sort((a, b) => {
      // Capital contracts first (primary use case), then alphabetical.
      if (a.contractType === "capital" && b.contractType !== "capital") return -1
      if (a.contractType !== "capital" && b.contractType === "capital") return 1
      return a.name.localeCompare(b.name)
    })

  return (
    <Select
      value={value ?? NONE_VALUE}
      onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
    >
      <SelectTrigger>
        <SelectValue
          placeholder={
            isLoading
              ? "Loading contracts..."
              : options.length === 0
                ? "No contracts available to link"
                : "Pick a contract to tie to..."
          }
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>None</SelectItem>
        {options.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="flex items-center justify-between gap-2 w-full">
              <span>{c.name}</span>
              <span className="text-xs text-muted-foreground">
                {TYPE_LABEL[c.contractType] ?? c.contractType}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
