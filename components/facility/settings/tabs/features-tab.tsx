import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  ShoppingCart,
  Bot,
  Sparkles,
  Stethoscope,
  UserCog,
  AlertTriangle,
  Truck,
} from "lucide-react"
import type { FeatureFlagData } from "@/lib/actions/settings"

export interface FeaturesTabProps {
  flagsData: FeatureFlagData | undefined
  flagsIsLoading: boolean
  onUpdateFlags: (flags: Partial<FeatureFlagData>, message: string) => void
}

export function FeaturesTab({
  flagsData,
  flagsIsLoading,
  onUpdateFlags,
}: FeaturesTabProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Feature Settings</CardTitle>
          <CardDescription>
            Enable or disable optional features in the application
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {flagsIsLoading ? (
            <Skeleton className="h-[300px] rounded-xl" />
          ) : flagsData ? (
            <>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <ShoppingCart className="h-5 w-5 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-base font-medium">
                      Purchase Orders
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Enable PO matching and tracking functionality. When
                      enabled, Purchase Orders will appear in the navigation
                      menu.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={flagsData.purchaseOrdersEnabled}
                  onCheckedChange={(checked) => {
                    onUpdateFlags(
                      { purchaseOrdersEnabled: checked },
                      checked
                        ? "Purchase Orders enabled"
                        : "Purchase Orders disabled"
                    )
                  }}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                    <Bot className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-base font-medium">
                      AI Agent
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Enable the AI-powered assistant for contract analysis,
                      recommendations, and insights.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={flagsData.aiAgentEnabled}
                  onCheckedChange={(checked) => {
                    onUpdateFlags(
                      { aiAgentEnabled: checked },
                      checked ? "AI Agent enabled" : "AI Agent disabled"
                    )
                  }}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                    <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-base font-medium">
                      Advanced Reports
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Enable advanced reporting features including custom
                      report builder and scheduled reports.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={flagsData.advancedReportsEnabled}
                  onCheckedChange={(checked) => {
                    onUpdateFlags(
                      { advancedReportsEnabled: checked },
                      checked
                        ? "Advanced Reports enabled"
                        : "Advanced Reports disabled"
                    )
                  }}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                    <Truck className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-base font-medium">
                      Vendor Portal
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Allow vendors to access their dedicated portal for
                      contract submissions and performance tracking.
                    </p>
                  </div>
                </div>
                <Switch
                  checked={flagsData.vendorPortalEnabled}
                  onCheckedChange={(checked) => {
                    onUpdateFlags(
                      { vendorPortalEnabled: checked },
                      checked
                        ? "Vendor Portal enabled"
                        : "Vendor Portal disabled"
                    )
                  }}
                />
              </div>

              <div className="pt-4 border-t">
                <div className="flex items-center gap-2 mb-4">
                  <Badge
                    variant="secondary"
                    className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                  >
                    Premium Add-Ons
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    Additional modules available for purchase
                  </p>
                </div>

                <div className="flex items-center justify-between rounded-lg border p-4 mb-4 bg-gradient-to-r from-teal-50/50 to-cyan-50/50 dark:from-teal-950/20 dark:to-cyan-950/20 border-teal-200 dark:border-teal-800">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
                      <Stethoscope className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label className="text-base font-medium">
                          Case Costing
                        </Label>
                        <Badge
                          variant="outline"
                          className="text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700"
                        >
                          Paid Add-On
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Track procedure-level costs, link purchasing data to
                        clinical cases, and analyze margin performance.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={flagsData.caseCostingEnabled}
                    onCheckedChange={(checked) => {
                      onUpdateFlags(
                        { caseCostingEnabled: checked },
                        checked
                          ? "Case Costing enabled"
                          : "Case Costing disabled"
                      )
                    }}
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border p-4 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 dark:border-blue-800">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                      <UserCog className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label className="text-base font-medium">
                          Surgeon Scorecard
                        </Label>
                        <Badge
                          variant="outline"
                          className="text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700"
                        >
                          Paid Add-On
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Compare surgeon performance, supply utilization, and
                        cost efficiency with detailed scorecards.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Note</AlertTitle>
        <AlertDescription>
          Changes to feature settings take effect immediately. Disabled
          features will be hidden from the navigation menu but data will be
          preserved.
        </AlertDescription>
      </Alert>
    </>
  )
}
