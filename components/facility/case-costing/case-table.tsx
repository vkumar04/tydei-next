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
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const { data, isLoading } = useCases(facilityId, {
    surgeonName: surgeon || undefined,
    cptCode: cptCode || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  })

  const [selected, setSelected] = useState<CaseWithRelations | null>(null)

  const columns = getCaseColumns((row) => setSelected(row))

  // Extract unique surgeon names for filter dropdown
  const surgeonNames = Array.from(
    new Set(
      (data?.cases ?? [])
        .map((c) => c.surgeonName)
        .filter((n): n is string => !!n)
    )
  ).sort()

  // Extract unique CPT codes for filter dropdown
  const cptCodes = Array.from(
    new Set(
      (data?.cases ?? [])
        .map((c) => c.primaryCptCode)
        .filter((c): c is string => !!c)
    )
  ).sort()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        {/* Surgeon filter */}
        <div className="w-[200px]">
          <label className="mb-1 block text-xs text-muted-foreground">
            Surgeon
          </label>
          <Select
            value={surgeon || "__all__"}
            onValueChange={(v) => setSurgeon(v === "__all__" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="All surgeons" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Surgeons</SelectItem>
              {surgeonNames.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Procedure filter */}
        <div className="w-[160px]">
          <label className="mb-1 block text-xs text-muted-foreground">
            Procedure
          </label>
          <Select
            value={cptCode || "__all__"}
            onValueChange={(v) => setCptCode(v === "__all__" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="All CPT" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Procedures</SelectItem>
              {cptCodes.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Date range */}
        <div className="w-[150px]">
          <label className="mb-1 block text-xs text-muted-foreground">
            From
          </label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="w-[150px]">
          <label className="mb-1 block text-xs text-muted-foreground">
            To
          </label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
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
            {selected.procedureCount} procedures, {selected.supplyCount}{" "}
            supplies
          </p>
        </div>
      )}
    </div>
  )
}
