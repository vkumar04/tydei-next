"use client"

/**
 * Search-and-check picker for multiple facilities. Used on the
 * contract-create form when `isMultiFacility` is on, to choose the
 * additional facilities a contract covers beyond the owning facility.
 *
 * Structure mirrors `specific-items-picker.tsx` — search input +
 * scrollable checkbox list — so the UX stays consistent.
 */

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"

export interface FacilityMultiSelectOption {
  id: string
  name: string
}

/** Pure helper — toggles `id` in/out of `selected`. */
export function toggleFacility(selected: string[], id: string): string[] {
  return selected.includes(id)
    ? selected.filter((s) => s !== id)
    : [...selected, id]
}

/** Pure helper — case-insensitive substring match on facility name. */
export function filterFacilities(
  facilities: FacilityMultiSelectOption[],
  query: string,
): FacilityMultiSelectOption[] {
  const f = query.trim().toLowerCase()
  if (!f) return facilities
  return facilities.filter((fac) => fac.name.toLowerCase().includes(f))
}

interface Props {
  facilities: FacilityMultiSelectOption[]
  selected: string[]
  onChange: (next: string[]) => void
}

export function FacilityMultiSelect({ facilities, selected, onChange }: Props) {
  const [filter, setFilter] = useState("")

  const filtered = useMemo(
    () => filterFacilities(facilities, filter),
    [filter, facilities],
  )

  if (facilities.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No other facilities available.
      </p>
    )
  }

  function toggle(id: string) {
    onChange(toggleFacility(selected, id))
  }

  return (
    <div className="space-y-2">
      <Input
        type="search"
        placeholder="Search facilities..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ScrollArea className="h-48 rounded-md border p-2">
        <ul className="space-y-1">
          {filtered.map((fac) => (
            <li
              key={fac.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent"
              onClick={() => toggle(fac.id)}
            >
              <Checkbox checked={selected.includes(fac.id)} />
              <span className="text-sm">{fac.name}</span>
            </li>
          ))}
        </ul>
      </ScrollArea>
      <p className="text-xs text-muted-foreground">{selected.length} selected</p>
    </div>
  )
}
