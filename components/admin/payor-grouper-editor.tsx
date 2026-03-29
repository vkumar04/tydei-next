"use client"

import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { PayorContractGrouper } from "@/lib/validators/payor-contracts"

interface PayorGrouperEditorProps {
  groupers: PayorContractGrouper[]
  onChange: (groupers: PayorContractGrouper[]) => void
}

export function PayorGrouperEditor({ groupers, onChange }: PayorGrouperEditorProps) {
  const addGrouper = () => {
    onChange([...groupers, { grouperName: "", rate: 0, cptCodes: [] }])
  }

  const updateGrouper = (index: number, field: keyof PayorContractGrouper, value: string | number | string[]) => {
    const updated = groupers.map((g, i) => (i === index ? { ...g, [field]: value } : g))
    onChange(updated)
  }

  const removeGrouper = (index: number) => {
    onChange(groupers.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Grouper Rates</h4>
        <Button type="button" variant="outline" size="sm" onClick={addGrouper}>
          <Plus className="size-3.5" /> Add Grouper
        </Button>
      </div>
      {groupers.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grouper Name</TableHead>
              <TableHead>Rate ($)</TableHead>
              <TableHead>CPT Codes</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupers.map((grouper, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input
                    value={grouper.grouperName}
                    onChange={(e) => updateGrouper(i, "grouperName", e.target.value)}
                    placeholder="Joint Replacement"
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={grouper.rate}
                    onChange={(e) => updateGrouper(i, "rate", parseFloat(e.target.value) || 0)}
                    className="h-8 w-24"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={grouper.cptCodes.join(", ")}
                    onChange={(e) => updateGrouper(i, "cptCodes", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
                    placeholder="27447, 27130"
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Button type="button" variant="ghost" size="icon-xs" onClick={() => removeGrouper(i)}>
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
