"use client"

import { PageHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ProposalBuilder } from "@/components/vendor/prospective/proposal-builder"
import { useVendorProposals } from "@/hooks/use-prospective"

interface VendorProspectiveClientProps {
  vendorId: string
}

export function VendorProspectiveClient({ vendorId }: VendorProspectiveClientProps) {
  const { data: proposals, isLoading } = useVendorProposals(vendorId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prospective Proposals"
        description="Build and submit pricing proposals to facilities"
      />

      <ProposalBuilder vendorId={vendorId} facilities={[]} />

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Submitted Proposals</h3>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-md" />
            ))}
          </div>
        ) : proposals && proposals.length > 0 ? (
          proposals.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">
                    {p.itemCount} items &middot; ${p.totalProposedCost.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.facilityIds.length} facilities &middot;{" "}
                    {new Date(p.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant="secondary">{p.status}</Badge>
              </CardContent>
            </Card>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No proposals yet</p>
        )}
      </div>
    </div>
  )
}
