"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  updateVendorProfileSchema,
  type UpdateVendorProfileInput,
} from "@/lib/validators/settings"
import type { VendorProfile } from "@/lib/actions/settings"

interface VendorProfileFormProps {
  vendor: VendorProfile
  onSave: (data: UpdateVendorProfileInput) => Promise<void>
  isPending: boolean
}

export function VendorProfileForm({ vendor, onSave, isPending }: VendorProfileFormProps) {
  const form = useForm<UpdateVendorProfileInput>({
    resolver: zodResolver(updateVendorProfileSchema),
    defaultValues: {
      name: vendor.name,
      displayName: vendor.displayName ?? "",
      logoUrl: vendor.logoUrl ?? "",
      contactName: vendor.contactName ?? "",
      contactEmail: vendor.contactEmail ?? "",
      contactPhone: vendor.contactPhone ?? "",
      website: vendor.website ?? "",
      address: vendor.address ?? "",
      division: vendor.division ?? "",
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Company Information</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="v-name">Company Name</Label>
              <Input id="v-name" {...form.register("name")} />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-display">Display Name</Label>
              <Input id="v-display" {...form.register("displayName")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-logo">Logo URL</Label>
              <Input id="v-logo" {...form.register("logoUrl")} placeholder="https://..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-contact">Contact Name</Label>
              <Input id="v-contact" {...form.register("contactName")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-email">Contact Email</Label>
              <Input id="v-email" type="email" {...form.register("contactEmail")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-phone">Contact Phone</Label>
              <Input id="v-phone" {...form.register("contactPhone")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-website">Website</Label>
              <Input id="v-website" {...form.register("website")} placeholder="https://..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="v-division">Division</Label>
              <Input id="v-division" {...form.register("division")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="v-address">Address</Label>
            <Textarea id="v-address" {...form.register("address")} rows={2} />
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
