"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { evaluateServiceSla } from "@/lib/actions/analytics/service-sla"

const fmtUsd = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`

interface SlaResult {
  responsePenalty: number
  uptimePenalty: number
  totalPenalty: number
  annualFee: number
}

export function ServiceSlaCard({ contractId }: { contractId: string }) {
  const [form, setForm] = useState({
    actualResponseHours: 6,
    slaResponseHours: 4,
    actualUptimePct: 99.5,
    slaUptimePct: 99.9,
    hourlyPenaltyRate: 250,
  })

  const mutation = useMutation({
    mutationFn: () => evaluateServiceSla({ contractId, ...form }),
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Evaluation failed"),
  })

  const result = mutation.data as SlaResult | undefined

  function update<K extends keyof typeof form>(k: K, v: number) {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service SLA Penalty Calculator</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NumberField
            label="Actual response (hrs)"
            value={form.actualResponseHours}
            step={0.5}
            onChange={(v) => update("actualResponseHours", v)}
          />
          <NumberField
            label="SLA response (hrs)"
            value={form.slaResponseHours}
            step={0.5}
            onChange={(v) => update("slaResponseHours", v)}
          />
          <NumberField
            label="Hourly penalty ($/hr)"
            value={form.hourlyPenaltyRate}
            step={50}
            onChange={(v) => update("hourlyPenaltyRate", v)}
          />
          <NumberField
            label="Actual uptime (%)"
            value={form.actualUptimePct}
            step={0.1}
            onChange={(v) => update("actualUptimePct", v)}
          />
          <NumberField
            label="SLA uptime (%)"
            value={form.slaUptimePct}
            step={0.1}
            onChange={(v) => update("slaUptimePct", v)}
          />
          <div className="flex items-end">
            <Button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="w-full"
            >
              {mutation.isPending ? "Evaluating…" : "Evaluate"}
            </Button>
          </div>
        </div>

        {mutation.isPending ? (
          <Skeleton className="mt-6 h-24 w-full" />
        ) : result ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Stat
              label="Response penalty"
              value={fmtUsd(result.responsePenalty)}
              tone={result.responsePenalty > 0 ? "negative" : "positive"}
            />
            <Stat
              label="Uptime penalty"
              value={fmtUsd(result.uptimePenalty)}
              tone={result.uptimePenalty > 0 ? "negative" : "positive"}
            />
            <Stat
              label="Total penalty"
              value={fmtUsd(result.totalPenalty)}
              tone={result.totalPenalty > 0 ? "negative" : "positive"}
              badge={
                result.totalPenalty === 0 ? (
                  <Badge variant="default">SLA met</Badge>
                ) : (
                  <Badge variant="destructive">SLA breach</Badge>
                )
              }
              sublabel={`vs annual fee ${fmtUsd(result.annualFee)}`}
            />
          </div>
        ) : (
          <p className="mt-6 text-xs text-muted-foreground">
            Tydei doesn&apos;t persist SLA targets/actuals on contracts yet —
            enter them above to score this period&apos;s penalty.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function NumberField({
  label,
  value,
  step,
  onChange,
}: {
  label: string
  value: number
  step: number
  onChange: (n: number) => void
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  badge,
  sublabel,
}: {
  label: string
  value: string
  tone?: "positive" | "negative"
  badge?: React.ReactNode
  sublabel?: string
}) {
  const valClass =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-700 dark:text-red-400"
        : ""
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-semibold ${valClass}`}>{value}</p>
      {badge}
      {sublabel ? (
        <p className="text-xs text-muted-foreground">{sublabel}</p>
      ) : null}
    </div>
  )
}
