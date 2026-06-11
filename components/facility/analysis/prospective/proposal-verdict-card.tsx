"use client"

/**
 * The "is it good?" banner (Charles 2026-06-10) — one verdict synthesized
 * from term scoring + pricing-vs-COG + 12-month lookback + legal language,
 * with every reason spelled out numerically. Renders first, evidence cards
 * below it.
 */

import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  AlertTriangle,
  CheckCircle2,
  Scale,
  XCircle,
} from "lucide-react"
import type { ProposalVerdict } from "@/lib/prospective-analysis/proposal-verdict"

const VERDICT_STYLES = {
  good_deal: {
    label: "Good deal",
    icon: CheckCircle2,
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300",
    border: "border-emerald-500/40",
  },
  negotiate: {
    label: "Negotiate",
    icon: Scale,
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
    border: "border-amber-500/40",
  },
  decline: {
    label: "Decline",
    icon: XCircle,
    badge: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
    border: "border-red-500/40",
  },
} as const

const TONE_ICON = {
  positive: <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />,
  warning: <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />,
  negative: <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />,
} as const

export function ProposalVerdictCard({
  verdict,
  vendorName,
}: {
  verdict: ProposalVerdict
  vendorName: string | null
}) {
  const style = VERDICT_STYLES[verdict.verdict]
  const Icon = style.icon

  return (
    <Card className={`border-2 ${style.border}`}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-3">
          <Icon className="h-7 w-7" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold">{style.label}</span>
              <Badge variant="secondary" className={style.badge}>
                {verdict.confidence} confidence
              </Badge>
            </div>
            {vendorName ? (
              <p className="text-xs text-muted-foreground">{vendorName}</p>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5">
          {verdict.reasons.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              {TONE_ICON[r.tone]}
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
        {verdict.missingInputs.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Verdict would firm up with: {verdict.missingInputs.join(", ")}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
