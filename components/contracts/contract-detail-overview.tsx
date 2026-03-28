import type { getContract } from "@/lib/actions/contracts"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { contractStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

type ContractDetail = Awaited<ReturnType<typeof getContract>>

interface ContractDetailOverviewProps {
  contract: ContractDetail
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

export function ContractDetailOverview({
  contract,
}: ContractDetailOverviewProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Contract Overview</span>
          <StatusBadge
            status={contract.status}
            config={contractStatusConfig}
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <InfoRow label="Contract Name" value={contract.name} />
        {contract.contractNumber && (
          <InfoRow label="Contract Number" value={contract.contractNumber} />
        )}
        <InfoRow label="Vendor" value={contract.vendor.name} />
        <InfoRow
          label="Type"
          value={
            <span className="capitalize">
              {contract.contractType.replace("_", " ")}
            </span>
          }
        />
        {contract.productCategory && (
          <InfoRow label="Category" value={contract.productCategory.name} />
        )}

        <Separator className="my-2" />

        <InfoRow
          label="Effective Date"
          value={formatDate(contract.effectiveDate)}
        />
        <InfoRow
          label="Expiration Date"
          value={formatDate(contract.expirationDate)}
        />
        <InfoRow
          label="Auto-Renewal"
          value={contract.autoRenewal ? "Yes" : "No"}
        />
        {contract.autoRenewal && (
          <InfoRow
            label="Termination Notice"
            value={`${contract.terminationNoticeDays} days`}
          />
        )}

        <Separator className="my-2" />

        <InfoRow
          label="Total Value"
          value={formatCurrency(Number(contract.totalValue))}
        />
        <InfoRow
          label="Annual Value"
          value={formatCurrency(Number(contract.annualValue))}
        />
        <InfoRow
          label="Performance Period"
          value={
            <span className="capitalize">
              {contract.performancePeriod.replace("_", " ")}
            </span>
          }
        />

        {contract.description && (
          <>
            <Separator className="my-2" />
            <div className="py-1.5">
              <p className="text-sm text-muted-foreground">Description</p>
              <p className="mt-1 text-sm">{contract.description}</p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
