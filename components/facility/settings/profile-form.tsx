"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  updateFacilityProfileSchema,
  type UpdateFacilityProfileInput,
} from "@/lib/validators/settings"
import type { FacilityProfile } from "@/lib/actions/settings"

interface ProfileFormProps {
  facility: FacilityProfile
  onSave: (data: UpdateFacilityProfileInput) => Promise<void>
  isPending: boolean
}

const FACILITY_TYPES = [
  { value: "hospital", label: "Hospital" },
  { value: "asc", label: "ASC" },
  { value: "clinic", label: "Clinic" },
  { value: "surgery_center", label: "Surgery Center" },
]

export function ProfileForm({ facility, onSave, isPending }: ProfileFormProps) {
  const form = useForm<UpdateFacilityProfileInput>({
    resolver: zodResolver(updateFacilityProfileSchema),
    defaultValues: {
      name: facility.name,
      type: facility.type as UpdateFacilityProfileInput["type"],
      address: facility.address ?? "",
      city: facility.city ?? "",
      state: facility.state ?? "",
      zip: facility.zip ?? "",
      beds: facility.beds ?? undefined,
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Facility Information</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Facility Name</Label>
              <Input id="name" {...form.register("name")} />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Facility Type</Label>
              <Select
                value={form.watch("type")}
                onValueChange={(v) => form.setValue("type", v as UpdateFacilityProfileInput["type"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FACILITY_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" {...form.register("address")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input id="city" {...form.register("city")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input id="state" {...form.register("state")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip">ZIP Code</Label>
              <Input id="zip" {...form.register("zip")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="beds">Number of Beds</Label>
              <Input
                id="beds"
                type="number"
                {...form.register("beds", { valueAsNumber: true })}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
