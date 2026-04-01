"use client"

import { useState } from "react"
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
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AlertTriangle, CheckCircle2, FileWarning } from "lucide-react"
import { toast } from "sonner"
import type { DuplicateMatch } from "@/lib/actions/cog-duplicate-check"
import type { COGRecordInput } from "@/lib/validators/cog-records"

export interface DuplicateGroup {
  importRecord: COGRecordInput
  importIndex: number
  existingMatch: DuplicateMatch
  resolution: "skip" | "overwrite" | "keep_both" | null
}

interface DuplicateValidatorProps {
  open: boolean
  groups: DuplicateGroup[]
  onResolved: (groups: DuplicateGroup[]) => void
  onBack: () => void
}

export function DuplicateValidator({
  open,
  groups: initialGroups,
  onResolved,
  onBack,
}: DuplicateValidatorProps) {
  const [groups, setGroups] = useState<DuplicateGroup[]>(initialGroups)

  const unresolved = groups.filter((g) => !g.resolution)
  const resolved = groups.filter((g) => g.resolution)

  function setResolution(index: number, resolution: DuplicateGroup["resolution"]) {
    setGroups((prev) =>
      prev.map((g) =>
        g.importIndex === index ? { ...g, resolution } : g
      )
    )
  }

  function bulkResolve(resolution: "skip" | "overwrite" | "keep_both") {
    setGroups((prev) =>
      prev.map((g) => (g.resolution ? g : { ...g, resolution }))
    )
    toast.success(`Set ${unresolved.length} duplicates to "${resolution}"`)
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="h-5 w-5 text-amber-500" />
            Duplicate Records Detected
          </DialogTitle>
          <DialogDescription>
            {groups.length} imported record(s) match existing records. Choose how to handle each.
          </DialogDescription>
        </DialogHeader>

        {/* Stats + Bulk Actions */}
        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Badge variant="destructive">{unresolved.length} unresolved</Badge>
            <Badge variant="default" className="bg-green-600">{resolved.length} resolved</Badge>
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => bulkResolve("skip")}>
              Skip All
            </Button>
            <Button variant="outline" size="sm" onClick={() => bulkResolve("overwrite")}>
              Overwrite All
            </Button>
            <Button variant="outline" size="sm" onClick={() => bulkResolve("keep_both")}>
              Keep Both All
            </Button>
          </div>
        </div>

        {/* Duplicate Groups */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-3 pr-2">
            {groups.map((group) => (
              <Card
                key={group.importIndex}
                className={group.resolution ? "border-green-500/30" : "border-amber-500/30"}
              >
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {group.resolution ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                      )}
                      <span className="font-mono text-sm">{group.importRecord.inventoryNumber}</span>
                      <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                        {group.importRecord.inventoryDescription}
                      </span>
                    </div>
                    {group.resolution && (
                      <Badge variant="secondary" className="text-xs capitalize">
                        {group.resolution.replace("_", " ")}
                      </Badge>
                    )}
                  </div>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Source</TableHead>
                        <TableHead className="text-xs">Inv #</TableHead>
                        <TableHead className="text-xs">Description</TableHead>
                        <TableHead className="text-xs">Vendor</TableHead>
                        <TableHead className="text-xs text-right">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="bg-blue-50/50 dark:bg-blue-950/20">
                        <TableCell>
                          <Badge variant="outline" className="text-xs">Existing</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{group.existingMatch.inventoryNumber}</TableCell>
                        <TableCell className="text-xs truncate max-w-[150px]">{group.existingMatch.existingDescription ?? "—"}</TableCell>
                        <TableCell className="text-xs">{group.existingMatch.existingVendor ?? "—"}</TableCell>
                        <TableCell className="text-xs text-right">${group.existingMatch.existingUnitCost.toFixed(2)}</TableCell>
                      </TableRow>
                      <TableRow className="bg-amber-50/50 dark:bg-amber-950/20">
                        <TableCell>
                          <Badge variant="outline" className="text-xs">Import</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{group.importRecord.inventoryNumber}</TableCell>
                        <TableCell className="text-xs truncate max-w-[150px]">{group.importRecord.inventoryDescription}</TableCell>
                        <TableCell className="text-xs">{group.importRecord.vendorName ?? "—"}</TableCell>
                        <TableCell className="text-xs text-right">${group.importRecord.unitCost.toFixed(2)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>

                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={group.resolution === "skip" ? "default" : "outline"}
                      className="text-xs h-7"
                      onClick={() => setResolution(group.importIndex, "skip")}
                    >
                      Skip
                    </Button>
                    <Button
                      size="sm"
                      variant={group.resolution === "overwrite" ? "default" : "outline"}
                      className="text-xs h-7"
                      onClick={() => setResolution(group.importIndex, "overwrite")}
                    >
                      Overwrite
                    </Button>
                    <Button
                      size="sm"
                      variant={group.resolution === "keep_both" ? "default" : "outline"}
                      className="text-xs h-7"
                      onClick={() => setResolution(group.importIndex, "keep_both")}
                    >
                      Keep Both
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={() => onResolved(groups)}>
            Continue Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
