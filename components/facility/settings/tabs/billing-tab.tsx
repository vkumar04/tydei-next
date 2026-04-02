import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Crown,
  TrendingUp,
  Bot,
} from "lucide-react"

export function BillingTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing &amp; Membership</CardTitle>
        <CardDescription>Manage your subscription and payment methods</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="p-6 rounded-lg border-2 border-primary/20 bg-primary/5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Crown className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">Enterprise Plan</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Unlimited users, advanced analytics, and priority support
              </p>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold">$2,499</span>
                <span className="text-muted-foreground">/month</span>
              </div>
            </div>
            <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Active</Badge>
          </div>
          <Separator className="my-4" />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Next billing date: February 1, 2024</span>
            <Button variant="outline" size="sm">Manage Plan</Button>
          </div>
        </div>

        <div>
          <h3 className="font-medium mb-4">Payment Method</h3>
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-center gap-3">
              <div className="h-10 w-16 rounded bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
                <span className="text-white text-xs font-bold">VISA</span>
              </div>
              <div>
                <p className="font-medium">Visa ending in 4242</p>
                <p className="text-sm text-muted-foreground">Expires 12/2025</p>
              </div>
            </div>
            <Button variant="ghost" size="sm">Update</Button>
          </div>
        </div>

        <div>
          <h3 className="font-medium mb-4">Available Add-ons</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-4 rounded-lg border">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="font-medium">Predictive Forecasting</p>
                  <p className="text-sm text-muted-foreground">
                    AI-powered spend and rebate predictions on all charts and reports
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="font-semibold">+$200/mo</p>
                </div>
                <Button variant="outline" size="sm">Add</Button>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg border bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="font-medium">AI Contract Analysis</p>
                  <p className="text-sm text-muted-foreground">
                    Automated PDF parsing and contract recommendations
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Included</Badge>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
