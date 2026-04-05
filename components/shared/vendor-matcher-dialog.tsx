"use client"

import { useState, useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CheckCircle2, AlertCircle, Plus } from "lucide-react"
import { getVendors } from "@/lib/actions/vendors"
import { matchVendorByAlias } from "@/lib/vendor-aliases"
import { queryKeys } from "@/lib/query-keys"

interface VendorMatcherDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  vendorNames: string[]
  onMatched: (mappings: Record<string, string>) => void
}

const CREATE_NEW = "__create_new__"
const UNMATCHED = "__unmatched__"

export function VendorMatcherDialog({
  open,
  onOpenChange,
  vendorNames,
  onMatched,
}: VendorMatcherDialogProps) {
  const [mappings, setMappings] = useState<Record<string, string>>({})

  const { data: vendors } = useQuery({
    queryKey: queryKeys.vendors.all,
    queryFn: () => getVendors(),
    enabled: open,
  })

  // Unique sorted vendor names
  const uniqueNames = useMemo(
    () => Array.from(new Set(vendorNames)).sort(),
    [vendorNames]
  )

  // Auto-match using aliases when vendors load
  useEffect(() => {
    if (!vendors || vendors.length === 0 || uniqueNames.length === 0) return

    const auto: Record<string, string> = {}
    for (const name of uniqueNames) {
      if (mappings[name]) continue
      const matchedId = matchVendorByAlias(name, vendors)
      if (matchedId) {
        auto[name] = matchedId
      }
    }

    if (Object.keys(auto).length > 0) {
      setMappings((prev) => ({ ...prev, ...auto }))
    }
    // Only run when vendors/names change, not on every mappings change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors, uniqueNames])

  // Reset mappings when dialog opens with new names
  useEffect(() => {
    if (open) {
      setMappings({})
    }
  }, [open])

  const matchedCount = uniqueNames.filter(
    (n) => mappings[n] && mappings[n] !== UNMATCHED
  ).length

  function handleApply() {
    // Build the final mappings: name -> vendorId (or CREATE_NEW marker)
    const result: Record<string, string> = {}
    for (const name of uniqueNames) {
      const value = mappings[name]
      if (value && value !== UNMATCHED) {
        result[name] = value
      }
    }
    onMatched(result)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Match Vendors</DialogTitle>
          <DialogDescription>
            Map vendor names to existing vendors in your system.{" "}
            {matchedCount} of {uniqueNames.length} matched.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Import Name</TableHead>
                <TableHead>Match To</TableHead>
                <TableHead className="w-[80px]">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {uniqueNames.map((name) => {
                const value = mappings[name] ?? UNMATCHED
                const isMatched = value !== UNMATCHED
                return (
                  <TableRow key={name}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell>
                      <Select
                        value={value}
                        onValueChange={(v) =>
                          setMappings((prev) => ({ ...prev, [name]: v }))
                        }
                      >
                        <SelectTrigger className="w-[240px]">
                          <SelectValue placeholder="Select vendor..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNMATCHED}>
                            -- Not matched --
                          </SelectItem>
                          <SelectItem value={CREATE_NEW}>
                            <span className="flex items-center gap-1">
                              <Plus className="h-3 w-3" />
                              Create New
                            </span>
                          </SelectItem>
                          {vendors?.map((v) => (
                            <SelectItem key={v.id} value={v.id}>
                              {v.displayName || v.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {isMatched ? (
                        <Badge
                          variant="outline"
                          className="text-emerald-600 border-emerald-300"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Matched
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-amber-600 border-amber-300"
                        >
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Pending
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply}>
            Apply ({matchedCount} matched)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
