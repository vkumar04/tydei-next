"use client"

import { useState } from "react"
import { DataTable } from "@/components/shared/tables/data-table"
import { getCaseColumns } from "./case-columns"
import { useCases } from "@/hooks/use-case-costing"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { CaseWithRelations } from "@/lib/actions/cases"

interface CaseTableProps {
  facilityId: string
}

export function CaseTable({ facilityId }: CaseTableProps) {
  const [surgeon, setSurgeon] = useState("")
  const [cptCode, setCptCode] = useState("")
  const { data, isLoading } = useCases(facilityId, {
    surgeonName: surgeon || undefined,
    cptCode: cptCode || undefined,
  })

  const [selected, setSelected] = useState<CaseWithRelations | null>(null)

  const columns = getCaseColumns((row) => setSelected(row))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Filter by surgeon..."
          value={surgeon}
          onChange={(e) => setSurgeon(e.target.value)}
          className="max-w-[200px]"
        />
        <Input
          placeholder="CPT code..."
          value={cptCode}
          onChange={(e) => setCptCode(e.target.value)}
          className="max-w-[150px]"
        />
      </div>
      <DataTable
        columns={columns}
        data={data?.cases ?? []}
        isLoading={isLoading}
        searchKey="caseNumber"
        searchPlaceholder="Search cases..."
      />
      {selected && (
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">
            Case {selected.caseNumber} — {selected.surgeonName}
          </p>
          <p className="text-muted-foreground">
            {selected.procedureCount} procedures, {selected.supplyCount} supplies
          </p>
        </div>
      )}
    </div>
  )
}
