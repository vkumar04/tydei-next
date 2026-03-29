"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { Vendor } from "@prisma/client"
import { createVendorSchema, type CreateVendorInput } from "@/lib/validators/vendors"
import { useCreateVendor, useUpdateVendor } from "@/hooks/use-vendor-crud"
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

interface VendorFormDialogProps {
  vendor?: Vendor
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function VendorFormDialog({
  vendor,
  open,
  onOpenChange,
  onComplete,
}: VendorFormDialogProps) {
  const createMutation = useCreateVendor()
  const updateMutation = useUpdateVendor()
  const isEditing = !!vendor

  const form = useForm<CreateVendorInput>({
    resolver: zodResolver(createVendorSchema),
    defaultValues: {
      name: "",
      code: "",
      displayName: "",
      division: "",
      contactName: "",
      contactEmail: "",
      contactPhone: "",
      website: "",
      address: "",
      tier: "standard",
    },
  })

  useEffect(() => {
    if (vendor) {
      form.reset({
        name: vendor.name,
        code: vendor.code ?? "",
        displayName: vendor.displayName ?? "",
        division: vendor.division ?? "",
        contactName: vendor.contactName ?? "",
        contactEmail: vendor.contactEmail ?? "",
        contactPhone: vendor.contactPhone ?? "",
        website: vendor.website ?? "",
        address: vendor.address ?? "",
        tier: vendor.tier,
      })
    } else {
      form.reset()
    }
  }, [vendor, form])

  const onSubmit = async () => {
    const values = form.getValues()
    if (isEditing) {
      await updateMutation.mutateAsync({ id: vendor.id, data: values })
    } else {
      await createMutation.mutateAsync(values)
    }
    form.reset()
    onOpenChange(false)
    onComplete()
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Edit Vendor" : "Create Vendor"}
      onSubmit={form.handleSubmit(onSubmit)}
      isSubmitting={isPending}
      submitLabel={isEditing ? "Update" : "Create"}
    >
      <Field label="Name" error={form.formState.errors.name?.message} required>
        <Input {...form.register("name")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Code" error={form.formState.errors.code?.message}>
          <Input {...form.register("code")} />
        </Field>
        <Field label="Display Name">
          <Input {...form.register("displayName")} />
        </Field>
      </div>
      <Field label="Division">
        <Input {...form.register("division")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact Name">
          <Input {...form.register("contactName")} />
        </Field>
        <Field label="Contact Email" error={form.formState.errors.contactEmail?.message}>
          <Input type="email" {...form.register("contactEmail")} />
        </Field>
      </div>
      <Field label="Contact Phone">
        <Input {...form.register("contactPhone")} />
      </Field>
      <Field label="Website" error={form.formState.errors.website?.message}>
        <Input {...form.register("website")} />
      </Field>
      <Field label="Address">
        <Input {...form.register("address")} />
      </Field>
      <Field label="Tier">
        <Select
          value={form.watch("tier")}
          onValueChange={(v) => form.setValue("tier", v as "standard" | "premium")}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="premium">Premium</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </FormDialog>
  )
}
