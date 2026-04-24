import { HelpCircle } from "lucide-react"
import type { getContract } from "@/lib/actions/contracts"
import { formatCurrency, formatCalendarDate } from "@/lib/formatting"
import { contractStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { DefinitionTooltip } from "@/components/shared/definition-tooltip"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type ContractDetail = Awaited<ReturnType<typeof getContract>>

interface ContractDetailOverviewProps {
  contract: ContractDetail
}

function InfoRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
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
          <span className="inline-flex items-center gap-1.5">
            <StatusBadge
              status={contract.status}
              config={contractStatusConfig}
            />
            {contract.status === "pending" && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help items-center">
                      <HelpCircle
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-label="Pending status help"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[320px] p-3 text-xs">
                    <p>
                      A contract is Pending when it&apos;s been submitted for
                      review but not yet approved. Active contracts count
                      toward your rebate totals; Pending contracts do not.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </span>
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
          value={formatCalendarDate(contract.effectiveDate)}
        />
        <InfoRow
          label="Expiration Date"
          value={formatCalendarDate(contract.expirationDate)}
        />
        <InfoRow
          label={
            <DefinitionTooltip term="auto_renewal">Auto-Renewal</DefinitionTooltip>
          }
          value={contract.autoRenewal ? "Yes" : "No"}
        />
        {contract.autoRenewal && (
          <InfoRow
            label={
              <DefinitionTooltip term="termination_notice">Termination Notice</DefinitionTooltip>
            }
            value={`${contract.terminationNoticeDays} days`}
          />
        )}

        <Separator className="my-2" />

        <InfoRow
          label={
            <DefinitionTooltip term="total_value">Total Value</DefinitionTooltip>
          }
          value={formatCurrency(Number(contract.totalValue))}
        />
        <InfoRow
          label={
            <DefinitionTooltip term="annual_value">Annual Value</DefinitionTooltip>
          }
          value={formatCurrency(Number(contract.annualValue))}
        />
        <InfoRow
          label={
            <DefinitionTooltip term="performance_period">Performance Period</DefinitionTooltip>
          }
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
