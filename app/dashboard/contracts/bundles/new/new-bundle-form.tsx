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
import { Trash2, Plus } from "lucide-react"
import { createBundle } from "@/lib/actions/bundles"

type Mode = "all_or_nothing" | "proportional" | "cross_vendor"

interface MemberRow {
  contractId: string
  vendorId: string
  minimumSpend: string
  weightPercent: string
  rebateContribution: string
}

function emptyMember(): MemberRow {
  return {
    contractId: "",
    vendorId: "",
    minimumSpend: "",
    weightPercent: "0",
    rebateContribution: "",
  }
}

export function NewBundleForm({
  contracts,
  vendors,
}: {
  contracts: Array<{ id: string; name: string; vendor: { id: string; name: string } }>
  vendors: Array<{ id: string; name: string }>
}) {
  const router = useRouter()
  const [primaryContractId, setPrimaryContractId] = useState("")
  const [mode, setMode] = useState<Mode>("all_or_nothing")
  const [baseRate, setBaseRate] = useState("")
  const [bonusRate, setBonusRate] = useState("")
  const [acceleratorMultiplier, setAcceleratorMultiplier] = useState("")
  const [facilityBonusRate, setFacilityBonusRate] = useState("")
  const [effectiveStart, setEffectiveStart] = useState("")
  const [effectiveEnd, setEffectiveEnd] = useState("")
  const [members, setMembers] = useState<MemberRow[]>([emptyMember()])
  const [submitting, setSubmitting] = useState(false)

  const isCrossVendor = mode === "cross_vendor"

  async function handleSubmit() {
    if (!primaryContractId) {
      toast.error("Select a primary contract")
      return
    }
    setSubmitting(true)
    try {
      const result = await createBundle({
        primaryContractId,
        complianceMode: mode,
        baseRate: baseRate ? Number(baseRate) : undefined,
        bonusRate: bonusRate ? Number(bonusRate) : undefined,
        acceleratorMultiplier: acceleratorMultiplier
          ? Number(acceleratorMultiplier)
          : undefined,
        facilityBonusRate: facilityBonusRate
          ? Number(facilityBonusRate)
          : undefined,
        effectiveStart: effectiveStart || undefined,
        effectiveEnd: effectiveEnd || undefined,
        members: members.map((m) => ({
          contractId: !isCrossVendor ? m.contractId : undefined,
          vendorId: isCrossVendor ? m.vendorId : undefined,
          weightPercent: Number(m.weightPercent || "0"),
          minimumSpend: m.minimumSpend ? Number(m.minimumSpend) : undefined,
          rebateContribution:
            isCrossVendor && m.rebateContribution
              ? Number(m.rebateContribution)
              : undefined,
        })),
      })
      toast.success("Bundle created")
      router.push(`/dashboard/contracts/bundles/${result.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create bundle")
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bundle details</CardTitle>
          <CardDescription>
            Compliance mode determines which member fields apply.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Primary contract *</Label>
            <Select
              value={primaryContractId}
              onValueChange={setPrimaryContractId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select primary contract" />
              </SelectTrigger>
              <SelectContent>
                {contracts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} ({c.vendor.name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Compliance mode</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_or_nothing">
                  All-or-nothing (base + bonus + accelerator)
                </SelectItem>
                <SelectItem value="proportional">
                  Proportional (weighted compliance × base rate)
                </SelectItem>
                <SelectItem value="cross_vendor">
                  Cross-vendor (per-vendor rebate + facility bonus)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Base rebate rate (%)</Label>
            <Input
              type="number"
              step="0.1"
              placeholder="e.g. 2"
              value={baseRate}
              onChange={(e) => setBaseRate(e.target.value)}
            />
          </div>
          {mode === "all_or_nothing" && (
            <>
              <div className="space-y-1.5">
                <Label>Bonus rate (%) — applies at 120% of all minimums</Label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 1"
                  value={bonusRate}
                  onChange={(e) => setBonusRate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Accelerator multiplier — applies at 150%</Label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="e.g. 1.5"
                  value={acceleratorMultiplier}
                  onChange={(e) => setAcceleratorMultiplier(e.target.value)}
                />
              </div>
            </>
          )}
          {isCrossVendor && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Facility bonus rate (%) — applies when all compliant</Label>
              <Input
                type="number"
                step="0.1"
                placeholder="e.g. 1"
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              {isCrossVendor
                ? "Each row: vendor + minimum spend + rebate contribution %."
                : "Each row: contract + minimum spend (+ weight % for proportional)."}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMembers((p) => [...p, emptyMember()])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add member
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {members.map((m, i) => (
            <div
              key={i}
              className="grid gap-2 sm:grid-cols-6 rounded border p-3"
            >
              {isCrossVendor ? (
                <div className="sm:col-span-2 space-y-1">
                  <Label className="text-xs">Vendor</Label>
                  <Select
                    value={m.vendorId}
                    onValueChange={(v) =>
                      setMembers((prev) =>
                        prev.map((x, idx) =>
                          idx === i ? { ...x, vendorId: v } : x,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Pick vendor" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendors.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="sm:col-span-2 space-y-1">
                  <Label className="text-xs">Contract</Label>
                  <Select
                    value={m.contractId}
                    onValueChange={(v) =>
                      setMembers((prev) =>
                        prev.map((x, idx) =>
                          idx === i ? { ...x, contractId: v } : x,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="Pick contract" />
                    </SelectTrigger>
                    <SelectContent>
                      {contracts.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="sm:col-span-1 space-y-1">
                <Label className="text-xs">Min spend $</Label>
                <Input
                  className="h-8"
                  type="number"
                  value={m.minimumSpend}
                  onChange={(e) =>
                    setMembers((prev) =>
                      prev.map((x, idx) =>
                        idx === i ? { ...x, minimumSpend: e.target.value } : x,
                      ),
                    )
                  }
                />
              </div>
              {mode === "proportional" && (
                <div className="sm:col-span-1 space-y-1">
                  <Label className="text-xs">Weight %</Label>
                  <Input
                    className="h-8"
                    type="number"
                    step="1"
                    value={m.weightPercent}
                    onChange={(e) =>
                      setMembers((prev) =>
                        prev.map((x, idx) =>
                          idx === i ? { ...x, weightPercent: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </div>
              )}
              {isCrossVendor && (
                <div className="sm:col-span-1 space-y-1">
                  <Label className="text-xs">Rebate %</Label>
                  <Input
                    className="h-8"
                    type="number"
                    step="0.1"
                    value={m.rebateContribution}
                    onChange={(e) =>
                      setMembers((prev) =>
                        prev.map((x, idx) =>
                          idx === i
                            ? { ...x, rebateContribution: e.target.value }
                            : x,
                        ),
                      )
                    }
                  />
                </div>
              )}
              <div className="flex items-end justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={members.length === 1}
                  onClick={() =>
                    setMembers((prev) => prev.filter((_, idx) => idx !== i))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Creating…" : "Create bundle"}
        </Button>
      </div>
    </div>
  )
}
