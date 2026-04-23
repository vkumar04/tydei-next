import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Bot,
  Puzzle,
  BarChart3,
  Cpu,
  Zap,
} from "lucide-react"

export interface AddonsTabProps {
  addonsState: Record<string, boolean>
  onToggleAddon: (key: string) => void
}

export function AddonsTab({
  addonsState,
  onToggleAddon,
}: AddonsTabProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Puzzle className="h-5 w-5" />
                Add-ons Marketplace
              </CardTitle>
              <CardDescription>
                Extend your platform with powerful add-on modules
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs">
              {Object.values(addonsState).filter(Boolean).length} of{" "}
              {Object.keys(addonsState).length} active
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`flex items-center justify-between rounded-lg border p-5 transition-colors ${
              addonsState.predictive_forecasting ? "bg-muted/40" : ""
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <BarChart3 className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-base">Predictive Forecasting</p>
                  {addonsState.predictive_forecasting && (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs">
                      Active
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  AI-powered spend and rebate predictions on all charts and reports.
                  Forecast future contract performance and identify optimization opportunities.
                </p>
                <p className="mt-1 text-sm font-semibold">$200/mo</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4">
              <Button
                variant={addonsState.predictive_forecasting ? "outline" : "default"}
                size="sm"
                onClick={() => onToggleAddon("predictive_forecasting")}
              >
                {addonsState.predictive_forecasting ? "Disable" : "Enable"}
              </Button>
            </div>
          </div>

          <div
            className={`flex items-center justify-between rounded-lg border p-5 transition-colors ${
              addonsState.ai_contract_analysis ? "bg-muted/40" : ""
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Bot className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-base">AI Contract Analysis</p>
                  {addonsState.ai_contract_analysis && (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs">
                      Active
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Automated PDF parsing, clause extraction, and contract recommendations.
                  Compare terms across vendors and identify risks automatically.
                </p>
                <p className="mt-1 text-sm font-semibold">$200/mo</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4">
              <Button
                variant={addonsState.ai_contract_analysis ? "outline" : "default"}
                size="sm"
                onClick={() => onToggleAddon("ai_contract_analysis")}
              >
                {addonsState.ai_contract_analysis ? "Disable" : "Enable"}
              </Button>
            </div>
          </div>

          <div
            className={`flex items-center justify-between rounded-lg border p-5 transition-colors ${
              addonsState.cost_modeling ? "bg-muted/40" : ""
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Cpu className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-base">Cost Modeling</p>
                  {addonsState.cost_modeling && (
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 text-xs">
                      Active
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Build what-if cost models for contract negotiations.
                  Simulate pricing scenarios, volume commitments, and tier structures.
                </p>
                <p className="mt-1 text-sm font-semibold">$200/mo</p>
              </div>
            </div>
            <div className="flex-shrink-0 ml-4">
              <Button
                variant={addonsState.cost_modeling ? "outline" : "default"}
                size="sm"
                onClick={() => onToggleAddon("cost_modeling")}
              >
                {addonsState.cost_modeling ? "Disable" : "Enable"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add-on Billing Summary</CardTitle>
          <CardDescription>Monthly costs for active add-ons</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {addonsState.predictive_forecasting && (
              <div className="flex items-center justify-between text-sm">
                <span>Predictive Forecasting</span>
                <span className="font-medium">$200.00/mo</span>
              </div>
            )}
            {addonsState.ai_contract_analysis && (
              <div className="flex items-center justify-between text-sm">
                <span>AI Contract Analysis</span>
                <span className="font-medium">$200.00/mo</span>
              </div>
            )}
            {addonsState.cost_modeling && (
              <div className="flex items-center justify-between text-sm">
                <span>Cost Modeling</span>
                <span className="font-medium">$200.00/mo</span>
              </div>
            )}
            {!addonsState.predictive_forecasting &&
              !addonsState.ai_contract_analysis &&
              !addonsState.cost_modeling && (
                <p className="text-sm text-muted-foreground">No active add-ons</p>
              )}
            <Separator />
            <div className="flex items-center justify-between font-semibold">
              <span>Total Add-on Cost</span>
              <span>
                $
                {(
                  (addonsState.predictive_forecasting ? 200 : 0) +
                  (addonsState.ai_contract_analysis ? 200 : 0) +
                  (addonsState.cost_modeling ? 200 : 0)
                ).toFixed(2)}
                /mo
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Alert>
        <Zap className="h-4 w-4" />
        <AlertTitle>Add-on Management</AlertTitle>
        <AlertDescription>
          Add-ons are billed monthly and can be enabled or disabled at any
          time. Changes take effect immediately and billing is prorated.
        </AlertDescription>
      </Alert>
    </>
  )
}
