import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Crown, Pencil } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const INVOICES = [
  { date: "Jan 1, 2024", description: "Enterprise Plan - Monthly", amount: "$2,499.00" },
  { date: "Dec 1, 2023", description: "Enterprise Plan - Monthly", amount: "$2,499.00" },
  { date: "Nov 1, 2023", description: "Enterprise Plan - Monthly", amount: "$2,499.00" },
]

export function BillingTab() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Current Plan</CardTitle>
          <CardDescription>Manage your subscription and billing</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border-2 border-primary/20 bg-primary/5 p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Crown className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Enterprise Plan</h3>
                </div>
                <p className="mb-4 text-sm text-muted-foreground">Unlimited AI credits</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold">Custom</span>
                  <span className="text-muted-foreground">pricing</span>
                </div>
              </div>
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Active</Badge>
            </div>
            <Separator className="my-4" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Next billing date: February 1, 2024</span>
              <Button variant="outline" size="sm">
                Manage Plan
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment Method</CardTitle>
          <CardDescription>Manage your payment information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-16 items-center justify-center rounded border bg-muted">
                <span className="text-xs font-bold tracking-wide text-foreground">VISA</span>
              </div>
              <div>
                <p className="font-medium">Visa ending in 4242</p>
                <p className="text-sm text-muted-foreground">Expires 12/2025</p>
              </div>
            </div>
            <Button variant="ghost" size="sm">
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" className="w-full">
            Add Payment Method
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
          <CardDescription>View and download past invoices</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {INVOICES.map((invoice) => (
                <TableRow key={invoice.date}>
                  <TableCell>{invoice.date}</TableCell>
                  <TableCell>{invoice.description}</TableCell>
                  <TableCell>{invoice.amount}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-primary/40 text-primary">
                      Paid
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm">
                      Download
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
