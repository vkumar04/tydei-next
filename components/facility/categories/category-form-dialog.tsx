"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import type { ProductCategory } from "@prisma/client"
import { useCreateCategory, useUpdateCategory } from "@/hooks/use-categories"
import { FormDialog } from "@/components/shared/forms/form-dialog"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

const categorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
})

type CategoryFormValues = z.infer<typeof categorySchema>

interface CategoryFormDialogProps {
  category?: ProductCategory
  parentId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function CategoryFormDialog({
  category,
  parentId,
  open,
  onOpenChange,
  onComplete,
}: CategoryFormDialogProps) {
  const createMutation = useCreateCategory()
  const updateMutation = useUpdateCategory()
  const isEditing = !!category

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: "", description: "" },
  })

  useEffect(() => {
    if (category) {
      form.reset({
        name: category.name,
        description: category.description ?? "",
      })
    } else {
      form.reset({ name: "", description: "" })
    }
  }, [category, form])

  const onSubmit = async () => {
    const values = form.getValues()
    if (isEditing) {
      await updateMutation.mutateAsync({ id: category.id, data: values })
    } else {
      await createMutation.mutateAsync({ ...values, parentId })
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
      title={isEditing ? "Edit Category" : "Create Category"}
      onSubmit={form.handleSubmit(onSubmit)}
      isSubmitting={isPending}
      submitLabel={isEditing ? "Update" : "Create"}
    >
      <Field label="Name" error={form.formState.errors.name?.message} required>
        <Input {...form.register("name")} />
      </Field>
      <Field label="Description">
        <Textarea {...form.register("description")} rows={3} />
      </Field>
    </FormDialog>
  )
}
