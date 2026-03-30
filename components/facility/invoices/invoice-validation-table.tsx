"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/shared/tables/data-table"
import { getInvoiceColumns, type InvoiceRow } from "./invoice-columns"
import { useInvoices } from "@/hooks/use-invoices"

interface Vendor {
  id: string
  name: string
}

interface InvoiceValidationTableProps {
  facilityId: string
  vendors: Vendor[]
}

const TABS = [
  { label: "All", value: "all" },
  { label: "Overcharged", value: "overcharged" },
  { label: "Undercharged", value: "undercharged" },
  { label: "Validated", value: "validated" },
] as const

export function InvoiceValidationTable({ facilityId, vendors }: InvoiceValidationTableProps) {
  const router = useRouter()
  const [tab, setTab] = useState("all")
  const [vendorFilter, setVendorFilter] = useState("all")

  const { data, isLoading } = useInvoices(facilityId, {
    facilityId,
    status: tab === "all" || tab === "overcharged" || tab === "undercharged" ? undefined : tab,
    vendorId: vendorFilter === "all" ? undefined : vendorFilter,
  })

  // Client-side filtering for overcharged/undercharged (variance-based)
  const invoices = (data?.invoices ?? []) as InvoiceRow[]
  const filteredInvoices =
    tab === "overcharged"
      ? invoices.filter((inv) => inv.variance > 0.01)
      : tab === "undercharged"
        ? invoices.filter((inv) => inv.variance < -0.01)
        : invoices

  const columns = getInvoiceColumns((id) =>
    router.push(`/dashboard/invoice-validation/${id}`)
  )

  const filterComponent = (
    <Select value={vendorFilter} onValueChange={setVendorFilter}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="All Vendors" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Vendors</SelectItem>
        {vendors.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            {v.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoice Discrepancies</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              {TABS.map((t) => (
                <TabsTrigger key={t.value} value={t.value}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <DataTable
            columns={columns}
            data={filteredInvoices as never[]}
            searchKey="invoiceNumber"
            searchPlaceholder="Search invoices..."
            filterComponent={filterComponent}
            isLoading={isLoading}
            onRowClick={(row) => {
              const r = row as InvoiceRow
              router.push(`/dashboard/invoice-validation/${r.id}`)
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}
