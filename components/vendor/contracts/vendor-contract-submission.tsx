"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Loader2 } from "lucide-react"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field } from "@/components/shared/forms/field"
import { FileUpload } from "@/components/shared/file-upload"
import { getUploadUrl } from "@/lib/actions/uploads"
import { useCreatePendingContract } from "@/hooks/use-pending-contracts"
import {
  createPendingContractSchema,
  type CreatePendingContractInput,
} from "@/lib/validators/pending-contracts"

const CONTRACT_TYPES = [
  { value: "usage", label: "Usage" },
  { value: "capital", label: "Capital" },
  { value: "service", label: "Service" },
  { value: "tie_in", label: "Tie-In" },
  { value: "grouped", label: "Grouped" },
  { value: "pricing_only", label: "Pricing Only" },
]

interface FacilityOption {
  id: string
  name: string
}

interface VendorContractSubmissionProps {
  vendorId: string
  vendorName: string
  facilities: FacilityOption[]
}

export function VendorContractSubmission({ vendorId, vendorName, facilities }: VendorContractSubmissionProps) {
  const router = useRouter()
  const create = useCreatePendingContract()

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<CreatePendingContractInput>({
    resolver: zodResolver(createPendingContractSchema),
    defaultValues: {
      vendorId,
      vendorName,
      contractType: "usage",
      terms: [],
      documents: [],
    },
  })

  async function handleUpload(file: File) {
    const { uploadUrl, key } = await getUploadUrl({
      fileName: file.name,
      contentType: file.type,
      folder: "contracts",
    })
    await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } })
    const docs = watch("documents") as Array<{ name: string; url: string }>
    setValue("documents", [...(docs ?? []), { name: file.name, url: key }])
    return key
  }

  async function onSubmit(data: CreatePendingContractInput) {
    await create.mutateAsync(data)
    router.push("/vendor/contracts")
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Contract Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Contract Name" error={errors.contractName?.message} required>
            <Input {...register("contractName")} />
          </Field>
          <Field label="Contract Type" required>
            <Select
              value={watch("contractType")}
              onValueChange={(v) => setValue("contractType", v as CreatePendingContractInput["contractType"])}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONTRACT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Facility">
            <Select onValueChange={(v) => {
              setValue("facilityId", v)
              setValue("facilityName", facilities.find((f) => f.id === v)?.name)
            }}>
              <SelectTrigger><SelectValue placeholder="Select facility" /></SelectTrigger>
              <SelectContent>
                {facilities.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Total Value">
            <Input type="number" {...register("totalValue", { valueAsNumber: true })} />
          </Field>
          <Field label="Effective Date">
            <Input type="date" {...register("effectiveDate")} />
          </Field>
          <Field label="Expiration Date">
            <Input type="date" {...register("expirationDate")} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <Textarea {...register("notes")} rows={3} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <FileUpload
            onUpload={handleUpload}
            accept=".pdf,.doc,.docx,.xls,.xlsx"
            label="Upload contract document"
          />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" />}
          Submit for Review
        </Button>
      </div>
    </form>
  )
}
