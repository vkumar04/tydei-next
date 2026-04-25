"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import type { UseFormReturn } from "react-hook-form"
import type { CreateContractInput } from "@/lib/validators/contracts"
import { getVendorCOGSpend } from "@/lib/actions/cog-records"
import { getContracts } from "@/lib/actions/contracts"
import { getFacilities } from "@/lib/actions/facilities"
import { getVendors } from "@/lib/actions/vendors"
import { FacilityMultiSelect } from "@/components/contracts/facility-multi-select"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useCreateVendor } from "@/hooks/use-vendor-crud"
import { Link2, X, Plus } from "lucide-react"
import { GroupedVendorPicker } from "@/components/contracts/grouped-vendor-picker"
import { suggestSimilarCategory } from "@/lib/categories/fuzzy-match"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
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
import { computeContractYears } from "@/lib/contracts/term-years"

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
  /**
   * Optional hook to create a new Category row from the form. When
   * provided, the Categories popover shows an inline "Add category"
   * input that fuzzy-matches existing names first (Charles R5.17).
   */
  onCreateCategory?: (name: string) => Promise<{ id: string; name: string }>
}

// Charles W1.W-D2 — contract-type taxonomy.
//
// Charles's rule (2026-04-20): "if a capital contract has the same terms
// as a usage contract it shouldn't be *called* capital. Tie-in should
// include both capital + usage terms."
//
// That gives us the following distinctions. Descriptions are the user's
// first line of guidance between the two overlapping types (capital vs
// tie_in), so they spell out the difference:
//
//   - capital  → stand-alone capital equipment purchase with NO rebate
//                or usage terms on the same contract. Pure asset +
//                payment plan. Pick this only when there are no
//                consumables.
//   - tie_in   → capital + consumable/usage rebate terms on the SAME
//                contract. One capital balance, paid down by rebates
//                earned across every rebate term on the contract. This
//                is the right pick whenever the contract mixes the two.
//
// Future revisit may hide `capital` from the picker entirely — v0 only
// models tie-in — but removing it today would orphan seeded `capital`
// rows and break existing reports. Descriptions first, taxonomy change
// later if it's still confusing.
const contractTypes = [
  {
    value: "usage",
    label: "Usage-Based",
    description: "Rebates on spend (no capital equipment)",
  },
  {
    value: "pricing_only",
    label: "Pricing Only",
    description: "Discounted prices, no rebate terms",
  },
  {
    value: "capital",
    label: "Capital Equipment",
    description:
      "Stand-alone equipment purchase, no rebate terms. If this contract mixes capital + consumables, pick Tie-In instead.",
  },
  {
    value: "grouped",
    label: "GPO/Group",
    description: "Collective buying",
  },
  {
    value: "tie_in",
    label: "Tie-In",
    description: "Capital equipment + rebate terms on one contract",
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
  onCreateCategory,
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

  // Inline vendor creation
  const queryClient = useQueryClient()
  const { data: liveVendorsData } = useQuery({
    queryKey: queryKeys.vendors.all,
    queryFn: () => getVendors(),
    initialData: vendors,
  })

  // Facility list for the multi-facility picker. Only fetched when a
  // grouped contract with isMultiFacility on is being edited — React
  // Query handles the cache. Shape is `{ id, name }[]` per
  // `getFacilities` in lib/actions/facilities.ts.
  const { data: allFacilities } = useQuery({
    queryKey: queryKeys.facilities.all,
    queryFn: getFacilities,
    enabled: watch("isMultiFacility") === true,
  })
  const liveVendors = useMemo<VendorOption[]>(
    () => (liveVendorsData ?? vendors) as VendorOption[],
    [liveVendorsData, vendors],
  )
  const createVendorMutation = useCreateVendor()
  const [addVendorOpen, setAddVendorOpen] = useState(false)
  // Inline "Add category" state — Charles R5.17. Typed name is
  // fuzzy-matched against `categories` so we suggest an existing
  // row before creating a duplicate.
  const [newCategoryName, setNewCategoryName] = useState("")
  const [creatingCategory, setCreatingCategory] = useState(false)
  const categorySuggestion = useMemo(() => {
    const trimmed = newCategoryName.trim()
    if (!trimmed) return null
    // Don't suggest when the typed name already exactly matches
    // (user will just tick the existing checkbox).
    const exact = categories.find(
      (c) => c.name.toLowerCase() === trimmed.toLowerCase(),
    )
    if (exact) return null
    return suggestSimilarCategory(trimmed, categories)
  }, [newCategoryName, categories])
  const [newVendorName, setNewVendorName] = useState("")
  const [newVendorDisplayName, setNewVendorDisplayName] = useState("")
  const [newVendorContactName, setNewVendorContactName] = useState("")
  const [newVendorContactEmail, setNewVendorContactEmail] = useState("")
  const [newVendorError, setNewVendorError] = useState<string | null>(null)

  const handleCreateVendor = useCallback(async () => {
    setNewVendorError(null)
    const name = newVendorName.trim()
    if (!name) {
      setNewVendorError("Name is required")
      return
    }
    const existing = liveVendors.find(
      (v) => v.name.toLowerCase() === name.toLowerCase(),
    )
    if (existing) {
      setNewVendorError("A vendor with that name already exists")
      return
    }
    try {
      const created = await createVendorMutation.mutateAsync({
        name,
        displayName: newVendorDisplayName.trim() || undefined,
        contactName: newVendorContactName.trim() || undefined,
        contactEmail: newVendorContactEmail.trim() || undefined,
        tier: "standard",
      })
      await queryClient.invalidateQueries({ queryKey: queryKeys.vendors.all })
      setValue("vendorId", created.id)
      setAddVendorOpen(false)
      setNewVendorName("")
      setNewVendorDisplayName("")
      setNewVendorContactName("")
      setNewVendorContactEmail("")
    } catch (err) {
      setNewVendorError(err instanceof Error ? err.message : "Failed to create vendor")
    }
  }, [
    createVendorMutation,
    liveVendors,
    newVendorContactEmail,
    newVendorContactName,
    newVendorDisplayName,
    newVendorName,
    queryClient,
    setValue,
  ])

  const selectCategoryId = useCallback(
    (id: string) => {
      const current = form.getValues("categoryIds") ?? []
      if (current.includes(id)) return
      const next = [...current, id]
      setValue("categoryIds", next)
      setValue("productCategoryId", next[0])
    },
    [form, setValue],
  )

  const handleCreateNewCategory = useCallback(async () => {
    if (!onCreateCategory) return
    const name = newCategoryName.trim()
    if (!name) return
    setCreatingCategory(true)
    try {
      const created = await onCreateCategory(name)
      selectCategoryId(created.id)
      setNewCategoryName("")
    } finally {
      setCreatingCategory(false)
    }
  }, [newCategoryName, onCreateCategory, selectCategoryId])

  const handleUseSuggestedCategory = useCallback(() => {
    if (!categorySuggestion) return
    selectCategoryId(categorySuggestion.id)
    setNewCategoryName("")
  }, [categorySuggestion, selectCategoryId])

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

  // Auto-compute annualValue when totalValue and dates are available.
  // Uses calendar-month math (computeContractYears) so whole-year terms
  // produce clean integers — a Jan 1 → Dec 31 contract is 1.0 years, not
  // 0.999 that only avoided bad output via Math.max(1, …) flooring.
  useEffect(() => {
    const current = form.getValues("annualValue")
    if (current && current !== 0) return // don't overwrite manual entry
    if (!totalValue || totalValue === 0) return
    if (!effectiveDateStr || !expirationDateStr) return
    const years = computeContractYears(effectiveDateStr, expirationDateStr)
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
                onValueChange={(v) => {
                  if (v === "__add_new__") {
                    setAddVendorOpen(true)
                    return
                  }
                  setValue("vendorId", v)
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {liveVendors.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.displayName || v.name}
                    </SelectItem>
                  ))}
                  <SelectSeparator />
                  <SelectItem value="__add_new__" className="text-primary font-medium">
                    <span className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      Add new vendor
                    </span>
                  </SelectItem>
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
                  {onCreateCategory && (
                    <div className="border-b pb-2 mb-2 space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Add category</Label>
                      <div className="flex gap-1">
                        <Input
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          placeholder="e.g., Trauma Implants"
                          className="h-8 text-sm"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              if (categorySuggestion) {
                                handleUseSuggestedCategory()
                              } else {
                                void handleCreateNewCategory()
                              }
                            }
                          }}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 px-2"
                          disabled={!newCategoryName.trim() || creatingCategory}
                          onClick={() => void handleCreateNewCategory()}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      {categorySuggestion && (
                        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs space-y-1.5">
                          <div>
                            Similar category exists: <span className="font-medium">&quot;{categorySuggestion.name}&quot;</span> — use that instead?
                          </div>
                          <div className="flex gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="default"
                              className="h-6 text-xs"
                              onClick={handleUseSuggestedCategory}
                            >
                              Use &quot;{categorySuggestion.name}&quot;
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-6 text-xs"
                              disabled={creatingCategory}
                              onClick={() => void handleCreateNewCategory()}
                            >
                              Create new &quot;{newCategoryName.trim()}&quot;
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
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

      {/* Group Contract Settings — only the GPO field is grouped-specific */}
      {watch("contractType") === "grouped" && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-sm">Group Contract Settings</CardTitle>
            <CardDescription>GPO affiliation for this group contract</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="GPO Affiliation">
              <Input
                {...register("gpoAffiliation")}
                placeholder="e.g., Vizient, Premier, HealthTrust"
              />
            </Field>
          </CardContent>
        </Card>
      )}

      {/* Multi-facility contract (available for any contract type) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Multi-facility contract</CardTitle>
          <CardDescription>
            Enable to apply this contract to additional facilities.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={watch("isMultiFacility") ?? false}
              onCheckedChange={(v) => setValue("isMultiFacility", v)}
            />
            <Label>Multi-facility contract</Label>
          </div>
          {watch("isMultiFacility") && (
            <Field label="Additional facilities">
              <FacilityMultiSelect
                facilities={(allFacilities ?? []).filter(
                  (f) => f.id !== watch("facilityId"),
                )}
                selected={watch("additionalFacilityIds") ?? []}
                onChange={(ids) =>
                  setValue("additionalFacilityIds", ids)
                }
              />
            </Field>
          )}
        </CardContent>
      </Card>

      {/* Grouped Contract (multi-vendor) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Grouped contract (multi-vendor)</CardTitle>
          <CardDescription>
            Enable to select additional vendors participating in this group
            contract.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={watch("isGrouped") ?? false}
              onCheckedChange={(v) => setValue("isGrouped", v)}
            />
            <Label>Grouped contract</Label>
          </div>

          {watch("isGrouped") && (
            <Field label="Additional vendors in this group">
              <GroupedVendorPicker
                availableVendors={liveVendors.filter(
                  (v) => v.id !== vendorId,
                )}
                selected={additionalVendorIds}
                onChange={setAdditionalVendorIds}
              />
            </Field>
          )}
        </CardContent>
      </Card>

      {/* Linked Contract (for Tie-In and Capital types) */}
      {(contractType === "tie_in" || contractType === "capital") && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Linked Contract
            </CardTitle>
            <CardDescription>
              {contractType === "tie_in"
                ? "Tie this contract to the capital equipment purchase it pays down with rebates."
                : "Link this capital equipment contract to an existing contract."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Related Contract">
              <div className="flex gap-2">
                <div className="flex-1">
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
                </div>
                {linkedContractId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      setLinkedContractId("")
                      setValue("tieInCapitalValue", undefined as never)
                      setValue("tieInPayoffMonths", undefined as never)
                    }}
                    aria-label="Unlink contract"
                    title="Unlink contract"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </Field>

            {/* Tie-in contracts: pay-down amount + period so rebates on
                this contract can be applied to the capital contract's
                outstanding balance. */}
            {contractType === "tie_in" && linkedContractId && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Capital Equipment Value">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      className="pl-7"
                      placeholder="0"
                      {...register("tieInCapitalValue", { valueAsNumber: true })}
                    />
                  </div>
                </Field>
                <Field label="Expected Pay-off (months)">
                  <Input
                    type="number"
                    placeholder="36"
                    {...register("tieInPayoffMonths", { valueAsNumber: true })}
                  />
                </Field>
              </div>
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
          {/*
           * Charles 2026-04-25 (audit follow-up): contract-level
           * metrics that drive the compliance_rebate + market_share
           * term engines. Without these inputs, those term types
           * silently compute $0 because the engine reads
           * Contract.complianceRate / currentMarketShare directly.
           * All three are optional — the engine returns 0 (no
           * qualification) when null, which is the right default
           * for contracts that don't track compliance or market share.
           */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Compliance Rate (%)"
              error={errors.complianceRate?.message}
            >
              <div className="relative">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  {...register("complianceRate", {
                    setValueAs: (v) =>
                      v === "" || v == null ? null : Number(v),
                  })}
                  className="pr-8"
                  placeholder="—"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  %
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Drives Compliance Rebate term accruals
              </p>
            </Field>
            <Field
              label="Current Market Share (%)"
              error={errors.currentMarketShare?.message}
            >
              <div className="relative">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  {...register("currentMarketShare", {
                    setValueAs: (v) =>
                      v === "" || v == null ? null : Number(v),
                  })}
                  className="pr-8"
                  placeholder="—"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  %
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Drives Market Share term accruals
              </p>
            </Field>
            <Field
              label="Market Share Commitment (%)"
              error={errors.marketShareCommitment?.message}
            >
              <div className="relative">
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  {...register("marketShareCommitment", {
                    setValueAs: (v) =>
                      v === "" || v == null ? null : Number(v),
                  })}
                  className="pr-8"
                  placeholder="—"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  %
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Vendor's contractual target
              </p>
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Add Vendor Dialog */}
      <Dialog open={addVendorOpen} onOpenChange={setAddVendorOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add new vendor</DialogTitle>
            <DialogDescription>
              Create a new vendor inline. Only the name is required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Name" required>
              <Input
                value={newVendorName}
                onChange={(e) => setNewVendorName(e.target.value)}
                placeholder="e.g., Acme Medical"
                autoFocus
              />
            </Field>
            <Field label="Display name">
              <Input
                value={newVendorDisplayName}
                onChange={(e) => setNewVendorDisplayName(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="Contact name">
              <Input
                value={newVendorContactName}
                onChange={(e) => setNewVendorContactName(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label="Contact email">
              <Input
                type="email"
                value={newVendorContactEmail}
                onChange={(e) => setNewVendorContactEmail(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            {newVendorError && (
              <p className="text-sm text-destructive">{newVendorError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddVendorOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateVendor}
              disabled={createVendorMutation.isPending}
            >
              {createVendorMutation.isPending ? "Creating..." : "Create vendor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
