"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import type { ColumnDef } from "@tanstack/react-table"
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
import { Pencil, Trash2 } from "lucide-react"
import {
  getPayorContracts,
  createPayorContract,
  updatePayorContract,
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

  const columns: ColumnDef<PayorContractRow>[] = [
    { accessorKey: "payorName", header: "Payor" },
    { accessorKey: "payorType", header: "Type", cell: ({ row }) => <span className="capitalize">{row.original.payorType.replace("_", " ")}</span> },
    { accessorKey: "contractNumber", header: "Contract #" },
    { accessorKey: "facilityName", header: "Facility" },
    { accessorKey: "effectiveDate", header: "Effective", cell: ({ row }) => formatDate(row.original.effectiveDate) },
    { accessorKey: "expirationDate", header: "Expiration", cell: ({ row }) => formatDate(row.original.expirationDate) },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <Badge variant={row.original.status === "active" ? "default" : "secondary"}>{row.original.status}</Badge>,
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <TableActionMenu
          actions={[
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

  return (
    <>
      <DataTable
        columns={columns}
        data={(data?.contracts ?? []) as unknown as PayorContractRow[]}
        searchKey="payorName"
        searchPlaceholder="Search payor contracts..."
        isLoading={isLoading}
        filterComponent={
          <Button size="sm" onClick={() => { setFormData({}); setFormOpen(true) }}>
            <Plus className="size-4" /> Add Payor Contract
          </Button>
        }
      />
      <FormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        title="Create Payor Contract"
        onSubmit={handleSubmit}
        isSubmitting={createMut.isPending}
      >
        <Field label="Payor Name" required>
          <Input value={formData.payorName ?? ""} onChange={(e) => setFormData({ ...formData, payorName: e.target.value })} />
        </Field>
        <Field label="Type">
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
        <Field label="Contract Number" required>
          <Input value={formData.contractNumber ?? ""} onChange={(e) => setFormData({ ...formData, contractNumber: e.target.value })} />
        </Field>
        <Field label="Facility ID" required>
          <Input value={formData.facilityId ?? ""} onChange={(e) => setFormData({ ...formData, facilityId: e.target.value })} />
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
