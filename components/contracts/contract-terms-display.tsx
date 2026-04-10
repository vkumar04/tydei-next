"use client"

import type { ContractTerm, ContractTier } from "@prisma/client"
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { DefinitionTooltip } from "@/components/shared/definition-tooltip"

type ContractTermWithTiers = ContractTerm & { tiers: ContractTier[] }

interface ContractTermsDisplayProps {
  terms: ContractTermWithTiers[]
  currentSpend?: number
}

function TierDisplay({ tier, currentSpend }: { tier: ContractTier; currentSpend?: number }) {
  const rebateLabel =
    tier.rebateType === "percent_of_spend"
      ? formatPercent(Number(tier.rebateValue))
      : formatCurrency(Number(tier.rebateValue), true)

  const spendMin = Number(tier.spendMin)
  const spendMax = tier.spendMax ? Number(tier.spendMax) : null
  const spend = currentSpend ?? 0

  let progress = 0
  if (spend >= spendMin && spendMax && spend < spendMax) {
    progress = ((spend - spendMin) / (spendMax - spendMin)) * 100
  } else if (spend >= spendMin && !spendMax) {
    progress = 100
  } else if (spendMax && spend >= spendMax) {
    progress = 100
  }

  return (
    <div className="flex items-center gap-4 rounded-md border p-3">
      <Badge variant="outline" className="shrink-0">
        Tier {tier.tierNumber}
      </Badge>
      <div className="flex-1 space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {formatCurrency(Number(tier.spendMin))}
            {tier.spendMax ? ` - ${formatCurrency(Number(tier.spendMax))}` : "+"}
          </span>
          <span className="font-medium">{rebateLabel}</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>
    </div>
  )
}

export function ContractTermsDisplay({ terms, currentSpend }: ContractTermsDisplayProps) {
  if (terms.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Terms & Tiers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No terms defined</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Terms & Tiers</CardTitle>
      </CardHeader>
      <CardContent>
        <Accordion
          type="multiple"
          defaultValue={terms.map((t) => t.id)}
        >
          {terms.map((term) => (
            <AccordionItem key={term.id} value={term.id}>
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{term.termName}</span>
                  <DefinitionTooltip term={term.termType}>
                    <Badge variant="secondary" className="capitalize">
                      {term.termType.replace(/_/g, " ")}
                    </Badge>
                  </DefinitionTooltip>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(term.effectiveStart)} -{" "}
                    {formatDate(term.effectiveEnd)}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 pt-2">
                  <div className="grid gap-2 text-sm sm:grid-cols-3">
                    <div>
                      <DefinitionTooltip term="baseline_type">
                        <span className="text-muted-foreground">Baseline</span>
                      </DefinitionTooltip>
                      <span className="text-muted-foreground">: </span>
                      <span className="capitalize">
                        {term.baselineType.replace("_", " ")}
                      </span>
                    </div>
                    {term.spendBaseline && (
                      <div>
                        <span className="text-muted-foreground">
                          Spend Baseline:{" "}
                        </span>
                        {formatCurrency(Number(term.spendBaseline))}
                      </div>
                    )}
                    <div>
                      <DefinitionTooltip term="evaluation_period">
                        <span className="text-muted-foreground">Evaluation</span>
                      </DefinitionTooltip>
                      <span className="text-muted-foreground">: </span>
                      <span className="capitalize">
                        {term.evaluationPeriod}
                      </span>
                    </div>
                  </div>
                  {term.tiers.length > 0 && (
                    <div className="space-y-2">
                      {term.tiers.map((tier) => (
                        <TierDisplay key={tier.id} tier={tier} currentSpend={currentSpend} />
                      ))}
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  )
}
