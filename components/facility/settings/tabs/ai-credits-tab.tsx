import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Bot,
  Sparkles,
  TrendingUp,
  FileText,
} from "lucide-react"
import { AI_CREDIT_COSTS } from "@/lib/ai/config"
import type { AICredit, AIUsageRecord } from "@/lib/actions/ai-credits"

const AI_ACTION_LABELS: Record<string, string> = {
  document_extraction_per_page: "Document Extraction",
  contract_classification: "Contract Classification",
  full_contract_analysis: "Full Contract Analysis",
  ai_chat_question: "AI Chat Question",
  ai_contract_description: "Contract Description",
  ai_recommendation: "AI Recommendation",
  rebate_calculation: "Rebate Calculation",
  contract_comparison: "Contract Comparison",
  market_share_analysis: "Market Share Analysis",
  report_generation: "Report Generation",
  supply_matching: "Supply Matching",
}

export interface AICreditsTabProps {
  creditsData: AICredit | null | undefined
  usageData: AIUsageRecord[] | undefined
}

export function AICreditsTab({
  creditsData,
  usageData,
}: AICreditsTabProps) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Credits Used</CardDescription>
            <CardTitle className="text-3xl">
              {creditsData ? creditsData.usedCredits.toLocaleString() : "0"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {creditsData && (
              <div className="space-y-2">
                <Progress
                  value={creditsData.monthlyCredits > 0
                    ? Math.round((creditsData.usedCredits / (creditsData.monthlyCredits + creditsData.rolloverCredits)) * 100)
                    : 0}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  {creditsData.monthlyCredits > 0
                    ? `${Math.round((creditsData.usedCredits / (creditsData.monthlyCredits + creditsData.rolloverCredits)) * 100)}% of ${(creditsData.monthlyCredits + creditsData.rolloverCredits).toLocaleString()} total credits`
                    : "No credit limit configured"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Remaining Credits</CardDescription>
            <CardTitle className="text-3xl text-green-600 dark:text-green-400">
              {creditsData ? creditsData.remaining.toLocaleString() : "Unlimited"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {creditsData?.rolloverCredits
                ? `Includes ${creditsData.rolloverCredits.toLocaleString()} rollover credits`
                : "Resets at end of billing period"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Current Plan</CardDescription>
            <CardTitle className="text-xl flex items-center gap-2">
              Enterprise
              <Badge variant="secondary">Unlimited/mo</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" className="w-full">
              <TrendingUp className="h-4 w-4 mr-2" />
              Upgrade Plan
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Usage by Feature
          </CardTitle>
          <CardDescription>See which AI features are consuming the most credits</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead className="text-center">Credits/Use</TableHead>
                <TableHead className="text-right">Total Credits</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(AI_CREDIT_COSTS).map(([action, cost]) => (
                <TableRow key={action}>
                  <TableCell className="font-medium">{AI_ACTION_LABELS[action] ?? action}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{cost}</TableCell>
                  <TableCell className="text-right">-</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {usageData && usageData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Recent AI Activity
            </CardTitle>
            <CardDescription>Last 10 AI actions in your organization</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {usageData.slice(0, 10).map((record) => (
                <div key={record.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{record.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {record.userName} - {new Date(record.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline">{record.creditsUsed} credits</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Credit Costs Reference</CardTitle>
          <CardDescription>How many credits each AI feature uses</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(AI_CREDIT_COSTS).map(([action, cost]) => (
              <div key={action} className="flex items-center justify-between p-3 rounded-lg border">
                <span className="text-sm">{AI_ACTION_LABELS[action] ?? action}</span>
                <Badge variant="secondary">{cost} credits</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  )
}
