import { requireAdmin } from "@/lib/actions/auth"
import { BillingClient } from "@/components/admin/billing-client"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft, Download } from "lucide-react"

export default async function AdminBillingPage() {
  await requireAdmin()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Billing & Invoices
            </h1>
            <p className="text-muted-foreground">
              Manage platform billing and subscription invoices
            </p>
          </div>
        </div>
        <Button className="gap-2">
          <Download className="h-4 w-4" />
          Export Report
        </Button>
      </div>
      <BillingClient />
    </div>
  )
}
