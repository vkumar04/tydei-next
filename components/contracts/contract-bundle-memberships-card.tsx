"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Layers } from "lucide-react"
import { getBundleMembershipsForContract } from "@/lib/actions/bundles"

/**
 * Bundle-memberships card for the contract detail page. Shows every
 * TieInBundle this contract belongs to (as primary or member), with
 * a quick link to the bundle detail page. Renders nothing when the
 * contract isn't in any bundle.
 *
 * Distinct from ContractTieInCard (which handles legacy capital
 * tie-in — the consumable→capital paydown model).
 */
export function ContractBundleMembershipsCard({
  contractId,
}: {
  contractId: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["bundle-memberships", contractId],
    queryFn: () => getBundleMembershipsForContract(contractId),
  })

  if (isLoading || !data) return null
  if (data.length === 0) return null
  const matches = data

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4" /> Tie-in bundles
        </CardTitle>
        <CardDescription>
          Bundles this contract participates in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {matches.map((b) => (
          <div
            key={b.id}
            className="flex items-center justify-between rounded-md border p-3"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {b.primaryContract.name}
                </span>
                <Badge variant="outline" className="text-xs">
                  {b.complianceMode}
                </Badge>
                <Badge
                  variant={b.role === "primary" ? "default" : "secondary"}
                  className="text-xs"
                >
                  {b.role === "primary" ? "primary" : "member"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {b._count.members} member
                {b._count.members === 1 ? "" : "s"}
                {b.baseRate != null && (
                  <> · base {Number(b.baseRate).toFixed(1)}%</>
                )}
              </p>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/dashboard/contracts/bundles/${b.id}`}>
                View →
              </Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
