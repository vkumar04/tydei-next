"use client"

/**
 * Category Mapping dialog — the category twin of the Vendor Mapping
 * dialog (#4, Vick 2026-05-31). Lets the user map COG category variants
 * ("JOINT", "CONSTRUCTS-JOINT-Hip") to one canonical category
 * ("Ortho-Joints"), the same way vendor names are mapped. Retags existing
 * rows + persists a confirmed rule the import resolver applies going
 * forward.
 */
import { useMemo, useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Check, ChevronDown, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import {
  getCOGCategoryMappings,
  remapCOGCategory,
  type CogCategoryMapping,
} from "@/lib/actions/cog-category-mapping"
import { getCategories } from "@/lib/actions/categories"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CogCategoryMappingDialog({ open, onOpenChange }: Props) {
  const [filter, setFilter] = useState("")

  const mappingsQuery = useQuery({
    queryKey: ["cog-category-mappings"],
    queryFn: getCOGCategoryMappings,
    enabled: open,
  })
  const categoriesQuery = useQuery({
    queryKey: queryKeys.categories.all,
    queryFn: getCategories,
    enabled: open,
  })

  const filtered = useMemo(() => {
    const rows = mappingsQuery.data ?? []
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.category.toLowerCase().includes(q) ||
        (r.mappedTo ?? "").toLowerCase().includes(q),
    )
  }, [mappingsQuery.data, filter])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Category Mapping</DialogTitle>
          <DialogDescription>
            Map COG category names to one canonical category — the same way
            vendor names are mapped. Combine variants ("JOINT" /
            "CONSTRUCTS-JOINT-Hip" → "Ortho-Joints") so COG and price-file
            categories line up. Changes retag existing rows and apply to
            future imports automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search categories…"
            className="max-w-sm"
          />
          <div className="text-muted-foreground text-xs">
            {mappingsQuery.data
              ? `${mappingsQuery.data.length} distinct categories`
              : ""}
          </div>
        </div>

        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0">
              <TableRow>
                <TableHead>COG category</TableHead>
                <TableHead className="text-right">Records</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead>Mapped to</TableHead>
                <TableHead className="w-[120px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappingsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-muted-foreground py-8 text-center"
                  >
                    No COG categories yet.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row) => (
                  <MappingRow
                    key={row.category}
                    row={row}
                    categories={(categoriesQuery.data ?? []).map((c) => c.name)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MappingRow({
  row,
  categories,
}: {
  row: CogCategoryMapping
  categories: string[]
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(row.mappedTo)

  useEffect(() => {
    setPending(row.mappedTo)
  }, [row.mappedTo])

  const dirty = pending !== row.mappedTo

  const mutation = useMutation({
    mutationFn: remapCOGCategory,
    onSuccess: (res) => {
      toast.success(
        `Re-mapped ${res.recordsUpdated} record${res.recordsUpdated === 1 ? "" : "s"}`,
      )
      queryClient.invalidateQueries({ queryKey: ["cog-category-mappings"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.cogRecords.all })
      queryClient.invalidateQueries({ queryKey: ["contracts"] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Re-map failed")
    },
  })

  // Targets: the canonical category list, minus this row's own name.
  const options = useMemo(
    () => categories.filter((c) => c.toLowerCase() !== row.category.toLowerCase()),
    [categories, row.category],
  )

  return (
    <TableRow>
      <TableCell className="font-medium">{row.category}</TableCell>
      <TableCell className="text-right tabular-nums">
        {row.recordCount.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {currency.format(row.totalSpend)}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                role="combobox"
                className="w-[240px] justify-between"
              >
                <span className="truncate">
                  {pending ?? (
                    <span className="text-muted-foreground italic">
                      Unmapped
                    </span>
                  )}
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
                  <CommandGroup heading={`${options.length} categories`}>
                    {options.map((c) => (
                      <CommandItem
                        key={c}
                        value={c}
                        onSelect={() => {
                          setPending(c)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            pending === c ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <span className="flex-1 truncate">{c}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {pending !== null && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              title="Unmap"
              onClick={() => setPending(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Button
          size="sm"
          variant={dirty ? "default" : "ghost"}
          disabled={!dirty || mutation.isPending}
          onClick={() =>
            mutation.mutate({
              cogCategory: row.category,
              contractCategory: pending,
            })
          }
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Apply"
          )}
        </Button>
      </TableCell>
    </TableRow>
  )
}
