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
  /**
   * Read-only mode (Vick 2026-05-31 #3): carve-out terms derive their SKU
   * scope from the pricing file's carve-out % column, so the picker is
   * shown but not editable. Renders `selected` as a flat list with no
   * search box, checkboxes, or toggle handlers.
   */
  readOnly?: boolean
}

export function SpecificItemsPicker({
  availableItems,
  selected,
  onChange,
  readOnly = false,
}: Props) {
  const [filter, setFilter] = useState("")

  const filtered = useMemo(
    () => filterVendorItems(availableItems, filter),
    [filter, availableItems],
  )

  if (readOnly) {
    if (selected.length === 0) {
      return (
        <p className="text-xs text-muted-foreground">
          No items yet — upload a pricing file with a carve-out % column.
        </p>
      )
    }
    const descByNo = new Map(
      availableItems.map((i) => [i.vendorItemNo, i.description]),
    )
    return (
      <div className="space-y-2">
        <ScrollArea className="h-48 rounded-md border p-2">
          <ul className="space-y-1">
            {selected.map((no) => (
              <li key={no} className="flex items-center gap-2 px-2 py-1">
                <span className="font-mono text-xs">{no}</span>
                {descByNo.get(no) && (
                  <span className="truncate text-xs text-muted-foreground">
                    {descByNo.get(no)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </ScrollArea>
        <p className="text-xs text-muted-foreground">
          {selected.length} item{selected.length === 1 ? "" : "s"} · read-only
          (auto-derived from pricing file)
        </p>
      </div>
    )
  }

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
            <li key={item.vendorItemNo}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent">
                <Checkbox
                  checked={selected.includes(item.vendorItemNo)}
                  onCheckedChange={() => toggle(item.vendorItemNo)}
                />
              <span className="font-mono text-xs">{item.vendorItemNo}</span>
              {item.description && (
                <span className="truncate text-xs text-muted-foreground">
                  {item.description}
                </span>
              )}
              </label>
            </li>
          ))}
        </ul>
      </ScrollArea>
      <p className="text-xs text-muted-foreground">{selected.length} selected</p>
    </div>
  )
}
