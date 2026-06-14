"use client"

/**
 * Pricing-upload category realign step (Charles 2026-06-06).
 *
 * After a pricing file is parsed, the detected category names may not match
 * the system's canonical categories — so the importer silently coins new
 * ones and the file's spend never lines up with COG / market-share. This
 * dialog lets the user realign each detected category to a canonical one
 * (or keep it as-is) BEFORE import. The chosen map is handed back to the
 * caller as a raw-detected → canonical `Record<string,string>` and threaded
 * into the import action (`importContractPricing` / `bulkImportPricingFiles`),
 * where `applyCategoryRemap` applies it ahead of canonicalization.
 *
 * Mirrors the COG Category Mapping dialog's row UX (source name + target
 * combobox + one-click suggested chip).
 */

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronDown, Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getCategories } from "@/lib/actions/categories"
import { queryKeys } from "@/lib/query-keys"
import { suggestTarget } from "@/lib/categories/category-suggest"
import { cn } from "@/lib/utils"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  detectedCategories: string[]
  /** Called with the raw-detected → canonical remap (only entries the user
   *  realigned away from keep-as-is). Empty map = keep everything as detected. */
  onApply: (remap: Record<string, string>) => void
}

// Sentinel value for the "Keep as-is" option (no remap for this category).
const KEEP_AS_IS = "__keep__"

export function PricingCategoryRemapDialog({
  open,
  onOpenChange,
  detectedCategories,
  onApply,
}: Props) {
  // bugs.rtfd 2026-06-14: include superseded sources so every canonical name
  // (e.g. Ortho-Joints) is selectable as a "Map to" target. Distinct query key
  // from the de-cluttered `categories.all` so the two lists don't collide.
  const categoriesQuery = useQuery({
    queryKey: [...queryKeys.categories.all, "all-incl-superseded"] as const,
    queryFn: () => getCategories({ includeSuperseded: true }),
    enabled: open,
  })

  const canonicalNames = useMemo(
    () => (categoriesQuery.data ?? []).map((c) => c.name),
    [categoriesQuery.data],
  )

  // raw-detected category → chosen target (KEEP_AS_IS or a canonical name).
  const [choices, setChoices] = useState<Record<string, string>>({})

  // Reset choices whenever the dialog (re)opens with a new file's categories.
  useEffect(() => {
    if (open) setChoices({})
  }, [open, detectedCategories])

  function handleApply() {
    const remap: Record<string, string> = {}
    for (const raw of detectedCategories) {
      const choice = choices[raw]
      if (choice && choice !== KEEP_AS_IS && choice !== raw) {
        remap[raw] = choice
      }
    }
    onApply(remap)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Realign Categories</DialogTitle>
          <DialogDescription>
            Match the categories detected in your pricing file to the
            system&apos;s canonical categories so spend, coverage and
            market-share line up. Leave a row &quot;Keep as-is&quot; to import
            it unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0">
              <TableRow>
                <TableHead>Detected category</TableHead>
                <TableHead>Map to</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categoriesQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={2} className="py-8 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : detectedCategories.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={2}
                    className="text-muted-foreground py-8 text-center"
                  >
                    No categories detected in this file.
                  </TableCell>
                </TableRow>
              ) : (
                detectedCategories.map((raw) => (
                  <RemapRow
                    key={raw}
                    raw={raw}
                    canonicalNames={canonicalNames}
                    value={choices[raw] ?? KEEP_AS_IS}
                    onChange={(v) =>
                      setChoices((prev) => ({ ...prev, [raw]: v }))
                    }
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply}>Apply &amp; Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RemapRow({
  raw,
  canonicalNames,
  value,
  onChange,
}: {
  raw: string
  canonicalNames: string[]
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)

  const suggested = useMemo(
    () => suggestTarget(raw, canonicalNames),
    [raw, canonicalNames],
  )

  const label = value === KEEP_AS_IS ? "Keep as-is" : value

  return (
    <TableRow>
      <TableCell className="font-medium">{raw}</TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                role="combobox"
                className="w-[260px] justify-between"
              >
                <span
                  className={cn(
                    "truncate",
                    value === KEEP_AS_IS && "text-muted-foreground italic",
                  )}
                >
                  {label}
                </span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[300px] p-0"
              align="start"
              style={{
                maxHeight:
                  "var(--radix-popover-content-available-height, 60vh)",
              }}
            >
              <Command>
                <CommandInput placeholder="Search categories…" autoFocus />
                <CommandList style={{ maxHeight: 320 }}>
                  <CommandEmpty>No categories found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value={KEEP_AS_IS}
                      onSelect={() => {
                        onChange(KEEP_AS_IS)
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          value === KEEP_AS_IS ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="text-muted-foreground italic">
                        Keep as-is
                      </span>
                    </CommandItem>
                  </CommandGroup>
                  <CommandGroup heading={`${canonicalNames.length} categories`}>
                    {canonicalNames.map((name) => (
                      <CommandItem
                        key={name}
                        value={name}
                        onSelect={() => {
                          onChange(name)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            value === name ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex-1 truncate">{name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {suggested && suggested !== value && (
            <Badge
              variant="secondary"
              className="cursor-pointer whitespace-nowrap"
              onClick={() => onChange(suggested)}
              title="Click to use this suggestion"
            >
              Suggested: {suggested}
            </Badge>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
