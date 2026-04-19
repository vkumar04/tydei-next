"use client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { FuzzyDuplicatePair } from "@/lib/cog/ai-dedup"

interface Props {
  pairs: FuzzyDuplicatePair[]
}

export function DedupAdvisorCard({ pairs }: Props) {
  if (pairs.length === 0) return null
  return (
    <Card>
      <CardHeader><CardTitle>Possible duplicates</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {pairs.length} pairs flagged by fuzzy matcher. Review before committing import.
        </p>
        {pairs.slice(0, 10).map((p, i) => (
          <div key={i} className="rounded-md border p-2 text-xs">
            <p className="font-mono">{p.a.id} vs {p.b.id}</p>
            <p>{p.reasons.join(", ")}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
