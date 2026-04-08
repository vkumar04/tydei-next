"use client"

import { useState, useEffect, useCallback } from "react"
import type { UseFormReturn } from "react-hook-form"
import type { CreateContractInput } from "@/lib/validators/contracts"
import { getVendorCOGSpend } from "@/lib/actions/cog-records"
import { getContracts } from "@/lib/actions/contracts"
import { useQuery } from "@tanstack/react-query"
import { Link2, X } from "lucide-react"
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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
  {
    value: "usage",
    label: "Usage-Based",
    description: "Rebates on spend",
  },
  {
    value: "pricing_only",
    label: "Pricing Only",
    description: "Discounted prices",
  },
  {
    value: "capital",
    label: "Capital Equipment",
    description: "Equipment + service",
  },
  {
    value: "grouped",
    label: "GPO/Group",
    description: "Collective buying",
  },
  {
    value: "tie_in",
    label: "Tie-In",
    description: "Bundled products",
  },
  {
    value: "service",
    label: "Service",
    description: "Service agreements",
  },
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

  const vendorId = watch("vendorId")
  const totalValue = watch("totalValue")
  const contractType = watch("contractType")
  const selectedCategoryIds = watch("categoryIds") ?? []
  const [cogAutoFilled, setCogAutoFilled] = useState(false)
  const [linkedContractId, setLinkedContractId] = useState<string>("")
  const [additionalVendorIds, setAdditionalVendorIds] = useState<string[]>([])
  const [vendorToAdd, setVendorToAdd] = useState<string>("")

  // Fetch existing contracts for tie-in / capital linking
  const { data: contractsData } = useQuery({
    queryKey: ["contracts", "link-options"],
    queryFn: () => getContracts({ pageSize: 100 }),
    enabled: contractType === "tie_in" || contractType === "capital",
  })

  // Auto-populate contract total from vendor COG spend when vendor changes
  const lookupCOGSpend = useCallback(
    async (vid: string) => {
      try {
        const spend = await getVendorCOGSpend(vid)
        // Only auto-fill if totalValue is currently 0/empty
        const current = form.getValues("totalValue")
        if ((!current || current === 0) && spend > 0) {
          setValue("totalValue", spend)
          setCogAutoFilled(true)
        }
      } catch {
        // Silently ignore — user can still enter manually
      }
    },
    [form, setValue]
  )

  useEffect(() => {
    setCogAutoFilled(false)
    if (vendorId) {
      lookupCOGSpend(vendorId)
    }
  }, [vendorId, lookupCOGSpend])

  const effectiveDateStr = watch("effectiveDate")
  const expirationDateStr = watch("expirationDate")
  const effectiveDate = parseDateString(effectiveDateStr)
  const expirationDate = parseDateString(expirationDateStr)

  // Auto-compute annualValue when totalValue and dates are available
  useEffect(() => {
    const current = form.getValues("annualValue")
    if (current && current !== 0) return // don't overwrite manual entry
    if (!totalValue || totalValue === 0) return
    if (!effectiveDateStr || !expirationDateStr) return
    const effMs = new Date(effectiveDateStr).getTime()
    const expMs = new Date(expirationDateStr).getTime()
    if (isNaN(effMs) || isNaN(expMs) || expMs <= effMs) return
    const years = Math.max(1, (expMs - effMs) / (365.25 * 24 * 60 * 60 * 1000))
    setValue("annualValue", Math.round((totalValue / years) * 100) / 100)
  }, [totalValue, effectiveDateStr, expirationDateStr, form, setValue])

  return (
    <div className="space-y-6">
      {/* Basic Information */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Information</CardTitle>
          <CardDescription>Enter the contract details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Contract Name"
              error={errors.name?.message}
              required
            >
              <Input
                {...register("name")}
                placeholder="e.g., Arthrex2024"
              />
            </Field>

            <Field
              label="Contract ID"
              error={errors.contractNumber?.message}
            >
              <Input
                {...register("contractNumber")}
                placeholder="e.g., ART-2024-001"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Vendor" error={errors.vendorId?.message} required>
              <Select
                value={watch("vendorId")}
                onValueChange={(v) => setValue("vendorId", v)}
              >
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

            <Field
              label="Contract Type"
              error={errors.contractType?.message}
              required
            >
              <Select
                value={watch("contractType")}
                onValueChange={(v) =>
                  setValue(
                    "contractType",
                    v as CreateContractInput["contractType"]
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {contractTypes.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <div className="flex items-center justify-between w-full gap-2">
                        <span>{t.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.description}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Categories"
              error={errors.categoryIds?.message}
            >
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                  >
                    {selectedCategoryIds.length > 0
                      ? `${selectedCategoryIds.length} selected`
                      : "Select categories"}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {selectedCategoryIds.length > 0 && selectedCategoryIds.length}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-2" align="start">
                  <div className="max-h-[200px] overflow-y-auto space-y-1">
                    {categories.map((c) => {
                      const checked = selectedCategoryIds.includes(c.id)
                      return (
                        <label
                          key={c.id}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-accent",
                            checked && "bg-accent"
                          )}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={checked}
                            onChange={() => {
                              const next = checked
                                ? selectedCategoryIds.filter((id) => id !== c.id)
                                : [...selectedCategoryIds, c.id]
                              setValue("categoryIds", next)
                              setValue("productCategoryId", next[0] || undefined)
                            }}
                          />
                          <div className={cn(
                            "h-4 w-4 rounded border flex items-center justify-center",
                            checked ? "bg-primary border-primary text-primary-foreground" : "border-input"
                          )}>
                            {checked && <span className="text-xs">&#10003;</span>}
                          </div>
                          {c.name}
                        </label>
                      )
                    })}
                  </div>
                </PopoverContent>
              </Popover>
              {selectedCategoryIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                  {selectedCategoryIds.map((id) => {
                    const cat = categories.find((c) => c.id === id)
                    return cat ? (
                      <Badge key={id} variant="secondary" className="text-xs gap-1">
                        {cat.name}
                        <button
                          type="button"
                          className="ml-0.5 hover:text-destructive"
                          onClick={() => {
                            const next = selectedCategoryIds.filter((cid) => cid !== id)
                            setValue("categoryIds", next)
                            setValue("productCategoryId", next[0] || undefined)
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ) : null
                  })}
                </div>
              )}
            </Field>

            <Field
              label="GPO Affiliation"
              error={errors.gpoAffiliation?.message}
            >
              <Input
                {...register("gpoAffiliation")}
                placeholder="e.g., Vizient, Premier"
              />
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
            <Field
              label="Effective Date"
              error={errors.effectiveDate?.message}
              required
            >
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
                    onSelect={(date) =>
                      setValue("effectiveDate", toDateString(date))
                    }
                    captionLayout="dropdown"
                    fromYear={2020}
                    toYear={2035}
                  />
                </PopoverContent>
              </Popover>
            </Field>

            <Field
              label="Expiration Date"
              error={errors.expirationDate?.message}
              required
            >
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
                    onSelect={(date) =>
                      setValue("expirationDate", toDateString(date))
                    }
                    captionLayout="dropdown"
                    fromYear={2020}
                    toYear={2035}
                    disabled={(date) =>
                      effectiveDate ? date < effectiveDate : false
                    }
                  />
                </PopoverContent>
              </Popover>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Performance Period">
              <Select
                value={watch("performancePeriod") ?? "monthly"}
                onValueChange={(v) =>
                  setValue(
                    "performancePeriod",
                    v as CreateContractInput["performancePeriod"]
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly - Evaluated every month</SelectItem>
                  <SelectItem value="quarterly">Quarterly - Evaluated every 3 months</SelectItem>
                  <SelectItem value="semi_annual">Semi-Annual - Evaluated every 6 months</SelectItem>
                  <SelectItem value="annual">Annual - Evaluated yearly</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Rebate Pay Period">
              <Select
                value={watch("rebatePayPeriod") ?? "quarterly"}
                onValueChange={(v) =>
                  setValue(
                    "rebatePayPeriod",
                    v as CreateContractInput["rebatePayPeriod"]
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly - Paid every month</SelectItem>
                  <SelectItem value="quarterly">Quarterly - Paid every 3 months</SelectItem>
                  <SelectItem value="semi_annual">Semi-Annual - Paid every 6 months</SelectItem>
                  <SelectItem value="annual">Annual - Paid yearly</SelectItem>
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
                {...register("terminationNoticeDays", {
                  valueAsNumber: true,
                })}
                placeholder="90"
              />
            </Field>
          )}
        </CardContent>
      </Card>

      {/* Group Contract Settings */}
      {watch("contractType") === "grouped" && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-sm">Group Contract Settings</CardTitle>
            <CardDescription>Configure multi-facility participation</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="GPO Affiliation">
              <Input
                {...register("gpoAffiliation")}
                placeholder="e.g., Vizient, Premier, HealthTrust"
              />
            </Field>
            <div className="flex items-center gap-3">
              <Switch
                checked={watch("isMultiFacility")}
                onCheckedChange={(v) => setValue("isMultiFacility", v)}
              />
              <Label>Multi-facility contract</Label>
            </div>
            {watch("isMultiFacility") && (
              <p className="text-sm text-muted-foreground">
                Facility selection will be available after contract creation.
              </p>
            )}

            {/* Additional Participating Vendors */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Additional Participating Vendors</Label>
              <p className="text-xs text-muted-foreground">
                The primary vendor is set above. Add other vendors participating in this group contract.
              </p>
              {additionalVendorIds.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {additionalVendorIds.map((vid) => {
                    const vendor = vendors.find((v) => v.id === vid)
                    return (
                      <Badge key={vid} variant="secondary" className="gap-1 pr-1">
                        {vendor?.displayName || vendor?.name || vid}
                        <button
                          type="button"
                          onClick={() =>
                            setAdditionalVendorIds((prev) =>
                              prev.filter((id) => id !== vid)
                            )
                          }
                          className="ml-1 rounded-full p-0.5 hover:bg-muted"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    )
                  })}
                </div>
              )}
              <div className="flex gap-2">
                <Select
                  value={vendorToAdd}
                  onValueChange={setVendorToAdd}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a vendor to add..." />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors
                      .filter(
                        (v) =>
                          v.id !== vendorId &&
                          !additionalVendorIds.includes(v.id)
                      )
                      .map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.displayName || v.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!vendorToAdd}
                  onClick={() => {
                    if (vendorToAdd) {
                      setAdditionalVendorIds((prev) => [...prev, vendorToAdd])
                      setVendorToAdd("")
                    }
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Linked Contract (for Tie-In and Capital types) */}
      {(contractType === "tie_in" || contractType === "capital") && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Linked Contract
            </CardTitle>
            <CardDescription>
              Link this {contractType === "tie_in" ? "tie-in" : "capital equipment"} contract to an existing contract
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field label="Related Contract">
              <Select
                value={linkedContractId}
                onValueChange={setLinkedContractId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a contract to link..." />
                </SelectTrigger>
                <SelectContent>
                  {contractsData?.contracts?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center justify-between w-full gap-2">
                        <span>{c.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {c.vendor?.name}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {linkedContractId && (
              <p className="text-xs text-muted-foreground mt-2">
                This contract will be linked for reference after creation.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Financial Details */}
      <Card>
        <CardHeader>
          <CardTitle>Financial Details</CardTitle>
          <CardDescription>Contract value and projections</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Contract Total"
              error={errors.totalValue?.message}
            >
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  type="number"
                  step="0.01"
                  {...register("totalValue", { valueAsNumber: true })}
                  className="pl-7"
                  placeholder="0"
                />
              </div>
              {cogAutoFilled && (
                <p className="text-xs text-muted-foreground mt-1">
                  Based on COG spend data
                </p>
              )}
            </Field>

            <Field
              label="Annual Value"
              error={errors.annualValue?.message}
            >
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  type="number"
                  step="0.01"
                  {...register("annualValue", { valueAsNumber: true })}
                  className="pl-7"
                  placeholder="0"
                />
              </div>
            </Field>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
