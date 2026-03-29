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
import type { PayorContractRate } from "@/lib/validators/payor-contracts"

interface PayorRateEditorProps {
  rates: PayorContractRate[]
  onChange: (rates: PayorContractRate[]) => void
}

export function PayorRateEditor({ rates, onChange }: PayorRateEditorProps) {
  const addRate = () => {
    onChange([...rates, { cptCode: "", description: "", rate: 0 }])
  }

  const updateRate = (index: number, field: keyof PayorContractRate, value: string | number) => {
    const updated = rates.map((r, i) => (i === index ? { ...r, [field]: value } : r))
    onChange(updated)
  }

  const removeRate = (index: number) => {
    onChange(rates.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">CPT Rate Schedule</h4>
        <Button type="button" variant="outline" size="sm" onClick={addRate}>
          <Plus className="size-3.5" /> Add Rate
        </Button>
      </div>
      {rates.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CPT Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Rate ($)</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rates.map((rate, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input
                    value={rate.cptCode}
                    onChange={(e) => updateRate(i, "cptCode", e.target.value)}
                    placeholder="99213"
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={rate.description ?? ""}
                    onChange={(e) => updateRate(i, "description", e.target.value)}
                    placeholder="Office visit"
                    className="h-8"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={rate.rate}
                    onChange={(e) => updateRate(i, "rate", parseFloat(e.target.value) || 0)}
                    className="h-8 w-24"
                  />
                </TableCell>
                <TableCell>
                  <Button type="button" variant="ghost" size="icon-xs" onClick={() => removeRate(i)}>
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
