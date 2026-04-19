"use client"

/**
 * Side-by-side comparison modal for 2-5 selected contracts.
 *
 * Wired from `contracts-list-client.tsx` when the user has multi-selected
 * contracts in the Compare tab. The actual row shape is built in the pure
 * {@link buildCompareRows} helper so the rendering logic stays trivial.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  buildCompareRows,
  type CompareContract,
} from "./compare-row-builder"

interface CompareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contracts: CompareContract[]
}

export function CompareModal({
  open,
  onOpenChange,
  contracts,
}: CompareModalProps) {
  const rows = buildCompareRows(contracts)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Compare {contracts.length} contracts</DialogTitle>
        </DialogHeader>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Metric</TableHead>
                {contracts.map((c) => (
                  <TableHead key={c.id}>{c.name}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="font-medium text-muted-foreground">
                    {r.label}
                  </TableCell>
                  {r.values.map((v, i) => (
                    <TableCell key={`${r.label}-${contracts[i]?.id ?? i}`}>
                      {v}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}
