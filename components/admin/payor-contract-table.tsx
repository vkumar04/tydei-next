"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, FileText, CheckCircle, DollarSign, Building2, Eye, Pencil, Trash2 } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/shared/tables/data-table"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { FormDialog } from "@/components/shared/forms/form-dialog"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TableActionMenu } from "@/components/shared/tables/table-action-menu"
import {
  getPayorContracts,
  createPayorContract,
  deletePayorContract,
} from "@/lib/actions/admin/payor-contracts"
import { queryKeys } from "@/lib/query-keys"
import { formatDate } from "@/lib/formatting"

interface PayorContractRow {
  id: string
  payorName: string
  payorType: string
  contractNumber: string
  facilityName: string
  effectiveDate: string
  expirationDate: string
  status: string
  cptRates: unknown[]
  grouperRates: unknown[]
}

export function PayorContractTable() {
  const qc = useQueryClient()
  const [formOpen, setFormOpen] = useState(false)
  const [deleting, setDeleting] = useState<PayorContractRow | null>(null)
  const [formData, setFormData] = useState<Record<string, string>>({})

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.payorContracts(),
    queryFn: () => getPayorContracts({}),
  })

  const createMut = useMutation({
    mutationFn: createPayorContract,
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.payorContracts() }); setFormOpen(false); toast.success("Payor contract created") },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePayorContract(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: queryKeys.admin.payorContracts() }); setDeleting(null); toast.success("Payor contract deleted") },
  })

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">Active</Badge>
      case "expired":
        return <Badge variant="destructive">Expired</Badge>
      case "pending":
        return <Badge variant="secondary">Pending</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const columns: ColumnDef<PayorContractRow>[] = [
    { accessorKey: "payorName", header: "Payor", cell: ({ row }) => <span className="font-medium">{row.original.payorName}</span> },
    { accessorKey: "facilityName", header: "Facility" },
    { accessorKey: "contractNumber", header: "Contract #", cell: ({ row }) => <span className="font-mono text-sm">{row.original.contractNumber}</span> },
    { accessorKey: "effectiveDate", header: "Effective", cell: ({ row }) => formatDate(row.original.effectiveDate) },
    { accessorKey: "expirationDate", header: "Expires", cell: ({ row }) => formatDate(row.original.expirationDate) },
    {
      id: "cptRates",
      header: "CPT Rates",
      cell: ({ row }) => (
        <Badge variant="outline">{(row.original.cptRates ?? []).length} rates</Badge>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => getStatusBadge(row.original.status),
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <TableActionMenu
          actions={[
            { label: "View Rates", icon: Eye, onClick: () => {} },
            { label: "Edit", icon: Pencil, onClick: () => {} },
            { label: "Delete", icon: Trash2, onClick: () => setDeleting(row.original), variant: "destructive" },
          ]}
        />
      ),
    },
  ]

  const handleSubmit = async () => {
    await createMut.mutateAsync({
      payorName: formData.payorName ?? "",
      payorType: (formData.payorType ?? "commercial") as "commercial" | "medicare_advantage" | "medicaid_managed" | "workers_comp",
      facilityId: formData.facilityId ?? "",
      contractNumber: formData.contractNumber ?? "",
      effectiveDate: formData.effectiveDate ?? "",
      expirationDate: formData.expirationDate ?? "",
      status: "active",
      cptRates: [],
      grouperRates: [],
      implantPassthrough: true,
      implantMarkup: 0,
    })
  }

  const contracts = (data?.contracts ?? []) as unknown as PayorContractRow[]
  const activeContracts = contracts.filter((c) => c.status === "active")
  const totalCptRates = contracts.reduce((sum, c) => sum + (c.cptRates ?? []).length, 0)
  const uniquePayors = new Set(contracts.map((c) => c.payorName)).size

  return (
    <>
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Contracts</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{contracts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Contracts</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeContracts.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total CPT Rates</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCptRates}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Payors Covered</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uniquePayors}</div>
          </CardContent>
        </Card>
      </div>

      <DataTable
        columns={columns}
        data={contracts}
        searchKey="payorName"
        searchPlaceholder="Search payor contracts..."
        isLoading={isLoading}
        filterComponent={
          <Button size="sm" className="gap-2" onClick={() => { setFormData({}); setFormOpen(true) }}>
            <Plus className="size-4" /> Add Contract
          </Button>
        }
      />
      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title="Upload Payor Contract"
        description="Add a payor contract with reimbursement rates for case costing."
        onSubmit={handleSubmit}
        isSubmitting={createMut.isPending}
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Payor Name" required>
            <Select value={formData.payorName ?? ""} onValueChange={(v) => setFormData({ ...formData, payorName: v })}>
              <SelectTrigger><SelectValue placeholder="Select payor..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Anthem Blue Cross Blue Shield">Anthem BCBS</SelectItem>
                <SelectItem value="United Healthcare">United Healthcare</SelectItem>
                <SelectItem value="Cigna">Cigna</SelectItem>
                <SelectItem value="Aetna">Aetna</SelectItem>
                <SelectItem value="Humana">Humana</SelectItem>
                <SelectItem value="Blue Cross Blue Shield">Blue Cross Blue Shield</SelectItem>
                <SelectItem value="Medicare Advantage">Medicare Advantage</SelectItem>
                <SelectItem value="Medicaid Managed Care">Medicaid Managed Care</SelectItem>
                <SelectItem value="Workers Compensation">Workers Compensation</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Contract Type">
            <Select value={formData.payorType ?? "commercial"} onValueChange={(v) => setFormData({ ...formData, payorType: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="commercial">Commercial</SelectItem>
                <SelectItem value="medicare_advantage">Medicare Advantage</SelectItem>
                <SelectItem value="medicaid_managed">Medicaid Managed</SelectItem>
                <SelectItem value="workers_comp">Workers Comp</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Contract Number" required>
          <Input value={formData.contractNumber ?? ""} onChange={(e) => setFormData({ ...formData, contractNumber: e.target.value })} placeholder="e.g., ASC-2024-001" />
        </Field>
        <Field label="Facility ID" required>
          <Input value={formData.facilityId ?? ""} onChange={(e) => setFormData({ ...formData, facilityId: e.target.value })} placeholder="Select facility..." />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Effective Date" required>
            <Input type="date" value={formData.effectiveDate ?? ""} onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })} />
          </Field>
          <Field label="Expiration Date" required>
            <Input type="date" value={formData.expirationDate ?? ""} onChange={(e) => setFormData({ ...formData, expirationDate: e.target.value })} />
          </Field>
        </div>
      </FormDialog>
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={() => setDeleting(null)}
        title="Delete Payor Contract"
        description={`Delete payor contract "${deleting?.payorName}"?`}
        onConfirm={async () => { if (deleting) await deleteMut.mutateAsync(deleting.id) }}
        isLoading={deleteMut.isPending}
        variant="destructive"
      />
    </>
  )
}
