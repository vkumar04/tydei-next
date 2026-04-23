import Link from "next/link"
import { notFound } from "next/navigation"
import { getBundle } from "@/lib/actions/bundles"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { BundleImpactAnalysisCard } from "@/components/contracts/bundle-impact-analysis-card"

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  })
}

export default async function BundleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const data = await getBundle(id)
  if (!data) notFound()
  const { bundle, status } = data

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Tie-in bundle
          </p>
          <h1 className="text-2xl font-semibold">
            {bundle.primaryContract.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {bundle.primaryContract.vendor.name} ·{" "}
            <span className="font-mono">{bundle.complianceMode}</span>
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard/contracts/bundles">← Bundles</Link>
        </Button>
      </div>

      {/* Compliance summary. Different compliance modes render different
          fields — everything routes through the oracle-locked
          `computeBundleStatus` so the numbers here match v0 spec math. */}
      <Card>
        <CardHeader>
          <CardTitle>Compliance status</CardTitle>
          <CardDescription>
            Computed live from COG in the bundle&rsquo;s active window via{" "}
            <span className="font-mono">computeBundleStatus</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {status?.allOrNothing && (
            <>
              <Stat
                label="Total spend"
                value={fmt(status.allOrNothing.totalSpend)}
              />
              <Stat
                label="Rebate earned"
                value={fmt(status.allOrNothing.rebateEarned)}
              />
              <Stat
                label="Applicable rate"
                value={`${status.allOrNothing.applicableRate}%`}
              />
              <Stat
                label="Bonus level"
                value={status.allOrNothing.bonusLevel}
              />
            </>
          )}
          {status?.proportional && (
            <>
              <Stat
                label="Overall compliance"
                value={`${(status.proportional.overallCompliance * 100).toFixed(1)}%`}
              />
              <Stat
                label="Effective rate"
                value={`${status.proportional.effectiveRate.toFixed(2)}%`}
              />
              <Stat
                label="Rebate earned"
                value={fmt(status.proportional.rebateEarned)}
              />
              <Stat
                label="Lost rebate"
                value={fmt(status.proportional.lostRebate)}
              />
            </>
          )}
          {status?.crossVendor && (
            <>
              <Stat
                label="Total spend"
                value={fmt(status.crossVendor.totalSpend)}
              />
              <Stat
                label="Vendor rebates"
                value={fmt(status.crossVendor.vendorRebateTotal)}
              />
              <Stat
                label="Facility bonus"
                value={fmt(status.crossVendor.facilityBonus)}
              />
              <Stat
                label="Total rebate"
                value={fmt(status.crossVendor.totalRebate)}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* Members table */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            {bundle.members.length} member
            {bundle.members.length === 1 ? "" : "s"} tied to this bundle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 text-left font-medium">Name</th>
                  <th className="py-2 pr-3 text-left font-medium">Vendor</th>
                  <th className="py-2 pr-3 text-right font-medium">Min spend</th>
                  <th className="py-2 pr-3 text-right font-medium">Weight</th>
                  <th className="py-2 text-right font-medium">Rebate %</th>
                </tr>
              </thead>
              <tbody>
                {bundle.members.map((m) => {
                  const name =
                    m.contract?.name ?? m.vendorId ?? "(unnamed member)"
                  const vendorName =
                    m.contract?.vendor?.name ?? m.vendorId ?? "—"
                  return (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{name}</td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {vendorName}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {m.minimumSpend != null
                          ? fmt(Number(m.minimumSpend))
                          : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {Number(m.weightPercent).toFixed(0)}%
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {m.rebateContribution != null
                          ? `${Number(m.rebateContribution).toFixed(2)}%`
                          : "—"}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Per-member status for all-or-nothing */}
      {status?.allOrNothing?.shortfalls &&
        status.allOrNothing.shortfalls.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Non-compliant members</CardTitle>
              <CardDescription>
                Bundle is non-compliant overall until every member meets
                their minimum.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm">
                {status.allOrNothing.shortfalls.map((s) => (
                  <li key={s.index}>
                    <Badge variant="destructive" className="mr-2">
                      {fmt(s.shortfall)} short
                    </Badge>
                    member {s.index + 1}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

      {/* Impact analysis — all-or-nothing only (proportional + cross-
          vendor have different formulas and benefit less from a spend-
          reallocation sandbox). */}
      {bundle.complianceMode === "all_or_nothing" &&
        bundle.baseRate != null &&
        bundle.members.length > 0 && (
          <BundleImpactAnalysisCard
            members={bundle.members.map((m) => ({
              label: m.contract?.name ?? m.vendorId ?? "Member",
              minimumSpend: Number(m.minimumSpend ?? 0),
            }))}
            bundle={{
              baseRate: Number(bundle.baseRate),
              bonusRate:
                bundle.bonusRate != null
                  ? Number(bundle.bonusRate)
                  : undefined,
              acceleratorMultiplier:
                bundle.acceleratorMultiplier != null
                  ? Number(bundle.acceleratorMultiplier)
                  : bundle.bonusMultiplier != null
                    ? Number(bundle.bonusMultiplier)
                    : undefined,
            }}
          />
        )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  )
}
