"use client"

import { useState } from "react"
import { PageHeader } from "@/components/shared/page-header"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { RenewalTimeline } from "./renewal-timeline"
import { RenewalInitiateDialog } from "./renewal-initiate-dialog"
import { useExpiringContracts, useInitiateRenewal } from "@/hooks/use-renewals"
import { toast } from "sonner"

interface RenewalsClientProps {
  facilityId: string
}

export function RenewalsClient({ facilityId }: RenewalsClientProps) {
  const [windowDays, setWindowDays] = useState(120)
  const [renewalTarget, setRenewalTarget] = useState<{ id: string; name: string; vendor: string } | null>(null)

  const { data: contracts, isLoading } = useExpiringContracts(facilityId, windowDays, "facility")
  const initiate = useInitiateRenewal()

  async function handleInitiate() {
    if (!renewalTarget) return
    try {
      await initiate.mutateAsync(renewalTarget.id)
      toast.success("Renewal draft created successfully")
    } catch {
      toast.error("Failed to create renewal draft")
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contract Renewals"
        description="Track and manage expiring contracts"
        action={
          <Select value={String(windowDays)} onValueChange={(v) => setWindowDays(Number(v))}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Next 30 days</SelectItem>
              <SelectItem value="60">Next 60 days</SelectItem>
              <SelectItem value="90">Next 90 days</SelectItem>
              <SelectItem value="120">Next 120 days</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[160px] rounded-xl" />
          ))}
        </div>
      ) : (
        <RenewalTimeline
          contracts={contracts ?? []}
          onInitiate={(id) => {
            const c = contracts?.find((c) => c.id === id)
            if (c) setRenewalTarget({ id: c.id, name: c.name, vendor: c.vendorName })
          }}
        />
      )}

      <RenewalInitiateDialog
        contractName={renewalTarget?.name ?? ""}
        vendorName={renewalTarget?.vendor ?? ""}
        open={!!renewalTarget}
        onOpenChange={(open) => { if (!open) setRenewalTarget(null) }}
        onInitiate={handleInitiate}
      />
    </div>
  )
}
