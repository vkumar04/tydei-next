"use client"

/**
 * Picks a list of vendor item numbers to scope a contract-term tier to.
 * Used when `term.appliesTo === "specific_items"` — callers pass the
 * contract's pricing-file items as `availableItems` and get back a
 * `vendorItemNo[]` via `onChange`.
 */

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"

export interface VendorItem {
  vendorItemNo: string
  description?: string | null
}

/** Pure helper — toggles `vendorItemNo` in/out of `selected`. */
export function toggleVendorItem(selected: string[], vendorItemNo: string): string[] {
  return selected.includes(vendorItemNo)
    ? selected.filter((s) => s !== vendorItemNo)
    : [...selected, vendorItemNo]
}

/** Pure helper — case-insensitive substring match on number or description. */
export function filterVendorItems(items: VendorItem[], query: string): VendorItem[] {
  const f = query.trim().toLowerCase()
  if (!f) return items
  return items.filter(
    (i) =>
      i.vendorItemNo.toLowerCase().includes(f) ||
      (i.description ?? "").toLowerCase().includes(f),
  )
}

interface Props {
  availableItems: VendorItem[]
  selected: string[]
  onChange: (next: string[]) => void
}

export function SpecificItemsPicker({ availableItems, selected, onChange }: Props) {
  const [filter, setFilter] = useState("")

  const filtered = useMemo(
    () => filterVendorItems(availableItems, filter),
    [filter, availableItems],
  )

  if (availableItems.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Add a pricing file to enable item-level scoping.
      </p>
    )
  }

  function toggle(vendorItemNo: string) {
    onChange(toggleVendorItem(selected, vendorItemNo))
  }

  return (
    <div className="space-y-2">
      <Input
        type="search"
        placeholder="Search items..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <ScrollArea className="h-48 rounded-md border p-2">
        <ul className="space-y-1">
          {filtered.map((item) => (
            <li
              key={item.vendorItemNo}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent"
              onClick={() => toggle(item.vendorItemNo)}
            >
              <Checkbox checked={selected.includes(item.vendorItemNo)} />
              <span className="font-mono text-xs">{item.vendorItemNo}</span>
              {item.description && (
                <span className="truncate text-xs text-muted-foreground">
                  {item.description}
                </span>
              )}
            </li>
          ))}
        </ul>
      </ScrollArea>
      <p className="text-xs text-muted-foreground">{selected.length} selected</p>
    </div>
  )
}
