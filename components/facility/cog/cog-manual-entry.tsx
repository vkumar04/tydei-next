"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { cogRecordInputSchema, type COGRecordInput } from "@/lib/validators/cog-records"
import { useCreateCOGRecord } from "@/hooks/use-cog"
import { FormDialog } from "@/components/shared/forms/form-dialog"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

interface COGManualEntryProps {
  facilityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function COGManualEntry({
  facilityId,
  open,
  onOpenChange,
  onComplete,
}: COGManualEntryProps) {
  const createMutation = useCreateCOGRecord()
  const form = useForm<COGRecordInput>({
    resolver: zodResolver(cogRecordInputSchema),
    defaultValues: {
      inventoryNumber: "",
      inventoryDescription: "",
      unitCost: 0,
      quantity: 1,
      transactionDate: new Date().toISOString().slice(0, 10),
    },
  })

  const onSubmit = async () => {
    const values = form.getValues()
    await createMutation.mutateAsync({ ...values, facilityId })
    form.reset()
    onOpenChange(false)
    onComplete()
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add COG Record"
      description="Manually create a single COG record"
      onSubmit={form.handleSubmit(onSubmit)}
      isSubmitting={createMutation.isPending}
      submitLabel="Create"
    >
      <Field label="Inventory Number" error={form.formState.errors.inventoryNumber?.message} required>
        <Input {...form.register("inventoryNumber")} />
      </Field>
      <Field label="Description" error={form.formState.errors.inventoryDescription?.message} required>
        <Input {...form.register("inventoryDescription")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Unit Cost" error={form.formState.errors.unitCost?.message} required>
          <Input type="number" step="0.01" {...form.register("unitCost", { valueAsNumber: true })} />
        </Field>
        <Field label="Quantity" error={form.formState.errors.quantity?.message}>
          <Input type="number" {...form.register("quantity", { valueAsNumber: true })} />
        </Field>
      </div>
      <Field label="Transaction Date" error={form.formState.errors.transactionDate?.message} required>
        <Input type="date" {...form.register("transactionDate")} />
      </Field>
      <Field label="Vendor Name">
        <Input {...form.register("vendorName")} />
      </Field>
      <Field label="Vendor Item No">
        <Input {...form.register("vendorItemNo")} />
      </Field>
      <Field label="Notes" error={form.formState.errors.notes?.message}>
        <Textarea rows={3} {...form.register("notes")} />
      </Field>
    </FormDialog>
  )
}
