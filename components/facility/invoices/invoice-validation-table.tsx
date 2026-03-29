"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DataTable } from "@/components/shared/tables/data-table"
import { getInvoiceColumns } from "./invoice-columns"
import { useInvoices } from "@/hooks/use-invoices"

interface InvoiceValidationTableProps {
  facilityId: string
}

const TABS = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Validated", value: "validated" },
  { label: "Flagged", value: "flagged" },
]

export function InvoiceValidationTable({ facilityId }: InvoiceValidationTableProps) {
  const router = useRouter()
  const [tab, setTab] = useState("all")

  const { data, isLoading } = useInvoices(facilityId, {
    facilityId,
    status: tab === "all" ? undefined : tab,
  })

  const columns = getInvoiceColumns(
    (id) => router.push(`/dashboard/invoice-validation/${id}`),
    (id) => router.push(`/dashboard/invoice-validation/${id}`)
  )

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        columns={columns}
        data={(data?.invoices ?? []) as never[]}
        searchKey="invoiceNumber"
        searchPlaceholder="Search invoices..."
        isLoading={isLoading}
      />
    </div>
  )
}
