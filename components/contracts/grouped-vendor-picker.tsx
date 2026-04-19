"use client"

/**
 * Picks a list of additional vendors to include in a grouped (GPO-style)
 * contract. The *primary* vendor is set on the main form via `vendorId`;
 * this picker only captures the extra participating vendors.
 *
 * NOTE: Persistence for the additional vendors is deferred — the schema
 * does not yet have a join table for grouped contracts. For now the
 * contract is created against the primary vendor only; the additional
 * vendor ids are held in UI state and surfaced to the user with an
 * explicit "coming soon" hint so expectations are clear.
 */

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { X } from "lucide-react"

export interface GroupedVendorOption {
  id: string
  name: string
  displayName: string | null
}

/** Pure helper — toggles `vendorId` in/out of `selected`. */
export function toggleGroupedVendor(
  selected: string[],
  vendorId: string,
): string[] {
  return selected.includes(vendorId)
    ? selected.filter((s) => s !== vendorId)
    : [...selected, vendorId]
}

/** Pure helper — case-insensitive substring match on name / display name. */
export function filterGroupedVendors(
  vendors: GroupedVendorOption[],
  query: string,
): GroupedVendorOption[] {
  const f = query.trim().toLowerCase()
  if (!f) return vendors
  return vendors.filter(
    (v) =>
      v.name.toLowerCase().includes(f) ||
      (v.displayName ?? "").toLowerCase().includes(f),
  )
}

interface Props {
  /** All vendors available to pick from (primary vendor already excluded). */
  availableVendors: GroupedVendorOption[]
  selected: string[]
  onChange: (next: string[]) => void
}

export function GroupedVendorPicker({
  availableVendors,
  selected,
  onChange,
}: Props) {
  const [filter, setFilter] = useState("")

  const filtered = useMemo(
    () => filterGroupedVendors(availableVendors, filter),
    [filter, availableVendors],
  )

  function toggle(vendorId: string) {
    onChange(toggleGroupedVendor(selected, vendorId))
  }

  function remove(vendorId: string) {
    onChange(selected.filter((id) => id !== vendorId))
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Persistence for additional vendors is coming — for now this contract
        will be created against the primary vendor only.
      </p>

      {availableVendors.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No additional vendors available. Add more vendors first, or change
          the primary vendor above.
        </p>
      ) : (
        <>
          <Input
            type="search"
            placeholder="Search vendors..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((vid) => {
                const vendor = availableVendors.find((v) => v.id === vid)
                const label = vendor?.displayName || vendor?.name || vid
                return (
                  <Badge key={vid} variant="secondary" className="gap-1 pr-1">
                    {label}
                    <button
                      type="button"
                      onClick={() => remove(vid)}
                      className="ml-1 rounded-full p-0.5 hover:bg-muted"
                      aria-label={`Remove ${label}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )
              })}
            </div>
          )}

          <ScrollArea className="h-48 rounded-md border p-2">
            <ul className="space-y-1">
              {filtered.map((vendor) => (
                <li
                  key={vendor.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent"
                  onClick={() => toggle(vendor.id)}
                >
                  <Checkbox checked={selected.includes(vendor.id)} />
                  <span className="text-sm">
                    {vendor.displayName || vendor.name}
                  </span>
                </li>
              ))}
            </ul>
          </ScrollArea>

          <p className="text-xs text-muted-foreground">
            {selected.length} additional vendor{selected.length === 1 ? "" : "s"} selected
          </p>
        </>
      )}
    </div>
  )
}
