"use client"

import type { UseFormReturn } from "react-hook-form"
import type { CreateContractInput } from "@/lib/validators/contracts"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"

interface VendorOption {
  id: string
  name: string
  displayName: string | null
}

interface CategoryOption {
  id: string
  name: string
}

interface ContractFormProps {
  form: UseFormReturn<CreateContractInput>
  vendors: VendorOption[]
  categories: CategoryOption[]
}

const contractTypes = [
  { value: "usage", label: "Usage" },
  { value: "capital", label: "Capital" },
  { value: "service", label: "Service" },
  { value: "tie_in", label: "Tie-In" },
  { value: "grouped", label: "Grouped" },
  { value: "pricing_only", label: "Pricing Only" },
] as const

const performancePeriods = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semi_annual", label: "Semi-Annual" },
  { value: "annual", label: "Annual" },
] as const

export function ContractFormBasicInfo({
  form,
  vendors,
  categories,
}: ContractFormProps) {
  const {
    register,
    setValue,
    watch,
    formState: { errors },
  } = form

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contract Name" error={errors.name?.message} required>
          <Input {...register("name")} placeholder="e.g., Medtronic Spine Implants" />
        </Field>

        <Field label="Contract Number" error={errors.contractNumber?.message}>
          <Input {...register("contractNumber")} placeholder="e.g., CTR-2025-001" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Vendor" error={errors.vendorId?.message} required>
          <Select value={watch("vendorId")} onValueChange={(v) => setValue("vendorId", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select vendor" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.displayName || v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Category" error={errors.productCategoryId?.message}>
          <Select
            value={watch("productCategoryId") ?? ""}
            onValueChange={(v) => setValue("productCategoryId", v || undefined)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contract Type" error={errors.contractType?.message} required>
          <Select value={watch("contractType")} onValueChange={(v) => setValue("contractType", v as CreateContractInput["contractType"])}>
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              {contractTypes.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="GPO Affiliation" error={errors.gpoAffiliation?.message}>
          <Input {...register("gpoAffiliation")} placeholder="e.g., Vizient, Premier" />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Effective Date" error={errors.effectiveDate?.message} required>
          <Input type="date" {...register("effectiveDate")} />
        </Field>

        <Field label="Expiration Date" error={errors.expirationDate?.message} required>
          <Input type="date" {...register("expirationDate")} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Total Value ($)" error={errors.totalValue?.message}>
          <Input
            type="number"
            step="0.01"
            {...register("totalValue", { valueAsNumber: true })}
            placeholder="0"
          />
        </Field>

        <Field label="Annual Value ($)" error={errors.annualValue?.message}>
          <Input
            type="number"
            step="0.01"
            {...register("annualValue", { valueAsNumber: true })}
            placeholder="0"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Performance Period">
          <Select
            value={watch("performancePeriod") ?? "monthly"}
            onValueChange={(v) => setValue("performancePeriod", v as CreateContractInput["performancePeriod"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {performancePeriods.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Rebate Pay Period">
          <Select
            value={watch("rebatePayPeriod") ?? "quarterly"}
            onValueChange={(v) => setValue("rebatePayPeriod", v as CreateContractInput["rebatePayPeriod"])}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {performancePeriods.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Description" error={errors.description?.message}>
        <Textarea
          {...register("description")}
          placeholder="Contract description..."
          rows={3}
        />
      </Field>

      <div className="flex items-center gap-3">
        <Switch
          checked={watch("autoRenewal") ?? false}
          onCheckedChange={(checked) => setValue("autoRenewal", checked)}
        />
        <Label>Auto-renewal</Label>
      </div>

      {watch("autoRenewal") && (
        <Field label="Termination Notice (days)">
          <Input
            type="number"
            {...register("terminationNoticeDays", { valueAsNumber: true })}
            placeholder="90"
          />
        </Field>
      )}
    </div>
  )
}
