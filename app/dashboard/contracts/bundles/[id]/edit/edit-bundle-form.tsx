"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { updateBundle } from "@/lib/actions/bundles"

type Mode = "all_or_nothing" | "proportional" | "cross_vendor"

interface EditBundleFormProps {
  bundleId: string
  initial: {
    complianceMode: Mode
    baseRate: number | null
    bonusRate: number | null
    acceleratorMultiplier: number | null
    facilityBonusRate: number | null
    effectiveStart: string | null
    effectiveEnd: string | null
  }
}

function toDateInput(v: string | null): string {
  if (!v) return ""
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ""
  return d.toISOString().slice(0, 10)
}

export function EditBundleForm({ bundleId, initial }: EditBundleFormProps) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(initial.complianceMode)
  const [baseRate, setBaseRate] = useState(
    initial.baseRate == null ? "" : String(initial.baseRate),
  )
  const [bonusRate, setBonusRate] = useState(
    initial.bonusRate == null ? "" : String(initial.bonusRate),
  )
  const [acceleratorMultiplier, setAcceleratorMultiplier] = useState(
    initial.acceleratorMultiplier == null
      ? ""
      : String(initial.acceleratorMultiplier),
  )
  const [facilityBonusRate, setFacilityBonusRate] = useState(
    initial.facilityBonusRate == null ? "" : String(initial.facilityBonusRate),
  )
  const [effectiveStart, setEffectiveStart] = useState(
    toDateInput(initial.effectiveStart),
  )
  const [effectiveEnd, setEffectiveEnd] = useState(
    toDateInput(initial.effectiveEnd),
  )
  const [submitting, setSubmitting] = useState(false)

  const isCrossVendor = mode === "cross_vendor"
  const isAllOrNothing = mode === "all_or_nothing"

  async function handleSubmit() {
    setSubmitting(true)
    try {
      await updateBundle({
        bundleId,
        complianceMode: mode,
        baseRate: baseRate === "" ? null : Number(baseRate),
        bonusRate: bonusRate === "" ? null : Number(bonusRate),
        acceleratorMultiplier:
          acceleratorMultiplier === "" ? null : Number(acceleratorMultiplier),
        facilityBonusRate:
          facilityBonusRate === "" ? null : Number(facilityBonusRate),
        effectiveStart: effectiveStart || null,
        effectiveEnd: effectiveEnd || null,
      })
      toast.success("Bundle updated")
      router.push(`/dashboard/contracts/bundles/${bundleId}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update")
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bundle settings</CardTitle>
          <CardDescription>
            Scalar fields only. To rewire members, delete and recreate.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Compliance mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_or_nothing">All-or-nothing</SelectItem>
                <SelectItem value="proportional">Proportional</SelectItem>
                <SelectItem value="cross_vendor">Cross-vendor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Base rebate rate (%)</Label>
            <Input
              type="number"
              step="0.1"
              value={baseRate}
              onChange={(e) => setBaseRate(e.target.value)}
            />
          </div>
          {isAllOrNothing && (
            <>
              <div className="space-y-1.5">
                <Label>Bonus rate (%) — at 120% of all minimums</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={bonusRate}
                  onChange={(e) => setBonusRate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Accelerator multiplier — at 150%</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={acceleratorMultiplier}
                  onChange={(e) => setAcceleratorMultiplier(e.target.value)}
                />
              </div>
            </>
          )}
          {isCrossVendor && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Facility bonus rate (%) — when all compliant</Label>
              <Input
                type="number"
                step="0.1"
                value={facilityBonusRate}
                onChange={(e) => setFacilityBonusRate(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Effective start</Label>
            <Input
              type="date"
              value={effectiveStart}
              onChange={(e) => setEffectiveStart(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Effective end</Label>
            <Input
              type="date"
              value={effectiveEnd}
              onChange={(e) => setEffectiveEnd(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() =>
            router.push(`/dashboard/contracts/bundles/${bundleId}`)
          }
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  )
}
