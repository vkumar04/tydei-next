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
import { cn } from "@/lib/utils"

export interface MultiSelectOption {
  value: string
  /** Primary line shown in the list + counted in search. */
  label: string
  /** Secondary muted line under the label (e.g. category · price). */
  sublabel?: string
  /** Extra text folded into search matching (cmdk filter value). */
  searchText?: string
}

/**
 * Generic multi-select combobox — Popover + cmdk Command, modeled on the
 * single-select `VendorFilterCombobox`. Selecting an item toggles it and
 * keeps the popover open (multi-pick). The list scroll fix mirrors that
 * component (explicit `!max-h` on CommandList overriding cmdk's 300px cap,
 * bugs #15/#26/#30) so long benchmark lists scroll the whole way.
 *
 * Selected chips are intentionally rendered by the CALLER (so it can place
 * them where it wants and wire its own remove handler) — this component
 * only owns the picker.
 */
export function MultiSelectCombobox({
  options,
  selected,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches.",
  className,
}: {
  options: MultiSelectOption[]
  selected: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)

  function toggle(value: string) {
    onChange(
      selectedSet.has(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role, jsx-a11y/role-has-required-aria-props -- shadcn combobox pattern: Radix Popover trigger keeps role="combobox"; Radix wires aria-controls at runtime.
          role="combobox"
          aria-expanded={open}
          className={cn("h-9 w-full justify-between font-normal", className)}
        >
          <span className="truncate text-left">
            {selected.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              `${selected.length} selected`
            )}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
        align="start"
        sideOffset={4}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="!max-h-[50vh]">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const isSel = selectedSet.has(opt.value)
                return (
                  <CommandItem
                    key={opt.value}
                    value={`${opt.label} ${opt.sublabel ?? ""} ${opt.searchText ?? ""}`}
                    onSelect={() => toggle(opt.value)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        isSel ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{opt.label}</div>
                      {opt.sublabel && (
                        <div className="truncate text-xs text-muted-foreground">
                          {opt.sublabel}
                        </div>
                      )}
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
