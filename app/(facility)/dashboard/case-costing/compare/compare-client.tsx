"use client"

import { useState } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { SurgeonComparisonChart } from "@/components/facility/case-costing/surgeon-comparison-chart"
import { useSurgeonComparison, useSurgeonScorecards } from "@/hooks/use-case-costing"
import { X } from "lucide-react"

interface SurgeonCompareClientProps {
  facilityId: string
}

export function SurgeonCompareClient({ facilityId }: SurgeonCompareClientProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState("")

  const { data: scorecards } = useSurgeonScorecards(facilityId)
  const { data: comparison, isLoading } = useSurgeonComparison(
    facilityId,
    selected,
    selected.length >= 2
  )

  const surgeonNames = scorecards?.map((s) => s.surgeonName) ?? []
  const filtered = surgeonNames.filter(
    (n) =>
      n.toLowerCase().includes(search.toLowerCase()) && !selected.includes(n)
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Surgeon Comparison"
        description="Compare surgeon performance side-by-side"
      />

      <div className="flex flex-wrap items-center gap-2">
        {selected.map((name) => (
          <Badge key={name} variant="secondary" className="gap-1">
            {name}
            <button onClick={() => setSelected((p) => p.filter((n) => n !== name))}>
              <X className="size-3" />
            </button>
          </Badge>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Search surgeons to add..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {search && filtered.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {filtered.slice(0, 10).map((name) => (
            <Button
              key={name}
              variant="outline"
              size="sm"
              onClick={() => {
                setSelected((p) => [...p, name])
                setSearch("")
              }}
            >
              {name}
            </Button>
          ))}
        </div>
      )}

      {selected.length >= 2 && (
        isLoading ? (
          <Skeleton className="h-[400px] rounded-xl" />
        ) : comparison ? (
          <SurgeonComparisonChart comparison={comparison} />
        ) : null
      )}

      {selected.length < 2 && (
        <p className="text-sm text-muted-foreground">
          Select at least 2 surgeons to compare
        </p>
      )}
    </div>
  )
}
