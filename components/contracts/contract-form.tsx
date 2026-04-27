"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import type { UseFormReturn } from "react-hook-form"
import type { CreateContractInput } from "@/lib/validators/contracts"
import { getVendorCOGSpend } from "@/lib/actions/cog-records"
import { getContracts } from "@/lib/actions/contracts"
import { computeContractMetrics } from "@/lib/actions/contracts/derived-metrics"
import { getFacilities } from "@/lib/actions/facilities"
import { getVendors } from "@/lib/actions/vendors"
import { FacilityMultiSelect } from "@/components/contracts/facility-multi-select"
import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { Link2, X } from "lucide-react"
import { GroupedVendorPicker } from "@/components/contracts/grouped-vendor-picker"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
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
import { computeContractYears } from "@/lib/contracts/term-years"
import { BasicInformationCard } from "@/components/contracts/_form/_basic-information-card"
import { ContractDatesCard } from "@/components/contracts/_form/_contract-dates-card"

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

export function ContractFormBasicInfo({
  form,
  vendors,
  categories,
  onCreateCategory,
}: ContractFormProps) {
  const {
    setValue,
    watch,
  } = form

  const vendorId = watch("vendorId")
  const totalValue = watch("totalValue")
  const contractType = watch("contractType")
  const selectedCategoryIds = watch("categoryIds") ?? []
  // Charles 2026-04-25 audit facility C1: per-category market-share
  // commitment overlay (validator + engine already accept this).
  const msbcRows = watch("marketShareCommitmentByCategory") ?? []
  const updateMsbcRow = (
    index: number,
    patch: Partial<{ category: string; commitmentPct: number }>,
  ) => {
    const next = [...msbcRows]
    const current = next[index] ?? { category: "", commitmentPct: 0 }
    next[index] = { ...current, ...patch }
    setValue("marketShareCommitmentByCategory", next, { shouldDirty: true })
  }
  const addMsbcRow = () => {
    setValue(
      "marketShareCommitmentByCategory",
      [...msbcRows, { category: "", commitmentPct: 0 }],
      { shouldDirty: true },
    )
  }
  const removeMsbcRow = (index: number) => {
    const next = msbcRows.filter((_, i) => i !== index)
    setValue(
      "marketShareCommitmentByCategory",
      next.length > 0 ? next : null,
      { shouldDirty: true },
    )
  }
  const [cogAutoFilled, setCogAutoFilled] = useState(false)
  const [linkedContractId, setLinkedContractId] = useState<string>("")
  const [additionalVendorIds, setAdditionalVendorIds] = useState<string[]>([])

  // Live vendor list for the grouped contract vendor picker
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

  // Charles 2026-04-26: complianceRate + currentMarketShare are
  // ALWAYS computed from live COG + pricing data — never user-edited.
  // Recompute whenever vendor / categories / window changes. Kept in
  // a separate query so the form fields stay reactive without
  // re-running the contracts list / COG spend queries.
  const selectedCategoryNames = useMemo(
    () =>
      selectedCategoryIds
        .map((id) => categories.find((c) => c.id === id)?.name)
        .filter((name): name is string => Boolean(name)),
    [selectedCategoryIds, categories],
  )
  const metricsQuery = useQuery({
    queryKey: [
      "contract-derived-metrics",
      vendorId,
      [...selectedCategoryNames].sort(),
      effectiveDateStr,
      expirationDateStr,
    ],
    queryFn: () =>
      computeContractMetrics({
        vendorId: vendorId!,
        productCategories: selectedCategoryNames,
        effectiveDate: effectiveDateStr || undefined,
        expirationDate: expirationDateStr || undefined,
      }),
    enabled: !!vendorId && selectedCategoryNames.length > 0,
    staleTime: 60_000,
  })

  // Sync the computed values back into the form so the existing save
  // path (which reads complianceRate + currentMarketShare from the
  // form payload) keeps working without further changes.
  useEffect(() => {
    if (metricsQuery.data) {
      setValue("complianceRate", metricsQuery.data.complianceRate ?? null, {
        shouldDirty: false,
      })
      setValue(
        "currentMarketShare",
        metricsQuery.data.currentMarketShare ?? null,
        { shouldDirty: false },
      )
    }
  }, [metricsQuery.data, setValue])

  // Charles 2026-04-26: annualValue is ALWAYS computed from
  // totalValue ÷ contract years. Earlier behavior preserved manual
  // edits which let the two diverge (Annual > Total) and triggered
  // a confusing "Annual cannot exceed Total" validation error. The
  // system owns this field — recompute on every change so it can
  // never go out of sync.
  useEffect(() => {
    if (!totalValue || totalValue === 0) {
      setValue("annualValue", 0, { shouldDirty: false })
      return
    }
    if (!effectiveDateStr || !expirationDateStr) return
    const years = computeContractYears(effectiveDateStr, expirationDateStr)
    setValue(
      "annualValue",
      Math.round((totalValue / years) * 100) / 100,
      { shouldDirty: false },
    )
  }, [totalValue, effectiveDateStr, expirationDateStr, setValue])

  const { register, formState: { errors } } = form

  return (
    <div className="space-y-6">
      {/* Basic Information */}
      <BasicInformationCard
        form={form}
        vendors={vendors}
        categories={categories}
        onCreateCategory={onCreateCategory}
      />

      {/* Contract Dates */}
      <ContractDatesCard form={form} />

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

            <Field label="Annual Value">
              {/* Computed from Contract Total ÷ contract years.
                  Read-only — registered as hidden so the form
                  payload still includes the value. */}
              <input
                type="hidden"
                {...register("annualValue", { valueAsNumber: true })}
              />
              <div className="flex h-10 items-center justify-between rounded-md border border-input bg-muted/30 px-3 text-sm">
                <span className="font-medium">
                  {watch("annualValue")
                    ? `$${Number(watch("annualValue")).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : "—"}
                </span>
                <span className="text-xs text-muted-foreground">
                  computed
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Contract Total ÷ contract years
              </p>
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
            {/* Compliance + Current Market Share are computed from
                live COG + ContractPricing data within the contract's
                categories. Never user-edited. The hidden inputs keep
                the form payload shape stable so the save path is
                unchanged. */}
            <input type="hidden" {...register("complianceRate", {
              setValueAs: (v) => (v === "" || v == null ? null : Number(v)),
            })} />
            <input type="hidden" {...register("currentMarketShare", {
              setValueAs: (v) => (v === "" || v == null ? null : Number(v)),
            })} />
            <Field label="Compliance Rate (%)">
              <div className="flex h-10 items-center justify-between rounded-md border border-input bg-muted/30 px-3 text-sm">
                <span className="font-medium">
                  {metricsQuery.isFetching
                    ? "…"
                    : metricsQuery.data?.complianceRate != null
                      ? `${metricsQuery.data.complianceRate.toFixed(1)}%`
                      : "—"}
                </span>
                <span className="text-xs text-muted-foreground">computed</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {metricsQuery.data
                  ? `From ${metricsQuery.data.cogRowsOnContract.toLocaleString()} of ${metricsQuery.data.cogRowsTotal.toLocaleString()} COG rows in contract categories`
                  : "Calculated from COG + pricing files. Pick a vendor + categories."}
              </p>
            </Field>
            <Field label="Current Market Share (%)">
              <div className="flex h-10 items-center justify-between rounded-md border border-input bg-muted/30 px-3 text-sm">
                <span className="font-medium">
                  {metricsQuery.isFetching
                    ? "…"
                    : metricsQuery.data?.currentMarketShare != null
                      ? `${metricsQuery.data.currentMarketShare.toFixed(1)}%`
                      : "—"}
                </span>
                <span className="text-xs text-muted-foreground">computed</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {metricsQuery.data &&
                metricsQuery.data.totalSpendInCategories > 0
                  ? `Vendor $${Math.round(metricsQuery.data.vendorSpendInCategories).toLocaleString()} of $${Math.round(metricsQuery.data.totalSpendInCategories).toLocaleString()} category spend`
                  : "Vendor's category spend ÷ total facility spend in those categories."}
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
                Vendor&apos;s contractual target (manual — this is the goal,
                not the actual)
              </p>
            </Field>
          </div>

          {/* Charles 2026-04-25 audit facility C1: per-category overlay. */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">
                  Per-category market-share commitments
                </p>
                <p className="text-xs text-muted-foreground">
                  Optional: override the contract-wide commitment for
                  specific categories. The market-share card overlays
                  these targets on the live actuals.
                </p>
              </div>
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={addMsbcRow}
              >
                + Add category
              </button>
            </div>
            {msbcRows.length > 0 && (
              <div className="space-y-2">
                {msbcRows.map((row, idx) => (
                  <div key={idx} className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-xs text-muted-foreground">
                        Category
                      </label>
                      {/* Charles 2026-04-25 audit re-pass: bind to the
                          category list so a typo can't desync from the
                          COG row's `category` string. */}
                      <Select
                        value={row.category}
                        onValueChange={(v) =>
                          updateMsbcRow(idx, { category: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories
                            .filter((c) =>
                              selectedCategoryIds.length === 0
                                ? true
                                : selectedCategoryIds.includes(c.id),
                            )
                            .map((c) => (
                              <SelectItem key={c.id} value={c.name}>
                                {c.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-32 space-y-1">
                      <label className="text-xs text-muted-foreground">
                        Commitment %
                      </label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        value={row.commitmentPct}
                        onChange={(e) =>
                          updateMsbcRow(idx, {
                            commitmentPct: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <button
                      type="button"
                      className="mb-1.5 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMsbcRow(idx)}
                      aria-label="Remove row"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
