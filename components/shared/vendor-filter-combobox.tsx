"use client"

import { useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/**
 * Bug #15 (2026-05-08, Vick): the Pricing List + Pricing File Imports
 * vendor filters used a plain Radix `<Select>` with no search and no
 * scroll affordance. With hundreds of vendors the popover capped at
 * the visible window and the user reported "can't scroll past the A's."
 * This combobox is the same shape used by COG records since bug #14:
 * Popover + cmdk Command, with an explicit `style.maxHeight` driven by
 * the popover's available-height var so the list always uses the room
 * it has and falls back to 60vh.
 */
export function VendorFilterCombobox({
  vendors,
  value,
  onChange,
  placeholder = "All vendors",
  width = 200,
}: {
  vendors: Array<{ id: string; name: string }>
  /** Empty string = "all". */
  value: string
  onChange: (next: string) => void
  placeholder?: string
  width?: number
}) {
  const [open, setOpen] = useState(false)
  const selected = value
    ? vendors.find((v) => v.id === value)?.name ?? "Selected vendor"
    : null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="justify-between font-normal"
          style={{ width }}
        >
          <span className="truncate text-left">{selected ?? placeholder}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* Bug #26 (2026-05-11, Vick): the earlier fix (bug #15) used
          `min(60vh, var(--radix-popover-content-available-height,
          320px))` on the CommandList, but the user reports the lists
          still don't scroll past the A's. Suspect: the
          `var(--radix-popover-content-available-height)` value
          collapses to a small number when the popover anchors low in
          the viewport (which it does after a search filter shrinks
          the list briefly then grows it back), AND the inline-style
          max-height in some Safari/Edge builds doesn't repaint when
          the var changes. Replace with a fixed pixel cap on the
          PopoverContent itself plus a flex layout so the CommandList
          gets a real bounded height it can scroll within. */}
      <PopoverContent
        className="w-[260px] p-0 flex flex-col"
        align="start"
        sideOffset={4}
        style={{ maxHeight: "min(70vh, 480px)" }}
      >
        <Command className="flex flex-1 min-h-0 flex-col">
          <CommandInput placeholder="Search vendors…" />
          <CommandList className="flex-1 min-h-0 overflow-y-auto">
            <CommandEmpty>No vendor matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                onSelect={() => {
                  onChange("")
                  setOpen(false)
                }}
              >
                <span>{placeholder}</span>
                {!value && <Check className="ml-auto h-4 w-4" />}
              </CommandItem>
              {vendors.map((v) => (
                <CommandItem
                  key={v.id}
                  value={v.name}
                  onSelect={() => {
                    onChange(v.id)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{v.name}</span>
                  {value === v.id && <Check className="ml-auto h-4 w-4" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
