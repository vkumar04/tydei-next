"use client"

import { useState } from "react"
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
import type { AdminCreateFacilityInput } from "@/lib/validators/admin"

interface FacilityFormDialogProps {
  facility?: { id: string } & Partial<AdminCreateFacilityInput>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: AdminCreateFacilityInput) => Promise<void>
  isSubmitting: boolean
}

const facilityTypes = [
  { value: "hospital", label: "Hospital" },
  { value: "asc", label: "ASC" },
  { value: "clinic", label: "Clinic" },
  { value: "surgery_center", label: "Surgery Center" },
]

export function FacilityFormDialog({
  facility,
  open,
  onOpenChange,
  onSubmit,
  isSubmitting,
}: FacilityFormDialogProps) {
  const [name, setName] = useState(facility?.name ?? "")
  const [type, setType] = useState(facility?.type ?? "hospital")
  const [city, setCity] = useState(facility?.city ?? "")
  const [state, setState] = useState(facility?.state ?? "")
  const [address, setAddress] = useState(facility?.address ?? "")

  const handleSubmit = async () => {
    await onSubmit({
      name,
      type: type as AdminCreateFacilityInput["type"],
      city: city || undefined,
      state: state || undefined,
      address: address || undefined,
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={facility ? "Edit Facility" : "Create Facility"}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
    >
      <Field label="Name" required>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Type">
        <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {facilityTypes.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="City"><Input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        <Field label="State"><Input value={state} onChange={(e) => setState(e.target.value)} /></Field>
      </div>
      <Field label="Address"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
    </FormDialog>
  )
}
