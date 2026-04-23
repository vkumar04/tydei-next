"use client"

import { ChevronDown, Loader2, RefreshCw, Sparkles, X } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { RebateInsightCard } from "./rebate-insight-card"
import type { RebateInsight } from "@/lib/ai/rebate-optimizer-schemas"

/**
 * Collapsible AI Smart Recommendations card — extracted from the old
 * optimizer-client. Neutral styling (no purple gradient); the primary
 * token provides the accent.
 */
export interface RebateInsightFlag {
  id: string
  insightId: string
  title: string
  summary: string
}

export interface RebateInsightsData {
  insights: RebateInsight[]
  observations?: string[]
  generatedAt: number | string | Date
}

export interface AiInsightsPanelProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  insightsEnabled: boolean
  insightsData: RebateInsightsData | null
  insightsLoading: boolean
  insightsError: unknown
  regeneratePending: boolean
  flags: RebateInsightFlag[]
  flaggedInsightIds: Set<string>
  flagPending: boolean
  clearPending: boolean
  onGenerate: () => void
  onRegenerate: () => void
  onFlag: (insight: RebateInsight) => void
  onClearFlag: (id: string) => void
}

export function AiInsightsPanel({
  open,
  onOpenChange,
  insightsEnabled,
  insightsData,
  insightsLoading,
  insightsError,
  regeneratePending,
  flags,
  flaggedInsightIds,
  flagPending,
  clearPending,
  onGenerate,
  onRegenerate,
  onFlag,
  onClearFlag,
}: AiInsightsPanelProps) {
  return (
    <Card>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex flex-1 items-center gap-2 text-left"
              >
                <Sparkles className="h-5 w-5 text-primary" />
                <div>
                  <CardTitle className="text-base">
                    Smart Recommendations (AI)
                    {flags.length > 0 && (
                      <Badge variant="secondary" className="ml-2">
                        {flags.length} flagged
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-0.5">
                    Claude analyzes your portfolio for cross-contract
                    opportunities — roughly 10 seconds to generate.
                  </CardDescription>
                </div>
                <ChevronDown
                  className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${
                    open ? "rotate-180" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
            {open && insightsData && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRegenerate}
                disabled={insightsLoading}
                className="gap-1"
              >
                {regeneratePending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Regenerate
              </Button>
            )}
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            {!insightsEnabled && !insightsData && (
              <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
                <div className="flex items-center gap-3">
                  <Sparkles className="h-6 w-6 text-primary" />
                  <div>
                    <p className="text-sm font-medium">
                      Generate AI Smart Recommendations
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Portfolio-level insights with citations back to each
                      contract. Cached for 15 minutes.
                    </p>
                  </div>
                </div>
                <Button onClick={onGenerate} className="gap-1">
                  <Sparkles className="h-4 w-4" />
                  Generate Smart Recommendations
                </Button>
              </div>
            )}

            {insightsLoading && (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-[120px] rounded-xl" />
                ))}
              </div>
            )}

            {!insightsLoading && insightsError ? (
              <Alert variant="destructive">
                <AlertTitle>Could not generate recommendations</AlertTitle>
                <AlertDescription>
                  {insightsError instanceof Error
                    ? insightsError.message
                    : "Unknown error"}
                </AlertDescription>
              </Alert>
            ) : null}

            {!insightsLoading &&
              !insightsError &&
              insightsData &&
              insightsData.insights.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No actionable recommendations right now. Claude may surface
                  more once you have additional tier-gap contracts or recent
                  spend activity.
                </p>
              )}

            {!insightsLoading &&
              insightsData &&
              insightsData.insights.length > 0 && (
                <div className="space-y-3">
                  {insightsData.insights.map((insight) => (
                    <RebateInsightCard
                      key={insight.id}
                      insight={insight}
                      onFlag={onFlag}
                      isFlagging={flagPending}
                      isFlagged={flaggedInsightIds.has(insight.id)}
                    />
                  ))}
                  {insightsData.observations &&
                    insightsData.observations.length > 0 && (
                      <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                        <p className="font-medium">Observations</p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4">
                          {insightsData.observations.map((obs, i) => (
                            <li key={i}>{obs}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  <p className="pt-1 text-[10px] text-muted-foreground">
                    Generated{" "}
                    {new Date(insightsData.generatedAt).toLocaleString()}
                  </p>
                </div>
              )}

            {flags.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">Flagged follow-ups</p>
                  <Badge variant="secondary">{flags.length}</Badge>
                </div>
                <ul className="space-y-2">
                  {flags.map((flag) => (
                    <li
                      key={flag.id}
                      className="flex items-start justify-between gap-2 rounded border bg-background p-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{flag.title}</p>
                        <p className="truncate text-muted-foreground">
                          {flag.summary}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => onClearFlag(flag.id)}
                        disabled={clearPending}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
