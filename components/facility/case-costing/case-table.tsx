"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DataTable } from "@/components/shared/tables/data-table"
import { getCaseColumns } from "./case-columns"
import { useCases } from "@/hooks/use-case-costing"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
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
  const [page, setPage] = useState(1)
  const pageSize = 25

  const { data, isLoading } = useCases(facilityId, {
    surgeonName: surgeon || undefined,
    cptCode: cptCode || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    pageSize,
  })

  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)

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
            onValueChange={(v) => {
              setSurgeon(v === "__all__" ? "" : v)
              setPage(1)
            }}
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
            onValueChange={(v) => {
              setCptCode(v === "__all__" ? "" : v)
              setPage(1)
            }}
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
            onChange={(e) => {
              setDateFrom(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className="w-[150px]">
          <label className="mb-1 block text-xs text-muted-foreground">
            To
          </label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data?.cases ?? []}
        isLoading={isLoading}
        searchKey="caseNumber"
        searchPlaceholder="Search cases..."
        pagination={false}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()} cases
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

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
