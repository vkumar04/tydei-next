"use client"

import { useEffect, useMemo, useState } from "react"
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
import {
  getCOGVendorMappings,
  listVendorsForRemap,
  remapCOGVendorName,
  type CogVendorMapping,
  type VendorOption,
} from "@/lib/actions/cog-vendor-mapping"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/formatting"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CogVendorMappingDialog({ open, onOpenChange }: Props) {
  const [filter, setFilter] = useState("")

  const mappingsQuery = useQuery({
    queryKey: ["cog-vendor-mappings"],
    queryFn: getCOGVendorMappings,
    enabled: open,
  })
  const vendorsQuery = useQuery({
    queryKey: ["cog-vendor-mapping-targets"],
    queryFn: listVendorsForRemap,
    enabled: open,
  })

  const filtered = useMemo(() => {
    const rows = mappingsQuery.data ?? []
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.vendorName.toLowerCase().includes(q) ||
        (r.currentVendorName ?? "").toLowerCase().includes(q),
    )
  }, [mappingsQuery.data, filter])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Vendor Mapping</DialogTitle>
          <DialogDescription>
            Re-assign which canonical vendor each COG vendor name maps to.
            Useful for combining duplicates ("Stryker Corp" → "Stryker") or
            fixing names that landed on the wrong vendor during import.
            Changes re-run match status for affected vendors.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search vendor names…"
            className="max-w-sm"
          />
          <div className="text-muted-foreground text-xs">
            {mappingsQuery.data
              ? `${mappingsQuery.data.length} distinct names`
              : ""}
          </div>
        </div>

        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0">
              <TableRow>
                <TableHead>COG vendor name</TableHead>
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
                    No COG vendor names yet.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((row) => (
                  <MappingRow
                    key={row.vendorName}
                    row={row}
                    vendors={vendorsQuery.data ?? []}
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
  vendors,
}: {
  row: CogVendorMapping
  vendors: VendorOption[]
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [pendingVendorId, setPendingVendorId] = useState<string | null>(
    row.currentVendorId,
  )
  const [pendingLabel, setPendingLabel] = useState<string | null>(
    row.currentVendorName,
  )
  // Vick 2026-05-30 bug doc ("only lets you UNMAP it does not let
  // you map it"): the previous popover lumped Unmap and the vendor
  // list into one CommandGroup, where the cmdk search filter could
  // hide vendor items based on residual input state. Pulling Unmap
  // out as a dedicated icon button (and resetting pending state
  // when the row prop refreshes after Apply) makes the mapping
  // verb-explicit + bug-resistant.
  useEffect(() => {
    setPendingVendorId(row.currentVendorId)
    setPendingLabel(row.currentVendorName)
  }, [row.currentVendorId, row.currentVendorName])

  const dirty = pendingVendorId !== row.currentVendorId

  const mutation = useMutation({
    mutationFn: remapCOGVendorName,
    onSuccess: (res) => {
      toast.success(
        `Re-mapped ${res.recordsUpdated} record${res.recordsUpdated === 1 ? "" : "s"}`,
      )
      queryClient.invalidateQueries({ queryKey: ["cog-vendor-mappings"] })
      queryClient.invalidateQueries({ queryKey: queryKeys.cogRecords.all })
      // Kept broad: a vendor remap reassigns spend across every contract
      // for the old/new vendor — affected ids unknown here.
      queryClient.invalidateQueries({ queryKey: queryKeys.contracts.all })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Re-map failed")
    },
  })

  return (
    <TableRow>
      <TableCell className="font-medium">{row.vendorName}</TableCell>
      <TableCell className="text-right tabular-nums">
        {row.recordCount.toLocaleString()}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCurrency(row.totalSpend)}
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
                  {pendingLabel ?? (
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
                <CommandInput placeholder="Search vendors…" autoFocus />
                <CommandList style={{ maxHeight: 320 }}>
                  <CommandEmpty>No vendors found.</CommandEmpty>
                  <CommandGroup heading={`${vendors.length} vendors`}>
                    {vendors.map((v) => (
                      <CommandItem
                        key={v.id}
                        // cmdk filters by `value` substring. Include the id
                        // so duplicate display names (rare but possible)
                        // stay distinct in the keyboard nav order.
                        value={`${v.name} ${v.id}`}
                        onSelect={() => {
                          setPendingVendorId(v.id)
                          setPendingLabel(v.name)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            pendingVendorId === v.id
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        <span className="flex-1 truncate">{v.name}</span>
                        {v.hasActiveContract && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            contract
                          </Badge>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {pendingVendorId !== null && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              title="Unmap"
              onClick={() => {
                setPendingVendorId(null)
                setPendingLabel(null)
              }}
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
              vendorName: row.vendorName,
              newVendorId: pendingVendorId,
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
