"use client"

import { Sparkles } from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"

interface CreditIndicatorProps {
  remaining: number
  total: number
  tier: string
}

const tierLabels: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
  unlimited: "Unlimited",
}

export function CreditIndicator({ remaining, total, tier }: CreditIndicatorProps) {
  const pct = total > 0 ? Math.round((remaining / total) * 100) : 0
  const isLow = pct < 20

  return (
    <div className="flex items-center gap-3">
      <Sparkles className="size-4 text-primary" />
      <div className="flex flex-1 items-center gap-2">
        <Progress
          value={pct}
          className={`h-2 w-24 ${isLow ? "[&>div]:bg-destructive" : ""}`}
        />
        <span className="text-xs text-muted-foreground">
          {remaining}/{total}
        </span>
      </div>
      <Badge variant="secondary" className="text-xs">
        {tierLabels[tier] ?? tier}
      </Badge>
    </div>
  )
}
