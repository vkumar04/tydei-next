"use client"

import { useState, useEffect, useMemo } from "react"
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
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CheckCircle2, AlertTriangle, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import { findBestMatches } from "@/lib/utils/levenshtein"
import type { COGRecordInput } from "@/lib/validators/cog-records"

interface VendorOption {
  id: string
  name: string
}

export interface VendorMapping {
  cogVendorName: string
  matchedVendorId: string | null
  matchedVendorName: string | null
  isNewVendor: boolean
  recordCount: number
}

interface VendorNameMatcherProps {
  open: boolean
  records: COGRecordInput[]
  vendors: VendorOption[]
  onResolved: (mappings: VendorMapping[]) => void
  onBack: () => void
}

export function VendorNameMatcher({
  open,
  records,
  vendors,
  onResolved,
  onBack,
}: VendorNameMatcherProps) {
  const [search, setSearch] = useState("")
  const [mappings, setMappings] = useState<VendorMapping[]>([])

  // Extract unique vendor names and find matches
  useEffect(() => {
    const vendorCounts = new Map<string, number>()
    for (const r of records) {
      if (r.vendorName) {
        vendorCounts.set(r.vendorName, (vendorCounts.get(r.vendorName) ?? 0) + 1)
      }
    }

    const newMappings: VendorMapping[] = []
    for (const [name, count] of vendorCounts) {
      // Check for exact match first (case-insensitive)
      const exact = vendors.find(
        (v) => v.name.toLowerCase() === name.toLowerCase()
      )
      if (exact) {
        newMappings.push({
          cogVendorName: name,
          matchedVendorId: exact.id,
          matchedVendorName: exact.name,
          isNewVendor: false,
          recordCount: count,
        })
        continue
      }

      // Fuzzy match
      const matches = findBestMatches(name, vendors)
      const bestMatch = matches[0]

      newMappings.push({
        cogVendorName: name,
        matchedVendorId: bestMatch && bestMatch.similarity >= 0.8 ? bestMatch.id : null,
        matchedVendorName: bestMatch && bestMatch.similarity >= 0.8 ? bestMatch.name : null,
        isNewVendor: false,
        recordCount: count,
      })
    }
    setMappings(newMappings)
  }, [records, vendors])

  const unresolved = mappings.filter((m) => !m.matchedVendorId && !m.isNewVendor)
  const resolved = mappings.filter((m) => m.matchedVendorId || m.isNewVendor)

  const filtered = useMemo(() => {
    if (!search) return mappings
    const q = search.toLowerCase()
    return mappings.filter((m) => m.cogVendorName.toLowerCase().includes(q))
  }, [mappings, search])

  function handleMatch(cogName: string, vendorId: string) {
    const vendor = vendors.find((v) => v.id === vendorId)
    setMappings((prev) =>
      prev.map((m) =>
        m.cogVendorName === cogName
          ? { ...m, matchedVendorId: vendorId, matchedVendorName: vendor?.name ?? null, isNewVendor: false }
          : m
      )
    )
  }

  function handleMarkNew(cogName: string) {
    setMappings((prev) =>
      prev.map((m) =>
        m.cogVendorName === cogName
          ? { ...m, matchedVendorId: null, matchedVendorName: null, isNewVendor: true }
          : m
      )
    )
  }

  function handleAutoMatchAll() {
    setMappings((prev) =>
      prev.map((m) => {
        if (m.matchedVendorId || m.isNewVendor) return m
        const matches = findBestMatches(m.cogVendorName, vendors)
        if (matches[0] && matches[0].similarity >= 0.7) {
          return { ...m, matchedVendorId: matches[0].id, matchedVendorName: matches[0].name }
        }
        return { ...m, isNewVendor: true }
      })
    )
    toast.success("Auto-matched all vendors")
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Match Vendor Names</DialogTitle>
          <DialogDescription>
            Match imported vendor names to existing vendors in the system.
            {unresolved.length > 0 && ` ${unresolved.length} vendor(s) need matching.`}
          </DialogDescription>
        </DialogHeader>

        {/* Stats */}
        <div className="flex gap-3">
          <Badge variant="default" className="bg-green-600">
            {resolved.length} matched
          </Badge>
          <Badge variant="destructive">
            {unresolved.length} unmatched
          </Badge>
          <Badge variant="outline">
            {records.length} total records
          </Badge>
        </div>

        {/* Search + Auto-match */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search vendors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleAutoMatchAll}>
            Auto-match All
          </Button>
        </div>

        {/* Vendor List */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-2 pr-2">
            {filtered.map((mapping) => {
              const isMatched = !!mapping.matchedVendorId || mapping.isNewVendor
              const suggestions = findBestMatches(mapping.cogVendorName, vendors, 0.3, 5)

              return (
                <Card
                  key={mapping.cogVendorName}
                  className={isMatched ? "border-green-500/30" : "border-amber-500/30"}
                >
                  <CardContent className="py-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {isMatched ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                        )}
                        <span className="font-medium text-sm">{mapping.cogVendorName}</span>
                        <Badge variant="outline" className="text-xs">
                          {mapping.recordCount} records
                        </Badge>
                      </div>
                      {mapping.isNewVendor && (
                        <Badge variant="secondary" className="text-xs">
                          <Plus className="h-3 w-3 mr-1" />
                          New vendor
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Select
                        value={mapping.matchedVendorId ?? ""}
                        onValueChange={(v) => {
                          if (v === "__new__") {
                            handleMarkNew(mapping.cogVendorName)
                          } else {
                            handleMatch(mapping.cogVendorName, v)
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select match..." />
                        </SelectTrigger>
                        <SelectContent>
                          {suggestions.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              <span>{s.name}</span>
                              <span className="ml-2 text-muted-foreground">
                                ({Math.round(s.similarity * 100)}%)
                              </span>
                            </SelectItem>
                          ))}
                          {vendors
                            .filter((v) => !suggestions.some((s) => s.id === v.id))
                            .slice(0, 10)
                            .map((v) => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.name}
                              </SelectItem>
                            ))}
                          <SelectItem value="__new__">
                            <span className="flex items-center gap-1">
                              <Plus className="h-3 w-3" />
                              Create as new vendor
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              // Mark all remaining as new
              setMappings((prev) =>
                prev.map((m) =>
                  !m.matchedVendorId && !m.isNewVendor ? { ...m, isNewVendor: true } : m
                )
              )
            }}
          >
            Create All as New
          </Button>
          <Button onClick={() => onResolved(mappings)}>
            Continue ({resolved.length}/{mappings.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
