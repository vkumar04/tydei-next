import type { CreateContractInput } from "@/lib/validators/contracts"
import type { TermFormValues } from "@/lib/validators/contract-terms"
import { formatCurrency } from "@/lib/formatting"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

interface ContractFormReviewProps {
  values: CreateContractInput
  terms: TermFormValues[]
  vendors: { id: string; name: string; displayName: string | null }[]
  categories: { id: string; name: string }[]
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

export function ContractFormReview({
  values,
  terms,
  vendors,
  categories,
}: ContractFormReviewProps) {
  const vendor = vendors.find((v) => v.id === values.vendorId)
  const category = values.productCategoryId
    ? categories.find((c) => c.id === values.productCategoryId)
    : null

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Contract Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          <InfoRow label="Name" value={values.name} />
          {values.contractNumber && (
            <InfoRow label="Number" value={values.contractNumber} />
          )}
          <InfoRow label="Vendor" value={vendor?.displayName || vendor?.name || "—"} />
          {category && <InfoRow label="Category" value={category.name} />}
          <InfoRow
            label="Type"
            value={
              <span className="capitalize">
                {values.contractType.replace("_", " ")}
              </span>
            }
          />
          <InfoRow label="Effective Date" value={values.effectiveDate} />
          <InfoRow label="Expiration Date" value={values.expirationDate} />
          <InfoRow label="Total Value" value={formatCurrency(values.totalValue ?? 0)} />
          <InfoRow label="Annual Value" value={formatCurrency(values.annualValue ?? 0)} />
          <InfoRow label="Auto-Renewal" value={values.autoRenewal ? "Yes" : "No"} />
        </CardContent>
      </Card>

      {terms.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Terms ({terms.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {terms.map((term, i) => (
              <div key={i}>
                {i > 0 && <Separator className="mb-3" />}
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{term.termName || `Term ${i + 1}`}</span>
                    <Badge variant="secondary" className="capitalize text-xs">
                      {term.termType.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {term.effectiveStart} to {term.effectiveEnd}
                  </p>
                  {term.tiers.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {term.tiers.length} tier{term.tiers.length !== 1 ? "s" : ""}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
