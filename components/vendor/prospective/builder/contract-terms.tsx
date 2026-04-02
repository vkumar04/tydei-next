import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Plus,
  Trash2,
  Calculator,
  TrendingUp,
  DollarSign,
  PieChart as PieChartIcon,
  Percent,
  HelpCircle,
} from "lucide-react"
import type { NewProposalState, ProspectiveTerm } from "./types"
import { formatCurrencyShort } from "./types"

const TERM_TYPES = [
  { value: "spend_rebate", label: "Spend Rebate", description: "Rebate calculated based on total dollar spend thresholds. Higher spend = higher rebate tier.", icon: DollarSign },
  { value: "volume_rebate", label: "Volume Rebate", description: "Rebate based on unit/case volume purchased. Ideal for high-volume consumables.", icon: TrendingUp },
  { value: "market_share_rebate", label: "Market Share Rebate", description: "Rebate earned when facility purchases a target % of category from your products.", icon: PieChartIcon },
  { value: "price_reduction", label: "Price Reduction", description: "Once spend/volume threshold is met, future purchases receive discounted unit prices.", icon: Percent },
]

export interface ContractTermsProps {
  newProposal: NewProposalState
  addTerm: () => void
  removeTerm: (termId: string) => void
  updateTerm: (termId: string, updates: Partial<ProspectiveTerm>) => void
  estimatedRebate: number
}

export function ContractTerms({
  newProposal,
  addTerm,
  removeTerm,
  updateTerm,
  estimatedRebate,
}: ContractTermsProps) {
  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-4">
          <Label className="text-base font-semibold">Proposed Terms</Label>
          <Button variant="outline" size="sm" onClick={addTerm}>
            <Plus className="mr-2 h-4 w-4" />
            Add Term
          </Button>
        </div>

        {newProposal.terms.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
            <Calculator className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No terms added yet</p>
            <p className="text-sm">Add rebate or pricing terms to your proposal</p>
          </div>
        ) : (
          <div className="space-y-4">
            {newProposal.terms.map((term, index) => (
              <div key={term.id} className="p-4 border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">Term {index + 1}</Badge>
                  <Button variant="ghost" size="icon" onClick={() => removeTerm(term.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-xs flex items-center gap-1">
                      Term Type
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <HelpCircle className="h-3 w-3 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-xs">
                          <p className="font-medium mb-1">Contract Term Types</p>
                          <p className="text-xs">Choose how rebates are calculated. Each type uses different metrics (spend, volume, or market share) to determine rebate amounts.</p>
                        </TooltipContent>
                      </Tooltip>
                    </Label>
                    <Select
                      value={term.termType}
                      onValueChange={(v) => updateTerm(term.id, { termType: v as ProspectiveTerm["termType"] })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-[350px]">
                        {TERM_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value} className="py-2">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <t.icon className="h-3 w-3 shrink-0" />
                                <span className="font-medium">{t.label}</span>
                              </div>
                              <span className="text-xs text-muted-foreground pl-5">{t.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Target Value</Label>
                    <Input
                      type="number"
                      value={term.targetValue}
                      onChange={(e) => updateTerm(term.id, { targetValue: parseInt(e.target.value) || 0 })}
                      placeholder="Threshold"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Rebate %</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={term.rebatePercent}
                      onChange={(e) => updateTerm(term.id, { rebatePercent: parseFloat(e.target.value) || 0 })}
                      placeholder="e.g., 3.5"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Estimated Impact */}
      {newProposal.terms.length > 0 && (
        <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Estimated Annual Rebate</p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{formatCurrencyShort(estimatedRebate)}</p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
