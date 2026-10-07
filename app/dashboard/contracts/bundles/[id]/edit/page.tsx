import { notFound } from "next/navigation"
import Link from "next/link"
import { getBundle } from "@/lib/actions/bundles"
import { Button } from "@/components/ui/button"
import { EditBundleForm } from "./edit-bundle-form"
import { requireFacility } from "@/lib/actions/auth"

export default async function EditBundlePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireFacility()
  const { id } = await params
  const data = await getBundle(id)
  if (!data) notFound()
  const { bundle } = data

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Edit bundle
          </p>
          <h1 className="text-2xl font-semibold">
            {bundle.primaryContract.name}
          </h1>
        </div>
        <Button variant="outline" asChild>
          <Link href={`/dashboard/contracts/bundles/${id}`}>← Cancel</Link>
        </Button>
      </div>

      <EditBundleForm
        bundleId={bundle.id}
        initial={{
          complianceMode: bundle.complianceMode as
            | "all_or_nothing"
            | "proportional"
            | "cross_vendor",
          baseRate: bundle.baseRate == null ? null : Number(bundle.baseRate),
          bonusRate: bundle.bonusRate == null ? null : Number(bundle.bonusRate),
          acceleratorMultiplier:
            bundle.acceleratorMultiplier == null
              ? null
              : Number(bundle.acceleratorMultiplier),
          facilityBonusRate:
            bundle.facilityBonusRate == null
              ? null
              : Number(bundle.facilityBonusRate),
          effectiveStart: bundle.effectiveStart
            ? String(bundle.effectiveStart)
            : null,
          effectiveEnd: bundle.effectiveEnd
            ? String(bundle.effectiveEnd)
            : null,
        }}
      />
    </div>
  )
}
