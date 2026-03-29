"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { SurgeonScorecardCard } from "./surgeon-scorecard"
import type { SurgeonScorecard } from "@/lib/actions/cases"

interface SurgeonScorecardsGridProps {
  scorecards: SurgeonScorecard[]
}

export function SurgeonScorecardsGrid({ scorecards }: SurgeonScorecardsGridProps) {
  const [search, setSearch] = useState("")

  const filtered = scorecards.filter((s) =>
    s.surgeonName.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <Input
        placeholder="Search surgeons..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((s) => (
          <SurgeonScorecardCard key={s.surgeonName} scorecard={s} />
        ))}
      </div>
    </div>
  )
}
