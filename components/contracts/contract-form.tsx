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
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { CalendarIcon } from "lucide-react"
import { format, parseISO } from "date-fns"
import { cn } from "@/lib/utils"

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
  { value: "usage", label: "Usage-Based", description: "Rebates on spend" },
  { value: "capital", label: "Capital Equipment", description: "Equipment + service" },
  { value: "service", label: "Service", description: "Service agreements" },
  { value: "tie_in", label: "Tie-In", description: "Bundled products" },
  { value: "grouped", label: "GPO/Group", description: "Collective buying" },
  { value: "pricing_only", label: "Pricing Only", description: "Discounted prices" },
] as const

const performancePeriods = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "semi_annual", label: "Semi-Annual" },
  { value: "annual", label: "Annual" },
] as const

function parseDateString(dateStr: string | undefined): Date | undefined {
  if (!dateStr) return undefined
  try {
    return parseISO(dateStr)
  } catch {
    return undefined
  }
}

function toDateString(date: Date | undefined): string {
  if (!date) return ""
  return format(date, "yyyy-MM-dd")
}

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

  const effectiveDateStr = watch("effectiveDate")
  const expirationDateStr = watch("expirationDate")
  const effectiveDate = parseDateString(effectiveDateStr)
  const expirationDate = parseDateString(expirationDateStr)

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Basic Information */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>Enter the contract details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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

            <Field label="Contract Type" error={errors.contractType?.message} required>
              <Select value={watch("contractType")} onValueChange={(v) => setValue("contractType", v as CreateContractInput["contractType"])}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {contractTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex items-center justify-between w-full gap-2">
                        <span>{t.label}</span>
                        <span className="text-xs text-muted-foreground">{t.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
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

            <Field label="GPO Affiliation" error={errors.gpoAffiliation?.message}>
              <Input {...register("gpoAffiliation")} placeholder="e.g., Vizient, Premier" />
            </Field>
          </div>

          <Field label="Description" error={errors.description?.message}>
            <Textarea
              {...register("description")}
              placeholder="Contract notes and details..."
              rows={3}
            />
          </Field>
        </CardContent>
      </Card>

      {/* Contract Dates */}
      <Card>
        <CardHeader>
          <CardTitle>Contract Dates</CardTitle>
          <CardDescription>Set the contract timeline</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Effective Date" error={errors.effectiveDate?.message} required>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-10",
                      !effectiveDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                    {effectiveDate
                      ? format(effectiveDate, "MMMM do, yyyy")
                      : "Select start date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={effectiveDate}
                    onSelect={(date) => setValue("effectiveDate", toDateString(date))}
                    captionLayout="dropdown"
                    fromYear={2020}
                    toYear={2035}
                  />
                </PopoverContent>
              </Popover>
            </Field>

            <Field label="Expiration Date" error={errors.expirationDate?.message} required>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal h-10",
                      !expirationDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                    {expirationDate
                      ? format(expirationDate, "MMMM do, yyyy")
                      : "Select end date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={expirationDate}
                    onSelect={(date) => setValue("expirationDate", toDateString(date))}
                    captionLayout="dropdown"
                    fromYear={2020}
                    toYear={2035}
                    disabled={(date) => (effectiveDate ? date < effectiveDate : false)}
                  />
                </PopoverContent>
              </Popover>
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
        </CardContent>
      </Card>

      {/* Financial Details */}
      <Card>
        <CardHeader>
          <CardTitle>Financial Details</CardTitle>
          <CardDescription>Contract value and projections</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Total Value ($)" error={errors.totalValue?.message}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                type="number"
                step="0.01"
                {...register("totalValue", { valueAsNumber: true })}
                className="pl-7"
                placeholder="0"
              />
            </div>
          </Field>

          <Field label="Annual Value ($)" error={errors.annualValue?.message}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                type="number"
                step="0.01"
                {...register("annualValue", { valueAsNumber: true })}
                className="pl-7"
                placeholder="0"
              />
            </div>
          </Field>
        </CardContent>
      </Card>
    </div>
  )
}
