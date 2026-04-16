import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, GitMerge } from "lucide-react"
import type { SimilarPair } from "./types"

interface Props {
  pairs: SimilarPair[]
  onMerge: (source: string, target: string) => void
}

export function SimilarCategoriesAlert({ pairs, onMerge }: Props) {
  if (pairs.length === 0) return null

  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Similar Categories Detected</AlertTitle>
      <AlertDescription>
        <p className="mb-3">
          The following category pairs have similar names and may represent the same product line.
          Merging consolidates their spend for more accurate share analysis.
        </p>
        <div className="space-y-2">
          {pairs.map((pair) => (
            <div
              key={`${pair.a}-${pair.b}`}
              className="flex items-center justify-between gap-3 rounded-md border p-3 bg-background"
            >
              <div className="flex items-center gap-2 text-sm min-w-0">
                <span className="font-medium truncate">{pair.a}</span>
                <span className="text-muted-foreground shrink-0">&harr;</span>
                <span className="font-medium truncate">{pair.b}</span>
                <Badge variant="outline" className="shrink-0">
                  {Math.round(pair.similarity * 100)}% match
                </Badge>
              </div>
              <Button size="sm" variant="secondary" onClick={() => onMerge(pair.b, pair.a)}>
                <GitMerge className="h-3 w-3 mr-1" />
                Merge
              </Button>
            </div>
          ))}
        </div>
      </AlertDescription>
    </Alert>
  )
}
